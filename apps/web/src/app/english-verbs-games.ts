/**
 * Игры с неправильными глаголами (ENG-008, D-899): что показать в каждой игре — без React и сети.
 * Всё случайное идёт от строки-зерна: один и тот же раунд рисуется одинаково при перерисовке, а
 * тесты проверяют конкретные раскладки. Верно или нет — решает игра, в повторение пишет сервер.
 */
import type { Verb } from './english-verbs';
import { shuffle } from './english-lessons-view';
import { pickSession, type Scope } from './english-verbs-view';

export type Game = 'match' | 'quiz' | 'sprint' | 'anagram' | 'search';

export const GAMES: { id: Game; title: string; about: string; size: number }[] = [
  { id: 'match', title: 'Соедини', about: 'первая форма и её пара', size: 6 },
  { id: 'quiz', title: 'Викторина', about: 'какая форма верная', size: 10 },
  { id: 'sprint', title: 'На время', about: 'минута: верно или нет', size: 20 },
  { id: 'anagram', title: 'Анаграмма', about: 'собери форму из букв', size: 8 },
  { id: 'search', title: 'Поиск слов', about: 'найди формы в таблице букв', size: 5 },
];

/** Сколько секунд идёт игра «На время». */
export const SPRINT_SECONDS = 60;
/** Сторона таблицы букв. */
export const GRID = 7;

/** Случайные числа от строки (одинаковые при том же зерне). */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const byDue = (a: Verb, b: Verb) =>
  (a.progress.due_on ?? '').localeCompare(b.progress.due_on ?? '');

/**
 * Глаголы для игры: те, что пора повторять (трудные первыми), потом остальные начатые — игра
 * закрепляет уже знакомое. Новые — только если начатых не хватает.
 */
export function pickGame(verbs: readonly Verb[], scope: Scope, size: number): string[] {
  const pool = verbs.filter(
    (v) => (!scope.group || v.group === scope.group) && (!scope.ids || scope.ids.includes(v.id)),
  );
  const started = pool.filter((v) => !v.progress.new);
  const due = pickSession(started, {}, size).ids;
  const rest = started.filter((v) => !due.includes(v.id)).sort(byDue);
  const fresh = pool.filter((v) => v.progress.new);
  return [...due, ...rest.map((v) => v.id), ...fresh.map((v) => v.id)].slice(0, size);
}

/** Одна форма для игры: буквы без вариантов (`was/were` → `was`). */
export function plain(form: string): string {
  return (form.split('/')[0] ?? form).trim().toLowerCase();
}

/** Какую форму спрашивать: вторую или третью. Одинаковую с первой — только если других нет. */
export function askForm(verb: Verb, seed: string): 'v2' | 'v3' {
  const differs = (['v2', 'v3'] as const).filter((f) => plain(verb[f]) !== verb.v1);
  const from = differs.length > 0 ? differs : (['v2', 'v3'] as const);
  return from[Math.floor(seeded(seed)() * from.length)] ?? 'v2';
}

/** «Как у правильных»: go → goed, make → maked, cut → cutted — типичная ошибка. */
export function regular(v1: string): string {
  if (v1.endsWith('e')) return `${v1}d`;
  if (/[^aeiou][aeiou][^aeiouwxy]$/.test(v1)) return `${v1}${v1.at(-1)}ed`;
  return v1.endsWith('y') && !/[aeiou]y$/.test(v1) ? `${v1.slice(0, -1)}ied` : `${v1}ed`;
}

function accepted(verb: Verb, form: 'v2' | 'v3'): string[] {
  return [verb[form], ...(form === 'v2' ? verb.v2_alt : verb.v3_alt)].flatMap((f) =>
    f.split('/').map((x) => x.trim().toLowerCase()),
  );
}

/** Неверные варианты формы: «как у правильных», другая форма, формы соседей по группе. */
export function distractors(
  verb: Verb,
  form: 'v2' | 'v3',
  all: readonly Verb[],
  seed: string,
): string[] {
  const right = accepted(verb, form);
  const other = form === 'v2' ? 'v3' : 'v2';
  const near = shuffle(
    all.filter((v) => v.id !== verb.id && v.group === verb.group),
    `${seed}:near`,
  ).map((v) => plain(v[form]));
  const far = shuffle(
    all.filter((v) => v.id !== verb.id && v.group !== verb.group),
    `${seed}:far`,
  ).map((v) => plain(v[form]));
  const pool = [regular(verb.v1), plain(verb[other]), verb.v1, ...near, ...far];
  const out: string[] = [];
  for (const candidate of pool) {
    if (!right.includes(candidate) && !out.includes(candidate)) out.push(candidate);
    if (out.length === 3) break;
  }
  return out;
}

export interface Question {
  verb: string;
  form: 'v2' | 'v3';
  answer: string;
  options: string[];
}

/** Викторина: четыре варианта формы, один верный. */
export function question(verb: Verb, all: readonly Verb[], seed: string): Question {
  const form = askForm(verb, seed);
  const answer = plain(verb[form]);
  return {
    verb: verb.id,
    form,
    answer,
    options: shuffle([answer, ...distractors(verb, form, all, seed)], `${seed}:options`),
  };
}

export interface SprintCard {
  verb: string;
  v1: string;
  v2: string;
  v3: string;
  /** Формы на карточке верные. */
  right: boolean;
}

/** «На время»: три формы — верные или с одной подменённой. Примерно поровну. */
export function sprintCard(verb: Verb, all: readonly Verb[], seed: string): SprintCard {
  const card = { verb: verb.id, v1: verb.v1, v2: plain(verb.v2), v3: plain(verb.v3) };
  if (seeded(`${seed}:coin`)() < 0.5) return { ...card, right: true };
  const form = askForm(verb, seed);
  const wrong = distractors(verb, form, all, seed)[0];
  return wrong ? { ...card, [form]: wrong, right: false } : { ...card, right: true };
}

export interface Anagram {
  verb: string;
  form: 'v2' | 'v3';
  answer: string;
  /** Буквы вперемешку. */
  letters: string[];
}

/** Анаграмма: буквы формы вперемешку (не в правильном порядке, если так можно). */
export function anagram(verb: Verb, seed: string): Anagram {
  const form = askForm(verb, seed);
  const answer = plain(verb[form]).replace(/[^a-z]/g, '');
  let letters = shuffle([...answer], seed);
  for (let turn = 1; letters.join('') === answer && turn < 6; turn++) {
    letters = shuffle([...answer], `${seed}:${turn}`);
  }
  return { verb: verb.id, form, answer, letters };
}

/** Собранное слово верно: сама форма или её запасной вариант. */
export function anagramOk(verb: Verb, form: 'v2' | 'v3', built: string): boolean {
  return accepted(verb, form)
    .map((f) => f.replace(/[^a-z]/g, ''))
    .includes(built);
}

export type Cell = readonly [row: number, col: number];

export interface Placed {
  verb: string;
  word: string;
  cells: Cell[];
}

export interface WordGrid {
  /** Строки таблицы: буквы. */
  rows: string[][];
  placed: Placed[];
}

const LETTERS = 'abcdefghiklmnoprstuw';

/**
 * Таблица букв: формы спрятаны по горизонтали (слева направо) и по вертикали (сверху вниз),
 * пересекаться могут только на одинаковой букве. Слово, которому не нашлось места, пропускается.
 */
export function wordGrid(
  words: readonly { verb: string; word: string }[],
  seed: string,
  size = GRID,
): WordGrid {
  const rand = seeded(seed);
  const rows: string[][] = Array.from({ length: size }, () => Array<string>(size).fill(''));
  const placed: Placed[] = [];
  for (const { verb, word } of words) {
    if (word.length < 2 || word.length > size || !/^[a-z]+$/.test(word)) continue;
    for (let attempt = 0; attempt < 200; attempt++) {
      const down = rand() < 0.5;
      const row = Math.floor(rand() * (down ? size - word.length + 1 : size));
      const col = Math.floor(rand() * (down ? size : size - word.length + 1));
      const cells: Cell[] = [...word].map((_, i) => (down ? [row + i, col] : [row, col + i]));
      const free = cells.every(([r, c], i) => {
        const now = rows[r]?.[c];
        return now === '' || now === word[i];
      });
      if (!free) continue;
      cells.forEach(([r, c], i) => {
        rows[r]![c] = word[i]!;
      });
      placed.push({ verb, word, cells });
      break;
    }
  }
  for (const row of rows) {
    for (let c = 0; c < size; c++) {
      if (row[c] === '') row[c] = LETTERS[Math.floor(rand() * LETTERS.length)]!;
    }
  }
  return { rows, placed };
}

/** Клетки от первой до второй — если они в одной строке или столбце. */
export function lineCells(from: Cell, to: Cell): Cell[] | null {
  const [r1, c1] = from;
  const [r2, c2] = to;
  if (r1 !== r2 && c1 !== c2) return null;
  const length = Math.abs(r2 - r1) + Math.abs(c2 - c1) + 1;
  const dr = Math.sign(r2 - r1);
  const dc = Math.sign(c2 - c1);
  return Array.from({ length }, (_, i) => [r1 + dr * i, c1 + dc * i] as const);
}

/** Какое спрятанное слово выделено (в любую сторону) — или никакое. */
export function foundWord(grid: WordGrid, from: Cell, to: Cell): Placed | null {
  const same = (a: Cell | undefined, b: Cell) => !!a && a[0] === b[0] && a[1] === b[1];
  return (
    grid.placed.find(
      (p) =>
        (same(p.cells[0], from) && same(p.cells.at(-1), to)) ||
        (same(p.cells[0], to) && same(p.cells.at(-1), from)),
    ) ?? null
  );
}

/** Правая колонка «Соедини»: вторая и третья форма, вперемешку. */
export function matchRight(verbs: readonly Verb[], seed: string): { verb: string; text: string }[] {
  return shuffle(
    verbs.map((v) => ({ verb: v.id, text: `${v.v2} · ${v.v3}` })),
    seed,
  );
}

/** Пара верна: формы справа — этого глагола (или точно такие же у другого: cut и put — нет). */
export function matchOk(verbs: readonly Verb[], left: string, right: string): boolean {
  const text = (id: string) => {
    const v = verbs.find((x) => x.id === id);
    return v ? `${v.v2} · ${v.v3}` : null;
  };
  return left === right || (text(left) !== null && text(left) === text(right));
}
