import { describe, expect, it } from 'vitest';
import type { Lesson, Level, Run, Step, Task } from './english-lessons';
import {
  answerBy,
  byModule,
  days,
  explainAsk,
  fixHint,
  gaps,
  kindLabel,
  matchRight,
  optionState,
  pairsOk,
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

  it('«Соедини»: правые слова перемешаны, каждая пара сверяется отдельно', () => {
    const t = task({
      type: 'match',
      pairs: [
        { en: 'hello', ru: 'привет' },
        { en: 'bye', ru: 'пока' },
        { en: 'name', ru: 'имя' },
      ],
    });
    expect([...matchRight(t)].sort()).toEqual(['имя', 'пока', 'привет']);
    expect(matchRight(t)).toEqual(matchRight(t));
    expect(
      pairsOk(t, [
        ['hello', 'привет'],
        ['bye', 'имя'],
      ]),
    ).toEqual([true, false]);
  });

  it('вариант: выбран → верно / неверно, верный подсвечен после ошибки', () => {
    expect(optionState('a', 'a', null)).toBe('picked');
    expect(optionState('b', 'a', null)).toBeUndefined();
    expect(optionState('a', 'a', { correct: true, right: null })).toBe('ok');
    expect(optionState('a', 'a', { correct: false, right: 'b' })).toBe('bad');
    expect(optionState('b', 'a', { correct: false, right: 'b' })).toBe('ok');
    expect(optionState('c', 'a', { correct: false, right: 'b' })).toBeUndefined();
  });

  it('«объясни» — вопрос Нейту с заданием и правильным ответом', () => {
    const q = explainAsk(task({ ask_ru: 'Выбери.', question: 'Я Кирилл.' }), {
      correct: false,
      right: "I'm Kirill.",
    });
    expect(q).toContain('Я Кирилл.');
    expect(q).toContain("Правильно: I'm Kirill.");
  });

  it('способ ответа: текстом — написание, голосом или текстом — понимание и разговор', () => {
    expect(answerBy(task({ type: 'translate', from: 'ru' }))).toBe('text');
    expect(answerBy(task({ type: 'translate', from: 'en' }))).toBe('voice_or_text');
    expect(answerBy(task({ type: 'fill', text: 'I ___ ok' }))).toBe('text');
    expect(answerBy(task({ type: 'listen', audio: "I'm 14." }))).toBe('text');
    expect(answerBy(task({ type: 'speak', mode: 'repeat' }))).toBe('voice');
    expect(answerBy(task({ type: 'speak', mode: 'transform' }))).toBe('voice_or_text');
    expect(answerBy(task({ type: 'translate', from: 'en', answer_by: 'text' }))).toBe('text');
    expect(kindLabel(task({ type: 'speak', mode: 'transform' }))).toBe('Переделай фразу');
  });

  it('«исправь свою фразу» — что не так, без готового ответа', () => {
    const wrong = {
      correct: false,
      explain_ru: null,
      mistakes: [{ wrong: 'Did you watched', right: 'Did you watch', why: 'после did — без -ed' }],
    };
    expect(fixHint(wrong)).toEqual(['«Did you watched» — после did — без -ed']);
    expect(fixHint(wrong).join()).not.toContain('Did you watch»');
    expect(fixHint({ ...wrong, mistakes: [], explain_ru: 'Нужен глагол.' })).toEqual([
      'Нужен глагол.',
    ]);
    expect(fixHint({ ...wrong, correct: true })).toEqual([]);
    expect(fixHint(null)).toEqual([]);
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
