/**
 * Неправильные глаголы (ENG-008): запросы к `/api/v1/english/verbs`. Тела — JSON из
 * `qubite_english::verbs` (в схеме — объект), типы — здесь. Сверку вписанных форм, срок
 * повторения, минуты и опыт считает сервер; сайт только показывает.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { must } from '../auth/client';
import type { Delta } from './english-lessons';

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

export interface VerbsOverview {
  groups: VerbGroup[];
  verbs: Verb[];
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
