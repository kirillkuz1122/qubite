import { describe, expect, it } from 'vitest';
import type { Verb, VerbProgress } from './english-verbs';
import {
  anagram,
  anagramOk,
  askForm,
  distractors,
  foundWord,
  GRID,
  lineCells,
  matchOk,
  matchRight,
  pickGame,
  plain,
  question,
  regular,
  seeded,
  sprintCard,
  wordGrid,
} from './english-verbs-games';

const NEW: VerbProgress = {
  new: true,
  due: true,
  hard: false,
  learned: false,
  reps: 0,
  lapses: 0,
  interval_days: 0,
  due_on: null,
};
const verb = (
  v1: string,
  v2: string,
  v3: string,
  group: string,
  progress: Partial<VerbProgress> = {},
  alt: { v2?: string[]; v3?: string[] } = {},
): Verb => ({
  id: v1,
  v1,
  v2,
  v3,
  v2_alt: alt.v2 ?? [],
  v3_alt: alt.v3 ?? [],
  ru: 'перевод',
  group,
  progress: { ...NEW, ...progress },
});
const old = (due_on: string, over: Partial<VerbProgress> = {}): Partial<VerbProgress> => ({
  new: false,
  due: due_on <= '2026-11-16',
  reps: 1,
  interval_days: 1,
  due_on,
  ...over,
});

const ALL: Verb[] = [
  verb('sing', 'sang', 'sung', 'i-a-u', old('2026-11-20')),
  verb('swim', 'swam', 'swum', 'i-a-u', old('2026-11-16', { hard: true, lapses: 2 })),
  verb('ring', 'rang', 'rung', 'i-a-u'),
  verb('go', 'went', 'gone', 'special', old('2026-11-18')),
  verb('be', 'was/were', 'been', 'special', old('2026-11-15'), { v2: ['was', 'were'] }),
  verb('cut', 'cut', 'cut', 'same'),
  verb('put', 'put', 'put', 'same'),
  verb('get', 'got', 'got', 'special', {}, { v3: ['gotten'] }),
];
const by = (id: string) => ALL.find((v) => v.id === id)!;

describe('игры с глаголами: выбор и варианты', () => {
  it('в игру идут знакомые глаголы: «пора» (трудные первыми), начатые, новые — если не хватает', () => {
    expect(pickGame(ALL, {}, 4)).toEqual(['swim', 'be', 'go', 'sing']);
    expect(pickGame(ALL, {}, 6)).toEqual(['swim', 'be', 'go', 'sing', 'ring', 'cut']);
    expect(pickGame(ALL, { group: 'same' }, 6)).toEqual(['cut', 'put']);
    expect(pickGame(ALL, { ids: ['go', 'cut', 'nope'] }, 6)).toEqual(['go', 'cut']);
  });

  it('зерно даёт одни и те же числа', () => {
    const a = seeded('round-1');
    const b = seeded('round-1');
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
    expect(seeded('round-2')()).not.toBe(first[0]);
  });

  it('спрашиваем форму, которая отличается от первой; у cut — любую', () => {
    expect(plain('was/were')).toBe('was');
    for (const seed of ['a', 'b', 'c', 'd']) {
      expect(['v2', 'v3']).toContain(askForm(by('cut'), seed));
      expect(by('go')[askForm(by('go'), seed)]).not.toBe('go');
    }
    const come = verb('come', 'came', 'come', 'come');
    expect(['a', 'b', 'c', 'd'].map((seed) => askForm(come, seed))).toEqual([
      'v2',
      'v2',
      'v2',
      'v2',
    ]);
  });

  it('неверные варианты: «как у правильных», другая форма, соседи по группе; верных среди них нет', () => {
    expect([
      regular('go'),
      regular('make'),
      regular('cut'),
      regular('try'),
      regular('play'),
    ]).toEqual(['goed', 'maked', 'cutted', 'tried', 'played']);
    const wrong = distractors(by('sing'), 'v2', ALL, 'q1');
    expect(wrong).toHaveLength(3);
    expect(wrong.slice(0, 2)).toEqual(['singed', 'sung']);
    expect(wrong).not.toContain('sang');
    // Запасная форма — не «неверный вариант».
    expect(distractors(by('get'), 'v3', ALL, 'q2')).not.toContain('gotten');
    expect(distractors(by('be'), 'v2', ALL, 'q3')).not.toContain('were');
  });

  it('викторина: четыре разных варианта, верный среди них', () => {
    for (const v of ALL) {
      const q = question(v, ALL, `quiz:${v.id}`);
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(q.options).toContain(q.answer);
      expect(q.answer).toBe(plain(v[q.form]));
      expect(question(v, ALL, `quiz:${v.id}`)).toEqual(q);
    }
  });

  it('«на время»: карточка верная или с одной подменённой формой', () => {
    const cards = Array.from({ length: 40 }, (_, i) => sprintCard(by('go'), ALL, `s${i}`));
    const right = cards.filter((c) => c.right);
    expect(right.length).toBeGreaterThan(8);
    expect(right.length).toBeLessThan(32);
    for (const c of cards) {
      const same = c.v2 === 'went' && c.v3 === 'gone';
      expect(same).toBe(c.right);
      expect(c.v1).toBe('go');
    }
  });

  it('анаграмма: те же буквы в другом порядке; запасная форма годится', () => {
    for (const seed of ['a', 'b', 'c']) {
      const a = anagram(by('swim'), seed);
      expect([...a.letters].sort().join('')).toBe([...a.answer].sort().join(''));
      expect(a.letters.join('')).not.toBe(a.answer);
      expect(anagramOk(by('swim'), a.form, a.answer)).toBe(true);
    }
    expect(anagramOk(by('get'), 'v3', 'gotten')).toBe(true);
    expect(anagramOk(by('be'), 'v2', 'were')).toBe(true);
    expect(anagramOk(by('go'), 'v2', 'goed')).toBe(false);
  });
});

describe('игры с глаголами: поле', () => {
  it('таблица букв: слова лежат по строке или столбцу, не затирая друг друга', () => {
    const words = [
      { verb: 'sing', word: 'sang' },
      { verb: 'swim', word: 'swam' },
      { verb: 'go', word: 'went' },
      { verb: 'forget', word: 'forgotten' },
      { verb: 'be', word: 'was' },
    ];
    for (const seed of ['g1', 'g2', 'g3', 'g4', 'g5']) {
      const grid = wordGrid(words, seed);
      expect(grid.rows).toHaveLength(GRID);
      expect(grid.rows.every((r) => r.length === GRID && r.every((c) => /^[a-z]$/.test(c)))).toBe(
        true,
      );
      // Слово длиннее поля не помещается и пропускается.
      expect(grid.placed.map((p) => p.verb)).toEqual(['sing', 'swim', 'go', 'be']);
      for (const p of grid.placed) {
        expect(p.cells.map(([r, c]) => grid.rows[r]![c]).join('')).toBe(p.word);
        const first = p.cells[0]!;
        const last = p.cells.at(-1)!;
        expect(lineCells(first, last)).toEqual(p.cells);
        expect(foundWord(grid, first, last)).toBe(p);
        expect(foundWord(grid, last, first)).toBe(p);
      }
      expect(wordGrid(words, seed)).toEqual(grid);
    }
  });

  it('выделение: только прямая; чужие клетки — не слово', () => {
    expect(lineCells([1, 1], [1, 3])).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
    ]);
    expect(lineCells([3, 2], [1, 2])).toEqual([
      [3, 2],
      [2, 2],
      [1, 2],
    ]);
    expect(lineCells([0, 0], [2, 2])).toBeNull();
    const grid = wordGrid([{ verb: 'go', word: 'went' }], 'one');
    const [first, second] = grid.placed[0]!.cells;
    expect(foundWord(grid, first!, second!)).toBeNull();
  });

  it('«соедини»: пара верна для своего глагола и для глагола с такими же формами', () => {
    const six = [by('sing'), by('go'), by('cut'), by('put')];
    const right = matchRight(six, 'm1');
    expect(right.map((r) => r.verb).sort()).toEqual(['cut', 'go', 'put', 'sing']);
    expect(right.find((r) => r.verb === 'go')?.text).toBe('went · gone');
    expect(matchOk(six, 'go', 'go')).toBe(true);
    expect(matchOk(six, 'go', 'sing')).toBe(false);
    // У cut и put правые плитки разные (cut · cut и put · put).
    expect(matchOk(six, 'cut', 'put')).toBe(false);
  });
});
