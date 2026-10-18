import { describe, expect, it } from 'vitest';
import { parseCommand } from './command';

describe('разбор строки Command', () => {
  it('срок превращает запись в дело', () => {
    const r = parseCommand('завтра в 16:00 отбор по информатике');
    expect(r?.kind).toBe('task');
    expect(r?.when).toBe('завтра, 16:00');
    expect(r?.where).toBe('Planner');
  });

  it('глагол дела без срока — тоже дело', () => {
    expect(parseCommand('позвонить бабушке')).toMatchObject({ kind: 'task', when: null });
  });

  it('идея — мысль во «Входящие», без слова «идея»', () => {
    expect(parseCommand('идея: бот, который напоминает про дз')).toMatchObject({
      kind: 'thought',
      text: 'бот, который напоминает про дз',
    });
  });

  it('вопрос и «найти» — поиск', () => {
    expect(parseCommand('найти конспект про дерево Фенвика')?.kind).toBe('search');
    expect(parseCommand('что задали по физике?')?.kind).toBe('search');
  });

  it('дневник — только для себя', () => {
    expect(parseCommand('в дневник: сегодня решил задачу')).toMatchObject({
      kind: 'journal',
      text: 'сегодня решил задачу',
    });
  });

  it('команды с косой чертой', () => {
    expect(parseCommand('/д купить батарейки')).toMatchObject({
      kind: 'task',
      text: 'купить батарейки',
    });
    expect(parseCommand('/к дерево отрезков')?.kind).toBe('note');
  });

  it('пустая строка — ничего', () => {
    expect(parseCommand('   ')).toBeNull();
  });
});
