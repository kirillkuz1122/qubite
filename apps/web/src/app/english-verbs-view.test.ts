import { describe, expect, it } from 'vitest';
import type { Verb, VerbProgress, VerbsOverview } from './english-verbs';
import {
  advance,
  daysWord,
  done,
  EMPTY_TALLY,
  formOk,
  groupStats,
  headline,
  line,
  pickSession,
  startQueue,
  stateLabel,
  tally,
  tone,
  whenLabel,
} from './english-verbs-view';

const TODAY = '2026-11-15';
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
const verb = (id: string, group: string, progress: Partial<VerbProgress> = {}): Verb => ({
  id,
  v1: id,
  v2: `${id}ed`,
  v3: `${id}en`,
  v2_alt: [],
  v3_alt: [],
  ru: 'перевод',
  group,
  progress: { ...NEW, ...progress },
});
const started = (over: Partial<VerbProgress>): Partial<VerbProgress> => ({
  new: false,
  due: false,
  reps: 1,
  interval_days: 1,
  due_on: '2026-11-16',
  ...over,
});

const VERBS: Verb[] = [
  verb('cut', 'same'),
  verb('put', 'same', started({ due: true, due_on: '2026-11-14' })),
  verb('sing', 'i-a-u', started({ due: true, hard: true, lapses: 1, due_on: TODAY })),
  verb('swim', 'i-a-u', started({ due: true, hard: true, lapses: 3, due_on: TODAY })),
  verb('ring', 'i-a-u', started({ due: true, due_on: '2026-11-10' })),
  verb('go', 'special', started({ learned: true, interval_days: 8, due_on: '2026-11-20' })),
  verb('be', 'special'),
];
const overview = (verbs: Verb[]): VerbsOverview => ({
  groups: [
    { id: 'same', title_ru: 'Все три одинаковые', hint: 'cut – cut – cut' },
    { id: 'i-a-u', title_ru: 'i → a → u', hint: 'sing – sang – sung' },
    { id: 'special', title_ru: 'Особенные', hint: 'go – went – gone' },
  ],
  verbs,
  counts: {
    total: verbs.length,
    started: verbs.filter((v) => !v.progress.new).length,
    learned: verbs.filter((v) => v.progress.learned).length,
    due: verbs.filter((v) => !v.progress.new && v.progress.due).length,
    hard: verbs.filter((v) => v.progress.hard).length,
  },
  today: TODAY,
});

describe('глаголы: что спрашивать', () => {
  it('сначала трудные (больше ошибок — раньше), потом «пора», потом новые по порядку набора', () => {
    expect(pickSession(VERBS)).toEqual({
      ids: ['swim', 'sing', 'ring', 'put', 'cut', 'be'],
      ahead: false,
    });
    expect(pickSession(VERBS, {}, 3).ids).toEqual(['swim', 'sing', 'ring']);
  });

  it('группа и «только трудные» сужают выбор', () => {
    expect(pickSession(VERBS, { group: 'same' }).ids).toEqual(['put', 'cut']);
    expect(pickSession(VERBS, { hard: true }).ids).toEqual(['swim', 'sing']);
    expect(pickSession(VERBS, { group: 'nope' })).toEqual({ ids: [], ahead: false });
  });

  it('повторять нечего — занятие впрок: те, чей срок ближе', () => {
    const later = [
      verb('go', 'special', started({ due_on: '2026-11-20' })),
      verb('do', 'special', started({ due_on: '2026-11-17' })),
    ];
    expect(pickSession(later)).toEqual({ ids: ['do', 'go'], ahead: true });
  });

  it('ошибся — глагол вернётся через три других, но не больше двух раз', () => {
    let q = startQueue(['a', 'b', 'c', 'd', 'e']);
    q = advance(q, false);
    expect(q.ids).toEqual(['a', 'b', 'c', 'd', 'a', 'e']);
    expect(q.at).toBe(1);
    q = advance(advance(advance(q, true), true), true);
    expect(q.ids[q.at]).toBe('a');
    q = advance(q, false);
    expect(q.ids).toEqual(['a', 'b', 'c', 'd', 'a', 'e', 'a']);
    q = advance(q, true);
    q = advance(q, false);
    expect(q.ids).toHaveLength(7);
    expect(done(q)).toBe(true);
    // В конце очереди возврат встаёт последним.
    expect(advance(startQueue(['x']), false).ids).toEqual(['x', 'x']);
    expect(advance(startQueue([]), true).at).toBe(0);
  });

  it('итог: «с первого раза» не считает глагол, на котором уже ошибся', () => {
    let t = tally(EMPTY_TALLY, 'go', false, 0);
    t = tally(t, 'go', true, 2);
    t = tally(t, 'be', true, 2);
    t = tally(t, 'go', false, 0);
    expect(t).toEqual({ clean: ['be'], missed: ['go'], xp: 4 });
  });
});

describe('глаголы: подписи', () => {
  it('состояние и срок', () => {
    expect(tone(NEW)).toBe('new');
    expect(tone({ ...NEW, ...started({ hard: true, due: true }) })).toBe('hard');
    expect(tone({ ...NEW, ...started({ due: true }) })).toBe('due');
    expect(tone({ ...NEW, ...started({ learned: true }) })).toBe('learned');
    expect(tone({ ...NEW, ...started({}) })).toBe('wait');
    expect(stateLabel({ ...NEW, ...started({ hard: true, lapses: 3 }) })).toBe(
      'трудный · ошибок: 3',
    );
    expect(whenLabel(NEW, TODAY)).toBe('новый');
    expect(whenLabel({ ...NEW, ...started({ due_on: '2026-11-13' }) }, TODAY)).toBe('сегодня');
    expect(whenLabel({ ...NEW, ...started({ due_on: '2026-11-16' }) }, TODAY)).toBe('завтра');
    expect(whenLabel({ ...NEW, ...started({ due_on: '2026-11-20' }) }, TODAY)).toBe('через 5 дней');
    expect([1, 2, 5, 11, 21, 22, 112].map(daysWord)).toEqual([
      '1 день',
      '2 дня',
      '5 дней',
      '11 дней',
      '21 день',
      '22 дня',
      '112 дней',
    ]);
  });

  it('группы: сколько выучено, пора и трудных', () => {
    const stats = groupStats(overview(VERBS));
    expect(
      stats.map((s) => [s.group.id, s.verbs.length, s.learned, s.started, s.due, s.hard]),
    ).toEqual([
      ['same', 2, 0, 1, 1, 0],
      ['i-a-u', 3, 0, 3, 3, 2],
      ['special', 2, 1, 1, 0, 0],
    ]);
  });

  it('главная строка', () => {
    expect(headline(overview([verb('cut', 'same')]))).toMatch(/^Начни с первой группы/);
    expect(headline(overview(VERBS))).toBe('Повторить сегодня: 4');
    const calm = [verb('go', 'special', started({})), verb('be', 'special')];
    expect(headline(overview(calm))).toBe('Повторять нечего — можно взять новые');
    expect(headline(overview([verb('go', 'special', started({}))]))).toBe(
      'На сегодня всё повторено',
    );
  });

  it('формы строкой и подсветка поля', () => {
    expect(line({ v1: 'go', v2: 'went', v3: 'gone' })).toBe('go – went – gone');
    expect(formOk(' Went ', 'went', [])).toBe(true);
    expect(formOk('gotten', 'got', ['gotten'])).toBe(true);
    expect(formOk('was, were', 'was/were', ['was', 'were'])).toBe(true);
    expect(formOk('', 'went', [])).toBe(false);
    expect(formOk('goed', 'went', [])).toBe(false);
  });
});
