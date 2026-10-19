import { describe, expect, it } from 'vitest';
import { dayLabel, isoWeek, makeWeek, plural, weekLabel, weekday } from './data';
import { initialState, reducer, todayIndex } from './state';

/* воскресенье, 18 октября 2026 */
const SUNDAY = new Date(2026, 9, 18, 10, 30);

describe('тестовые данные оболочки', () => {
  it('неделя — с понедельника, «сегодня» — настоящий день', () => {
    const week = makeWeek(SUNDAY);
    expect(week.map((d) => d.d)).toEqual(['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']);
    expect(week.map((d) => d.n)).toEqual([12, 13, 14, 15, 16, 17, 18]);
    expect(week.findIndex((d) => d.today)).toBe(6);
    /* прошедшие дни уже сделаны */
    expect(week[0]!.tasks.every((t) => t.done)).toBe(true);
    expect(weekday(SUNDAY)).toBe(6);
  });

  it('подписи дат по-русски', () => {
    expect(dayLabel(SUNDAY, false)).toBe('воскресенье, 18 октября');
    expect(dayLabel(SUNDAY, true)).toBe('вс, 18 октября');
    expect(weekLabel(makeWeek(SUNDAY))).toBe('12–18 октября');
    expect(weekLabel(makeWeek(new Date(2026, 9, 1)))).toBe('28 сентября – 4 октября');
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
  it('«Сегодня» и Planner — одни и те же дела', () => {
    let s = initialState(SUNDAY);
    const day = todayIndex(s);
    const first = s.week[day]!.tasks[0]!;
    s = reducer(s, { type: 'task.toggle', day, id: first.id, done: true });
    expect(s.week[day]!.tasks[0]!.done).toBe(true);
  });

  it('дело из Command встаёт первым на сегодня', () => {
    let s = initialState(SUNDAY);
    s = reducer(s, { type: 'task.add', title: 'Сдать проект', time: 'завтра, 16:00' });
    const t = s.week[todayIndex(s)]!.tasks[0]!;
    expect(t).toMatchObject({ title: 'Сдать проект', time: 'завтра, 16:00', done: false });
  });

  it('конспект становится документом, помощника можно спрятать', () => {
    let s = initialState(SUNDAY);
    s = reducer(s, { type: 'doc.add', name: 'Графы' });
    expect(s.docs[0]!.name).toBe('Графы');
    s = reducer(s, { type: 'helper', kind: 'elik', on: false });
    expect(s.helpers.elik).toBe(false);
  });
});
