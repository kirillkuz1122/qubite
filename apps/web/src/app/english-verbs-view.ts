/**
 * Вкладка «Глаголы» (ENG-008): что показать и в каком порядке спрашивать — без React и сети.
 * Срок повторения считает сервер; здесь только выбор глаголов на занятие, очередь внутри
 * занятия («ошибся — спрошу ещё раз через пару глаголов») и подписи.
 */
import type { Verb, VerbGroup, VerbProgress, VerbsOverview } from './english-verbs';

/** Сколько глаголов в одном занятии. */
export const SESSION_SIZE = 10;
/** Через сколько глаголов вернуть тот, на котором ошибся. */
export const RETRY_GAP = 3;
/** Сколько раз за занятие возвращать один и тот же глагол. */
export const MAX_RETRIES = 2;

/** Какие глаголы берём: все, одну группу или только трудные. */
export interface Scope {
  group?: string | null;
  hard?: boolean;
}

export interface Picked {
  ids: string[];
  /** Повторять сегодня нечего — занятие «впрок»: срок оно не двигает. */
  ahead: boolean;
}

function inScope(v: Verb, scope: Scope): boolean {
  if (scope.group && v.group !== scope.group) return false;
  return !scope.hard || v.progress.hard;
}

const byDue = (a: Verb, b: Verb) =>
  (a.progress.due_on ?? '').localeCompare(b.progress.due_on ?? '');

/**
 * Глаголы на занятие: сначала трудные, которые пора повторять, потом остальные «пора», потом
 * новые — в порядке набора, то есть группами по звучанию. Нечего повторять — те, чей срок ближе.
 */
export function pickSession(
  verbs: readonly Verb[],
  scope: Scope = {},
  size = SESSION_SIZE,
): Picked {
  const pool = verbs.filter((v) => inScope(v, scope));
  const started = pool.filter((v) => !v.progress.new && v.progress.due);
  const hard = started
    .filter((v) => v.progress.hard)
    .sort((a, b) => b.progress.lapses - a.progress.lapses || byDue(a, b));
  const due = started.filter((v) => !v.progress.hard).sort(byDue);
  const fresh = pool.filter((v) => v.progress.new);
  const now = [...hard, ...due, ...fresh].slice(0, size);
  if (now.length > 0) return { ids: now.map((v) => v.id), ahead: false };
  const later = [...pool].sort(byDue).slice(0, size);
  return { ids: later.map((v) => v.id), ahead: later.length > 0 };
}

/** Очередь занятия. `tries` — сколько раз глагол уже возвращали. */
export interface Queue {
  ids: string[];
  at: number;
  tries: Record<string, number>;
}

export function startQueue(ids: readonly string[]): Queue {
  return { ids: [...ids], at: 0, tries: {} };
}

/**
 * Дальше по очереди. Ошибся — глагол вернётся через пару других (не больше двух раз за занятие):
 * так он успевает забыться, но занятие не превращается в зубрёжку одного слова.
 */
export function advance(q: Queue, correct: boolean): Queue {
  const id = q.ids[q.at];
  if (id === undefined) return q;
  const ids = [...q.ids];
  const tries = { ...q.tries };
  const used = tries[id] ?? 0;
  if (!correct && used < MAX_RETRIES) {
    tries[id] = used + 1;
    ids.splice(Math.min(q.at + 1 + RETRY_GAP, ids.length), 0, id);
  }
  return { ids, at: q.at + 1, tries };
}

export function done(q: Queue): boolean {
  return q.at >= q.ids.length;
}

/** Состояние глагола одним словом — для точки и подписи. */
export type Tone = 'new' | 'hard' | 'due' | 'learned' | 'wait';

export function tone(p: VerbProgress): Tone {
  if (p.new) return 'new';
  if (p.hard) return 'hard';
  if (p.due) return 'due';
  return p.learned ? 'learned' : 'wait';
}

const DAY = 24 * 60 * 60 * 1000;

function daysUntil(day: string, today: string): number {
  return Math.round((Date.parse(day) - Date.parse(today)) / DAY);
}

/** «2 дня», «5 дней», «21 день». */
export function daysWord(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return `${n} дней`;
  if (ones === 1) return `${n} день`;
  return ones >= 2 && ones <= 4 ? `${n} дня` : `${n} дней`;
}

/** Когда повторять: «новый», «сегодня», «завтра», «через 5 дней». */
export function whenLabel(p: VerbProgress, today: string): string {
  if (p.new || !p.due_on) return 'новый';
  const days = daysUntil(p.due_on, today);
  if (days <= 0) return 'сегодня';
  return days === 1 ? 'завтра' : `через ${daysWord(days)}`;
}

/** Подпись под глаголом: перевод и что с ним. */
export function stateLabel(p: VerbProgress): string {
  switch (tone(p)) {
    case 'new':
      return 'ещё не учил';
    case 'hard':
      return p.lapses > 1 ? `трудный · ошибок: ${p.lapses}` : 'трудный';
    case 'due':
      return 'пора повторить';
    case 'learned':
      return 'выучен';
    default:
      return 'учится';
  }
}

export interface GroupStat {
  group: VerbGroup;
  verbs: Verb[];
  learned: number;
  started: number;
  /** Начатые, которые пора повторять сегодня. */
  due: number;
  hard: number;
}

export function groupStats(o: VerbsOverview): GroupStat[] {
  return o.groups.map((group) => {
    const verbs = o.verbs.filter((v) => v.group === group.id);
    const count = (ok: (p: VerbProgress) => boolean) => verbs.filter((v) => ok(v.progress)).length;
    return {
      group,
      verbs,
      learned: count((p) => p.learned),
      started: count((p) => !p.new),
      due: count((p) => !p.new && p.due),
      hard: count((p) => p.hard),
    };
  });
}

/** Главная строка карточки «сегодня». */
export function headline(o: VerbsOverview): string {
  const { counts } = o;
  if (counts.started === 0) return 'Начни с первой группы — в ней ничего не меняется';
  if (counts.due > 0) return `Повторить сегодня: ${counts.due}`;
  if (counts.started < counts.total) return 'Повторять нечего — можно взять новые';
  return 'На сегодня всё повторено';
}

/** `go – went – gone`. */
export function line(v: Pick<Verb, 'v1' | 'v2' | 'v3'>): string {
  return `${v.v1} – ${v.v2} – ${v.v3}`;
}

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z']+/g, ' ')
    .trim();

/** Совпала ли вписанная форма — только чтобы подсветить поле; оценку ставит сервер. */
export function formOk(given: string, main: string, alt: readonly string[]): boolean {
  const g = clean(given);
  return g !== '' && [main, ...alt].some((f) => clean(f) === g);
}

/** Итог занятия. */
export interface Tally {
  /** Глаголы, отвеченные верно с первого раза. */
  clean: string[];
  /** Глаголы, на которых была ошибка. */
  missed: string[];
  xp: number;
}

export const EMPTY_TALLY: Tally = { clean: [], missed: [], xp: 0 };

export function tally(t: Tally, verb: string, correct: boolean, xp: number): Tally {
  const seen = t.clean.includes(verb) || t.missed.includes(verb);
  return {
    clean: correct && !seen ? [...t.clean, verb] : t.clean,
    missed: !correct && !t.missed.includes(verb) ? [...t.missed, verb] : t.missed,
    xp: t.xp + xp,
  };
}
