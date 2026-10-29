import { describe, expect, it } from 'vitest';
import type { Task } from './english-lessons';
import { matchReply, pairOk, pairsOk, type Pair } from './english-lessons-view';

const task: Task = {
  id: 'match',
  type: 'match',
  ask_ru: 'Соедини',
  pairs: [
    { en: 'hello', ru: 'привет' },
    { en: 'bye', ru: 'пока' },
    { en: 'name', ru: 'имя' },
  ],
};
const complete: Pair[] = [
  ['name', 'имя'],
  ['hello', 'привет'],
  ['bye', 'пока'],
];

describe('мгновенная проверка пары', () => {
  it('оценивает одну пару до заполнения остальных', () => {
    expect(pairOk(task, ['hello', 'привет'])).toBe(true);
    expect(pairOk(task, ['hello', 'пока'])).toBe(false);
    expect(pairOk(task, ['unknown', 'привет'])).toBe(false);
    expect(pairOk(task, ['привет', 'hello'])).toBe(false);
    expect(pairOk({ ...task, pairs: [] }, ['hello', 'привет'])).toBe(false);
  });

  it('без ошибок отправляет все правильные пары', () => {
    expect(matchReply(complete, null)).toEqual(complete);
    expect(pairsOk(task, matchReply(complete, null))).toEqual([true, true, true]);
  });

  it('сохраняет реальную ошибку при подборе, не меняя исходный набор', () => {
    const reply = matchReply(complete, ['hello', 'пока']);
    expect(reply).toEqual([
      ['name', 'имя'],
      ['hello', 'пока'],
      ['bye', 'пока'],
    ]);
    expect(pairsOk(task, reply)).toEqual([true, false, true]);
    expect(complete[1]).toEqual(['hello', 'привет']);
    // Как course::check: столько же пар и каждая исходная пара присутствует.
    const accepted =
      reply.length === task.pairs!.length &&
      task.pairs!.every((p) => reply.some(([en, ru]) => en === p.en && ru === p.ru));
    expect(accepted).toBe(false);
    // «Ещё раз» сохраняет только действительно верные пары, оставляя одну свободной.
    expect(reply.filter((pair) => pairOk(task, pair))).toHaveLength(2);
  });
});
