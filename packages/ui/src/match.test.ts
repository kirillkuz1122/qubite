import { describe, expect, it } from 'vitest';
import { fixLayout, matchScore, normalize } from './match';

describe('поиск Command по началам слов', () => {
  it('начало слова находит, середина короткого запроса — нет', () => {
    expect(matchScore('нас', 'Настройки')).toBeGreaterThan(0);
    expect(matchScore('рой', 'Настройки')).toBeGreaterThan(0); // 3+ буквы — внутри слова тоже
    expect(matchScore('ро', 'Настройки')).toBe(0);
  });

  it('все слова запроса должны найтись', () => {
    expect(matchScore('алг 214', 'Алгебра: № 214–220')).toBeGreaterThan(0);
    expect(matchScore('алг физика', 'Алгебра: № 214–220')).toBe(0);
  });

  it('ключевые слова тоже ищутся', () => {
    expect(matchScore('планер', 'Planner', ['планер', 'дела'])).toBeGreaterThan(0);
  });

  it('ё и е — одно и то же, регистр не важен', () => {
    expect(matchScore('темная', 'Тёмная тема')).toBeGreaterThan(0);
    expect(normalize('Ёлка, ЁЖ!')).toBe('елка еж');
  });

  it('точное и начальное совпадение выше частичного', () => {
    expect(matchScore('docs', 'Docs')).toBeGreaterThan(matchScore('doc', 'Docs'));
    expect(matchScore('тема', 'Тема')).toBeGreaterThan(matchScore('тема', 'Светлая тема'));
  });

  it('забытая раскладка: «yfcnhjqrb» — это «настройки»', () => {
    expect(fixLayout('yfcnhjqrb')).toBe('настройки');
    expect(matchScore('yfcn', 'Настройки')).toBeGreaterThan(0);
    expect(matchScore('yfcn', 'Настройки')).toBeLessThan(matchScore('нас', 'Настройки'));
  });

  it('пустой запрос ничего не находит', () => {
    expect(matchScore('  ', 'Настройки')).toBe(0);
  });
});
