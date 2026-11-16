/**
 * Неправильные глаголы (ENG-008): запросы к `/api/v1/english/verbs`. Тела — JSON из
 * `qubite_english::verbs` (в схеме — объект), типы — здесь. Сверку вписанных форм, срок
 * повторения, минуты и опыт считает сервер; сайт только показывает.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { must } from '../auth/client';
import type { Delta } from './english-lessons';
import { toBase64 } from './english-view';

/** Как глагол идёт у человека. */
export interface VerbProgress {
  /** Ещё ни разу не отвечал. */
  new: boolean;
  /** Пора повторять сегодня (новые — тоже). */
  due: boolean;
  hard: boolean;
  learned: boolean;
  reps: number;
  lapses: number;
  interval_days: number;
  /** `2026-11-16`; у нового — нет. */
  due_on: string | null;
}

export interface Verb {
  id: string;
  v1: string;
  /** Как показывать; запасные формы — в `v2_alt`. */
  v2: string;
  v3: string;
  v2_alt: string[];
  v3_alt: string[];
  ru: string;
  group: string;
  progress: VerbProgress;
}

/** Группа по звучанию: глаголы внутри меняются одинаково. */
export interface VerbGroup {
  id: string;
  title_ru: string;
  /** Пример: `sing – sang – sung`. */
  hint: string;
}

export interface VerbCounts {
  total: number;
  started: number;
  learned: number;
  due: number;
  hard: number;
}

/** Свой набор слов: добавлен списком или с фото. */
export interface VerbSet {
  id: string;
  title: string;
  source: 'photo' | 'text';
  verb_ids: string[];
  created_at: string;
}

/** Глагол, найденный в списке или на фото (ещё не сохранён). */
export interface VerbCandidate {
  v1: string;
  v2: string;
  v3: string;
  ru: string;
  /** Есть во встроенном наборе — его ID. */
  known: string | null;
}

export interface VerbsOverview {
  groups: VerbGroup[];
  verbs: Verb[];
  sets: VerbSet[];
  counts: VerbCounts;
  today: string;
}

/** Чем занимались: от этого зависит только опыт, срок повторения общий. */
export type VerbMode =
  'cards' | 'match' | 'quiz' | 'type' | 'anagram' | 'search' | 'speak' | 'sprint';

export type VerbGrade = 'again' | 'good' | 'easy';

/** Что-то одно: вписанные формы, сказанное, оценка карточки или «верно / неверно» игры. */
export type VerbReply =
  | { given: { v1?: string; v2: string; v3: string } }
  | { said: string }
  | { grade: VerbGrade }
  | { correct: boolean };

export interface VerbAnswered {
  verb_id: string;
  correct: boolean;
  expected: { v1: string; v2: string; v3: string };
  progress: VerbProgress;
  /** Срок повторения сдвинулся (иначе глагол ещё рано повторять). */
  moved: boolean;
  game: Delta;
}

export const ENGLISH_VERBS = ['english', 'verbs'] as const;

export function useEnglishVerbs() {
  return useQuery({
    queryKey: ENGLISH_VERBS,
    queryFn: async () => (await must(api.GET('/api/v1/english/verbs'))) as unknown as VerbsOverview,
    retry: false,
  });
}

export async function answerVerb(
  verb: string,
  mode: VerbMode,
  reply: VerbReply,
): Promise<VerbAnswered> {
  return (await must(
    api.POST('/api/v1/english/verbs/answer', {
      body: { verb_id: verb, mode, ...reply } as never,
    }),
  )) as unknown as VerbAnswered;
}

/** Найти глаголы в списке текстом (без AI) или на фото (AI-шлюз, бюджет). Ничего не сохраняет. */
export async function recognizeVerbs(
  from: { text: string } | { image: Blob },
): Promise<VerbCandidate[]> {
  const key = crypto.randomUUID();
  const body =
    'text' in from
      ? { key, text: from.text }
      : {
          key,
          image_base64: toBase64(new Uint8Array(await from.image.arrayBuffer())),
          mime: from.image.type || 'image/jpeg',
        };
  const r = (await must(
    api.POST('/api/v1/english/verbs/recognize', { body: body as never }),
  )) as unknown as { verbs: VerbCandidate[] };
  return r.verbs;
}

export async function createVerbSet(
  title: string,
  source: VerbSet['source'],
  verbs: readonly VerbCandidate[],
): Promise<VerbsOverview> {
  return (await must(
    api.POST('/api/v1/english/verbs/sets', {
      body: {
        title,
        source,
        verbs: verbs.map(({ v1, v2, v3, ru }) => ({ v1, v2, v3, ru })),
      },
    }),
  )) as unknown as VerbsOverview;
}

export async function deleteVerbSet(id: string): Promise<VerbsOverview> {
  return (await must(
    api.DELETE('/api/v1/english/verbs/sets/{id}', { params: { path: { id } } }),
  )) as unknown as VerbsOverview;
}

/** Длинная сторона фото перед отправкой, px: буквы читаются, а файл — сотни килобайт. */
const PHOTO_SIDE = 1600;
export const PHOTO_BYTES = 4 * 1024 * 1024;

/** Уменьшить фото до {@link PHOTO_SIDE} и сжать в JPEG. Не получилось — отдать как есть. */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const small = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    return small ?? file;
  } catch {
    return file;
  }
}
