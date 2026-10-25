/**
 * Уроки английского (ENG-002): запросы к `/api/v1/english/{home,placement,lessons,runs,settings}`.
 * Тела — JSON из `qubite_english::lessons` (в схеме — объект), типы — здесь. Сверку ответов,
 * опыт и огонёк считает сервер; голос — через AI-шлюз с бюджетом.
 */
import { CSRF_HEADER, csrfFromCookie, type components } from '@qubite/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Fail, must } from '../auth/client';
import { toBase64 } from './english-view';

/** Задание урока (поля — по `content/english/schema`). */
export interface Task {
  id: string;
  type:
    | 'choose'
    | 'match'
    | 'build'
    | 'translate'
    | 'fill'
    | 'listen'
    | 'speak'
    | 'describe_image'
    | 'roleplay';
  skill?: string;
  ask_ru: string;
  ask_en?: string;
  hint_ru?: string;
  explain_ru?: string;
  question?: string;
  options?: string[];
  answer?: string;
  pairs?: { en: string; ru: string }[];
  from_ru?: string;
  extra?: string[];
  from?: 'ru' | 'en';
  text?: string;
  answers?: string[];
  translation_ru?: string;
  audio?: string;
  show_text?: boolean;
  mode?: 'repeat' | 'answer';
  say?: string;
  example?: string | string[];
  must_use?: string[];
  focus_ru?: string;
  image?: { prompt_en: string; alt_ru: string };
  min_sentences?: number;
  scenario_ru?: string;
  tutor_role?: string;
  learner_role?: string;
  opening?: string;
  goals_ru?: string[];
}

export interface Word {
  en: string;
  ru: string;
  example_en?: string;
  example_ru?: string;
  note_ru?: string;
}

export interface Lesson {
  id: string;
  level: string;
  title: { ru: string; en: string };
  goal_ru: string;
  minutes?: number;
  words: Word[];
  grammar: {
    title_ru: string;
    explain_ru: string;
    explain_en?: string;
    examples: { en: string; ru: string }[];
    mistakes: { wrong: string; right: string; why_ru: string }[];
  };
  phrases?: { en: string; ru: string }[];
  tasks: Task[];
  homework?: { about_ru: string; minutes?: number; tasks: Task[] };
  pass: { min_accuracy: number; min_speak: number; required?: string[]; about_ru: string };
  agent_notes_ru?: string[];
}

export interface Level {
  id: string;
  cefr: string;
  title_ru: string;
  about_ru: string;
  tutor_mode: 'ru_heavy' | 'ru_support' | 'en_simple' | 'en';
  tutor_rules_ru: string;
  boss: string | null;
}

export interface Run {
  id: string;
  lesson_id: string;
  kind: 'lesson' | 'homework' | 'review';
  answers: { task_id: string; lesson_id: string; correct: boolean; attempts: number }[];
  tasks: { lesson_id: string; task: Task; wrong: string }[];
}

export interface LessonView {
  lesson: Lesson;
  level: Level;
  passed: boolean;
  run: Run | null;
  homework_task: string | null;
  strictness: number;
}

export interface Step {
  id: string;
  level: string;
  module: string;
  module_title_ru: string;
  title_ru: string;
  goal_ru: string;
  detail: string;
  skipped: boolean;
  repeat: string | null;
  notes: string[];
  passed: boolean;
  ready: boolean;
  homework: string | null;
}

export interface Quest {
  id: string;
  title: string;
  counter: string;
  target: number;
  done: number;
}

export interface Unlock {
  id: string;
  title: string;
  how: string;
  gives?: string;
  open: boolean;
}

export interface Game {
  xp: number;
  rank: string;
  next_rank: string | null;
  next_rank_xp: number | null;
  streak: number;
  best_streak: number;
  freezes: number;
  lost_streak: number;
  minutes_today: number;
  goal_minutes: number;
  ring: boolean;
  week: { day: string; weekday: number; minutes: number; counted: boolean; frozen: boolean }[];
  quests: Quest[];
  frozen: number;
  badges: Unlock[];
  particles: Unlock[];
}

export interface Learner {
  level: string;
  placed_at: string | null;
  goal_minutes: number;
  strictness: number;
  voice: string | null;
  remind: boolean;
  remind_at: string;
  rest_weekday: number | null;
  paused_until: string | null;
  companion: string | null;
  /** Голос разговора (ENG-005): `chatgpt`, `elevenlabs`; `null` — сам. */
  voice_engine: string | null;
  realtime_model: string | null;
  realtime_voice: string | null;
}

export interface OverlayOp {
  id: string;
  op: string;
  lesson: string;
  summary: string;
  state: 'applied' | 'stale' | 'waiting';
}

export interface Home {
  learner: Learner;
  levels: Level[];
  steps: Step[];
  ops: OverlayOp[];
  next: string | null;
  review_due: number;
  game: Game;
}

export interface Delta {
  xp: number;
  xp_total: number;
  streak: number;
  streak_up: boolean;
  minutes: number;
  goal_minutes: number;
  ring_closed: boolean;
  quests_closed: boolean;
  unlocked: { kind: 'badge' | 'particle'; id: string; title: string }[];
}

export interface Answered {
  task_id: string;
  correct: boolean;
  attempts: number;
  right: string | null;
  explain_ru: string | null;
  say: string | null;
  mistakes: { wrong: string; right: string; why: string }[];
  heard: string | null;
  offline: boolean;
  game: Delta;
}

export interface Finished {
  passed: boolean;
  accuracy: number;
  spoken: number;
  need_accuracy: number;
  need_speak: number;
  missing: string[];
  review_ru: string | null;
  program_actions: string[];
  homework_task: string | null;
  game: Delta;
}

export interface Placement {
  level: string;
  start_lesson: string;
  stages: { level: string; right: number; passed: boolean }[];
}

export interface PlacementTest {
  about_ru: string;
  minutes: number;
  stages: { level: string; pass_min: number; items: Task[] }[];
}

export interface Voice {
  id: string;
  name: string;
  about: string;
}

export interface SettingsBody {
  settings: Learner;
  voices: Voice[];
  sample: string;
  /** Какой голос работает и сколько живого разговора сегодня (ENG-005). */
  engine?: components['schemas']['EnglishEngine'];
  realtime_models?: Voice[];
  realtime_voices?: { id: string; about: string }[];
}

export const ENGLISH_HOME = ['english', 'home'] as const;
const lessonKey = (id: string) => ['english', 'lesson', id] as const;

export function useEnglishHome() {
  return useQuery({
    queryKey: ENGLISH_HOME,
    queryFn: async () => (await must(api.GET('/api/v1/english/home'))) as unknown as Home,
    retry: false,
  });
}

export function usePlacementTest(enabled: boolean) {
  return useQuery({
    queryKey: ['english', 'placement'],
    queryFn: async () =>
      (await must(api.GET('/api/v1/english/placement'))) as unknown as PlacementTest,
    enabled,
    staleTime: Infinity,
  });
}

export function usePlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { answers: Record<string, unknown>; shift: number }) =>
      (await must(
        api.POST('/api/v1/english/placement', { body: body as never }),
      )) as unknown as Placement,
    onSuccess: () => qc.invalidateQueries({ queryKey: ENGLISH_HOME }),
  });
}

export function useLesson(id: string | null) {
  return useQuery({
    queryKey: lessonKey(id ?? ''),
    queryFn: async () =>
      (await must(
        api.GET('/api/v1/english/lessons/{id}', { params: { path: { id: id! } } }),
      )) as unknown as LessonView,
    enabled: id !== null && id !== 'review',
    retry: false,
  });
}

export async function startRun(lesson: string, kind: Run['kind']): Promise<Run> {
  return (await must(
    api.POST('/api/v1/english/lessons/{id}/start', {
      params: { path: { id: lesson } },
      body: { kind },
    }),
  )) as unknown as Run;
}

/** Ответ: значение с экрана или запись голоса. */
export type Reply = { value: unknown } | { audio: Blob; ms: number };

export async function sendAnswer(
  run: string,
  task: string,
  reply: Reply,
  lesson: string | null,
): Promise<Answered> {
  const key = crypto.randomUUID();
  const body =
    'value' in reply
      ? { key, task_id: task, lesson_id: lesson, answer: reply.value }
      : {
          key,
          task_id: task,
          lesson_id: lesson,
          audio_base64: toBase64(new Uint8Array(await reply.audio.arrayBuffer())),
          mime: reply.audio.type || 'audio/webm',
          duration_ms: Math.round(reply.ms),
        };
  return (await must(
    api.POST('/api/v1/english/runs/{id}/answer', {
      params: { path: { id: run } },
      body: body as never,
    }),
  )) as unknown as Answered;
}

export async function finishRun(run: string): Promise<Finished> {
  return (await must(
    api.POST('/api/v1/english/runs/{id}/finish', { params: { path: { id: run } } }),
  )) as unknown as Finished;
}

export async function askNate(lesson: string, text: string): Promise<string> {
  const r = (await must(
    api.POST('/api/v1/english/lessons/{id}/ask', {
      params: { path: { id: lesson } },
      body: { text },
    }),
  )) as unknown as { say: string };
  return r.say;
}

/** Отметка у задания (ENG-006): слишком легко / трудно / ошибка в задании. */
export type Mark = 'easy' | 'hard' | 'broken';

export async function markTask(
  run: string,
  task: string,
  kind: Mark,
  lesson: string | null,
  note?: string,
): Promise<{ action: string; summary_ru: string }> {
  return (await must(
    api.POST('/api/v1/english/runs/{id}/feedback', {
      params: { path: { id: run } },
      body: { task_id: task, lesson_id: lesson, kind, note: note || null },
    }),
  )) as unknown as { action: string; summary_ru: string };
}

export function useAdapt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await must(api.POST('/api/v1/english/program/adapt'))) as unknown as {
        summary_ru: string | null;
        actions: string[];
      },
    onSuccess: () => qc.invalidateQueries({ queryKey: ENGLISH_HOME }),
  });
}

export function useEnglishSettings() {
  return useQuery({
    queryKey: ['english', 'settings'],
    queryFn: async () =>
      (await must(api.GET('/api/v1/english/settings'))) as unknown as SettingsBody,
    retry: false,
  });
}

export function useChangeSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (change: Partial<Record<string, unknown>>) =>
      (await must(
        api.PATCH('/api/v1/english/settings', { body: change as never }),
      )) as unknown as SettingsBody,
    onSuccess: (s) => {
      qc.setQueryData(['english', 'settings'], s);
      void qc.invalidateQueries({ queryKey: ENGLISH_HOME });
      // Голос разговора мог смениться (ENG-005) — «Разговор» перечитает экран.
      void qc.invalidateQueries({ queryKey: ['english'], exact: true });
    },
  });
}

/** Голос фразы урока (или образец голоса). Готовую сервер отдаёт бесплатно. */
export async function fetchPhrase(text: string, voice?: string): Promise<Blob> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const csrf = csrfFromCookie();
  if (csrf) headers[CSRF_HEADER] = csrf;
  const r = await fetch('/api/v1/english/phrase', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(voice ? { text, voice } : { text }),
  });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Fail(e.error ?? `http_${r.status}`, e.message ?? 'Голос не получен', r.status);
  }
  return r.blob();
}
