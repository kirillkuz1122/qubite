import { describe, expect, it } from 'vitest';
import { dayLabel, isoWeek, plural, weekLabel, weekday } from './data';
import { buildWeek } from './planner-view';
import { initialState, reducer } from './state';

/* воскресенье, 18 октября 2026 */
const SUNDAY = new Date(2026, 9, 18, 10, 30);

describe('даты и числа оболочки', () => {
  it('неделя — с понедельника, «сегодня» — настоящий день', () => {
    const week = buildWeek([], [], SUNDAY);
    expect(week.map((d) => d.d)).toEqual(['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']);
    expect(week.map((d) => d.n)).toEqual([12, 13, 14, 15, 16, 17, 18]);
    expect(week.findIndex((d) => d.today)).toBe(6);
    expect(weekday(SUNDAY)).toBe(6);
  });

  it('подписи дат по-русски', () => {
    expect(dayLabel(SUNDAY, false)).toBe('воскресенье, 18 октября');
    expect(dayLabel(SUNDAY, true)).toBe('вс, 18 октября');
    expect(weekLabel(buildWeek([], [], SUNDAY))).toBe('12–18 октября');
    expect(weekLabel(buildWeek([], [], new Date(2026, 9, 1)))).toBe('28 сентября – 4 октября');
    expect(isoWeek(SUNDAY)).toBe(42);
  });

  it('русские числа', () => {
    expect([1, 2, 5, 11, 21, 24].map((n) => plural(n, 'мысль', 'мысли', 'мыслей'))).toEqual([
      'мысль',
      'мысли',
      'мыслей',
      'мыслей',
      'мысль',
      'мысли',
    ]);
  });
});

describe('состояние оболочки', () => {
  it('конспект становится документом, помощника можно спрятать', () => {
    let s = initialState();
    s = reducer(s, { type: 'doc.add', name: 'Графы' });
    expect(s.docs[0]!.name).toBe('Графы');
    s = reducer(s, { type: 'helper', kind: 'elik', on: false });
    expect(s.helpers.elik).toBe(false);
  });
});
