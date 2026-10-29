import { describe, expect, it } from 'vitest';
import type { Run, Task } from './english-lessons';
import {
  answerBar,
  consecutiveEasy,
  harderFirst,
  microphoneFallback,
  runTasks,
} from './english-lessons-view';

const task = (over: Partial<Task>): Task => ({ id: 't1', type: 'translate', ask_ru: '?', ...over });

describe('полоса урока', () => {
  it('пустой ответ нельзя проверить; готовый можно; во время запроса ждём', () => {
    const t = task({});
    expect(answerBar(t, false, false, false)).toEqual({ action: 'check', disabled: true });
    expect(answerBar(t, false, true, false)).toEqual({ action: 'check', disabled: false });
    expect(answerBar(t, false, true, true)).toEqual({ action: 'check', disabled: true });
  });

  it('после верного и неверного ответа полоса предлагает «Дальше»', () => {
    expect(answerBar(task({}), true, false, false)).toEqual({ action: 'next', disabled: false });
    expect(answerBar(task({}), true, true, true)).toEqual({ action: 'next', disabled: true });
  });

  it.each([
    task({ type: 'choose', options: ['yes', 'no'] }),
    task({ type: 'listen', options: ['yes', 'no'] }),
    task({ type: 'fill', options: ['am', 'is'] }),
    task({ type: 'match' }),
  ])('варианты и пары отправляются сразу: $type', (t) => {
    expect(answerBar(t, false, false, false).action).toBe('wait');
    expect(answerBar(t, true, false, false).action).toBe('next');
  });

  it('«на слух» без вариантов и сборка фразы ждут проверки', () => {
    expect(answerBar(task({ type: 'listen' }), false, true, false).action).toBe('check');
    expect(answerBar(task({ type: 'build' }), false, true, false).action).toBe('check');
  });
});

describe('легко подряд', () => {
  it('нужны два разных соседних задания с отметкой', () => {
    expect(consecutiveEasy([])).toBe(0);
    expect(consecutiveEasy(['easy'])).toBe(1);
    expect(consecutiveEasy(['easy', 'easy'])).toBe(2);
    expect(consecutiveEasy(['easy', null, 'easy'])).toBe(1);
    expect(consecutiveEasy(['easy', 'hard', 'easy'])).toBe(1);
    expect(consecutiveEasy(['easy', 'broken'])).toBe(0);
  });

  it('по согласию сложные идут первыми из оставшихся, ни одно не пропадает', () => {
    const list = [
      { task: task({ id: 'done', type: 'choose' }) },
      { task: task({ id: 'now', type: 'choose' }) },
      { task: task({ id: 'simple', type: 'choose' }) },
      { task: task({ id: 'hard', type: 'roleplay' }) },
      { task: task({ id: 'middle', type: 'build' }) },
    ];
    const ordered = harderFirst(list, 2);
    expect(ordered.map((i) => i.task.id)).toEqual(['done', 'now', 'hard', 'middle', 'simple']);
    expect(ordered).toHaveLength(list.length);
    expect(list[2]!.task.id).toBe('simple');
  });
});

describe('микрофон недоступен', () => {
  it('голосовое задание заменяется, а voice_or_text остаётся текстовым', () => {
    expect(microphoneFallback(task({ type: 'speak', mode: 'repeat' }))).toBe('replace');
    expect(microphoneFallback(task({ type: 'speak', answer_by: 'voice_or_text' }))).toBe('text');
    expect(microphoneFallback(task({ type: 'roleplay', answer_by: 'voice' }))).toBe('replace');
  });

  it('сохранённая сервером замена используется при продолжении и не смешивает уроки', () => {
    const replacement = task({ id: 't1', type: 'build', answer_by: 'text' });
    const original = task({ id: 't1', type: 'speak', mode: 'repeat' });
    const run: Run = {
      id: 'run',
      lesson_id: 'review',
      kind: 'review',
      answers: [],
      tasks: [
        { lesson_id: 'one', task: original, wrong: '' },
        { lesson_id: 'two', task: original, wrong: '' },
      ],
      replacements: [{ lesson_id: 'one', task: replacement }],
    };
    const list = runTasks(null, run);
    expect(list[0]!.task).toEqual(replacement);
    expect(list[1]!.task).toEqual(original);
  });
});
