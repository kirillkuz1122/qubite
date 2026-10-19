import { describe, expect, it } from 'vitest';
import { parseCommand } from './command';
import { localNowFromIso } from './parse';

const now = localNowFromIso('2026-10-19T13:00')!;

describe('разбор строки Command', () => {
  it('срок превращает запись в дело', () => {
    const r = parseCommand('завтра в 16:00 отбор по информатике', now);
    expect(r?.kind).toBe('task');
    expect(r?.when).toBe('завтра, 16:00');
    expect(r?.where).toBe('Planner — дело');
    // не уверен — черновик во «Входящих» (CMD-003)
    expect(parseCommand('напомни про графы', now)?.where).toBe('Входящие — черновик дела');
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

  it('карточка: что понял — срок, длительность, проект, важность', () => {
    const r = parseCommand('завтра в 18 решить №214 на 30 мин #алгебра !!', now);
    expect(r).toMatchObject({
      title: 'Дело',
      text: 'решить №214',
      details: ['завтра, 18:00', '30 мин', '#алгебра', '!!'],
      review: null,
    });
  });

  it('названия: напоминание, покупка, конспект, закладка', () => {
    expect(parseCommand('напомни в пятницу сдать эссе', now)?.title).toBe('Напоминание');
    expect(parseCommand('купить хлеб', now)?.title).toBe('Покупка');
    expect(parseCommand('конспект графы', now)?.title).toBe('Конспект');
    expect(parseCommand('https://habr.com/x', now)).toMatchObject({
      kind: 'bookmark',
      title: 'Закладка',
      text: 'https://habr.com/x',
    });
  });

  it('не уверен — «посмотри сам» прямо в карточке', () => {
    expect(parseCommand('напомни про графы', now)?.review).toBe('Когда напомнить? Срок не нашёл');
  });
});
