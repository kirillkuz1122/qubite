import { describe, expect, it } from 'vitest';
import type { Lesson, Level, Run, Step, Task } from './english-lessons';
import {
  byModule,
  days,
  gaps,
  resumeAt,
  ring,
  runTasks,
  shuffle,
  theory,
  tiles,
} from './english-lessons-view';

const task = (over: Partial<Task>): Task => ({ id: 't1', type: 'choose', ask_ru: '?', ...over });

describe('уроки английского: экран', () => {
  it('плитки — слова ответа и лишние, перемешаны одинаково при перерисовке', () => {
    const t = task({ id: 't4', type: 'build', answer: "What's your name?", extra: ['my', 'you'] });
    const a = tiles(t);
    expect([...a].sort()).toEqual(["What's", 'my', 'name?', 'you', 'your'].sort());
    expect(tiles(t)).toEqual(a);
    expect(shuffle([1, 2, 3, 4, 5], 'x')).toHaveLength(5);
  });

  it('пропуски и кольцо дня', () => {
    expect(gaps('My name ___ Anna.')).toEqual(['My name ', ' Anna.']);
    expect(ring({ minutes_today: 5, goal_minutes: 10 })).toBe(0.5);
    expect(ring({ minutes_today: 30, goal_minutes: 10 })).toBe(1);
  });

  it('дни по-русски', () => {
    expect(days(1)).toBe('1 день');
    expect(days(3)).toBe('3 дня');
    expect(days(11)).toBe('11 дней');
    expect(days(22)).toBe('22 дня');
  });

  it('теория на языке уровня', () => {
    const lesson = {
      grammar: { explain_ru: 'по-русски', explain_en: 'in English' },
    } as Lesson;
    const level = (mode: Level['tutor_mode']) => ({ tutor_mode: mode }) as Level;
    expect(theory(lesson, level('ru_heavy'))).toEqual({ main: 'по-русски', second: null });
    expect(theory(lesson, level('ru_support'))).toEqual({
      main: 'по-русски',
      second: 'in English',
    });
    expect(theory(lesson, level('en_simple'))).toEqual({ main: 'in English', second: 'по-русски' });
  });

  it('продолжить с первого не решённого; повторение — задания разных уроков', () => {
    const lesson = { tasks: [task({ id: 't1' }), task({ id: 't2' })] } as Lesson;
    const run: Run = {
      id: 'r',
      lesson_id: 'a0-m1-l1',
      kind: 'lesson',
      answers: [{ task_id: 't1', lesson_id: 'a0-m1-l1', correct: true, attempts: 1 }],
      tasks: [],
    };
    const list = runTasks(lesson, run);
    expect(resumeAt(run, list)).toBe(1);
    const review: Run = {
      ...run,
      kind: 'review',
      answers: [],
      tasks: [{ lesson_id: 'a0-m2-l1', task: task({ id: 't5' }), wrong: 'am' }],
    };
    expect(runTasks(null, review)[0]!.lesson).toBe('a0-m2-l1');
  });

  it('путь урока по модулям', () => {
    const s = (id: string, module: string): Step =>
      ({ id, level: 'a0', module, module_title_ru: module }) as Step;
    const groups = byModule([s('1', 'm1'), s('2', 'm1'), s('3', 'm2')], 'a0');
    expect(groups.map((g) => g.steps.length)).toEqual([2, 1]);
  });
});
