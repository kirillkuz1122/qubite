import { describe, expect, it } from 'vitest';
import {
  HOUR_HEIGHT,
  MAX_WINDOW_MS,
  calendarDay,
  calendarTime,
  dateWindow,
  dayStart,
  intersects,
  itemKey,
  itemsOnDay,
  layoutBlocks,
  nowPosition,
  shiftPeriod,
  type CalendarItem,
} from './calendar-view';

const ZONE = 'Asia/Yekaterinburg';
const DAY = '2026-10-30';
const at = (day: string, time: string) => Date.parse(`${day}T${time}:00+05:00`);

function item(
  id: string,
  start: string,
  end: string,
  extra: Partial<CalendarItem> = {},
): CalendarItem {
  return {
    kind: 'event',
    source_id: id,
    starts_at: at(DAY, start),
    ends_at: at(DAY, end),
    all_day: false,
    title: id,
    place: '',
    ...extra,
  };
}

describe('окна календаря в часовом поясе платформы', () => {
  it('неделя начинается в понедельник и заканчивается после воскресенья', () => {
    const window = dateWindow('week', DAY, ZONE);
    expect(window.days).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
    expect(window.from).toBe(at('2026-10-26', '00:00'));
    expect(window.to).toBe(at('2026-11-02', '00:00'));
    expect(dateWindow('week', '2026-11-01', ZONE)).toEqual(window);
  });

  it('телефон показывает три дня и листает дальше без пропуска выходных', () => {
    const window = dateWindow('week', DAY, ZONE, 3);
    expect(window.days).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    expect(window.from).toBe(at(DAY, '00:00'));
    expect(window.to).toBe(at('2026-11-02', '00:00'));
    expect(shiftPeriod('week', DAY, 1, 3)).toBe('2026-11-02');
    expect(shiftPeriod('week', '2026-11-02', -1, 3)).toBe(DAY);
  });

  it('месяц покрывает полные недели и соседние даты в сетке', () => {
    const window = dateWindow('month', DAY, ZONE);
    expect(window.days).toHaveLength(42);
    expect(window.days[0]).toBe('2026-09-28');
    expect(window.days.at(-1)).toBe('2026-11-08');
    expect(window.from).toBe(at('2026-09-28', '00:00'));
    expect(window.to).toBe(at('2026-11-09', '00:00'));
    expect(dateWindow('month', '2028-02-01', ZONE).days).toContain('2028-02-29');
  });

  it('любое окно месяца укладывается в ограничение API, включая смену смещения', () => {
    for (let month = 1; month <= 12; month++) {
      const day = `2026-${String(month).padStart(2, '0')}-01`;
      const window = dateWindow('month', day, 'Europe/Berlin');
      expect(window.to).toBeGreaterThan(window.from);
      expect(window.to - window.from).toBeLessThanOrEqual(MAX_WINDOW_MS);
    }
  });

  it('полночь и окно дня учитывают 23 и 25 часов при переводе часов', () => {
    const spring = dateWindow('day', '2026-03-29', 'Europe/Berlin');
    expect(spring.from).toBe(Date.parse('2026-03-29T00:00:00+01:00'));
    expect(spring.to).toBe(Date.parse('2026-03-30T00:00:00+02:00'));
    expect(spring.to - spring.from).toBe(23 * 3_600_000);
    const autumn = dateWindow('day', '2026-10-25', 'Europe/Berlin');
    expect(autumn.to - autumn.from).toBe(25 * 3_600_000);
    expect(dayStart(DAY, ZONE)).toBe(at(DAY, '00:00'));
  });

  it('перелистывает месяц с 31 числа без перескакивания через февраль', () => {
    expect(shiftPeriod('month', '2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftPeriod('month', '2026-01-31', -1)).toBe('2025-12-01');
    expect(shiftPeriod('day', '2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftPeriod('week', DAY, 1)).toBe('2026-11-06');
  });
});

describe('раскладка записей по шкале', () => {
  it('одновременные записи ставит рядом, закончившуюся колонку использует снова', () => {
    const blocks = layoutBlocks(
      [
        item('длинное', '09:00', '12:00'),
        item('событие', '09:30', '10:00'),
        item('урок', '09:45', '10:30', { kind: 'lesson' }),
        item('после', '10:00', '11:00'),
        item('отдельное', '12:00', '13:00'),
      ],
      DAY,
      ZONE,
    );
    expect(blocks.map((block) => [block.item.title, block.column, block.columns])).toEqual([
      ['длинное', 0, 3],
      ['событие', 1, 3],
      ['урок', 2, 3],
      ['после', 1, 3],
      ['отдельное', 0, 1],
    ]);
    expect(blocks[0]).toMatchObject({ top: 9 * HOUR_HEIGHT, height: 3 * HOUR_HEIGHT });
  });

  it('касающиеся границами записи не пересекаются', () => {
    const blocks = layoutBlocks(
      [item('а', '10:00', '11:00'), item('б', '11:00', '12:00')],
      DAY,
      ZONE,
    );
    expect(blocks.map((block) => block.columns)).toEqual([1, 1]);
  });

  it('цепочку пересечений сохраняет в одной группе', () => {
    const blocks = layoutBlocks(
      [item('а', '09:00', '10:00'), item('б', '09:30', '10:30'), item('в', '10:00', '11:00')],
      DAY,
      ZONE,
    );
    expect(blocks.map((block) => [block.column, block.columns])).toEqual([
      [0, 2],
      [1, 2],
      [0, 2],
    ]);
  });

  it('дело без длительности показывает и учитывает в пересечениях', () => {
    const task = item('срок', '10:00', '10:00', { kind: 'task' });
    const blocks = layoutBlocks([task, item('урок', '10:15', '11:00')], DAY, ZONE);
    expect(blocks[0]).toMatchObject({ height: HOUR_HEIGHT / 2, columns: 2 });
    const midnight = item('полночь', '00:00', '00:00', { kind: 'task' });
    expect(intersects(midnight, at(DAY, '00:00'), at('2026-10-31', '00:00'))).toBe(true);
    expect(itemsOnDay([midnight], '2026-10-29', ZONE)).toEqual([]);
    expect(layoutBlocks([midnight], DAY, ZONE)).toHaveLength(1);
  });

  it('событие через полночь обрезает по границам каждого дня', () => {
    const overnight = item('ночь', '23:00', '23:00', {
      ends_at: at('2026-10-31', '01:00'),
    });
    expect(layoutBlocks([overnight], DAY, ZONE)[0]).toMatchObject({
      top: 23 * HOUR_HEIGHT,
      height: HOUR_HEIGHT,
    });
    expect(layoutBlocks([overnight], '2026-10-31', ZONE)[0]).toMatchObject({
      top: 0,
      height: HOUR_HEIGHT,
    });
    const untilMidnight = { ...overnight, ends_at: at('2026-10-31', '00:00') };
    expect(itemsOnDay([untilMidnight], '2026-10-31', ZONE)).toEqual([]);
  });

  it('записи на весь день есть в полосе и месяце, но не занимают шкалу', () => {
    const allDay = item('весь день', '00:00', '00:00', {
      all_day: true,
      ends_at: at('2026-11-01', '00:00'),
    });
    expect(itemsOnDay([allDay], DAY, ZONE)).toEqual([allDay]);
    expect(itemsOnDay([allDay], '2026-10-31', ZONE)).toEqual([allDay]);
    expect(itemsOnDay([allDay], '2026-11-01', ZONE)).toEqual([]);
    expect(layoutBlocks([allDay], DAY, ZONE)).toEqual([]);
  });

  it('различает повторы и источники с одинаковым ID', () => {
    const first = item('серия', '10:00', '11:00');
    const second = item('серия', '12:00', '13:00');
    const task = { ...first, kind: 'task' as const };
    expect(new Set([first, second, task].map(itemKey)).size).toBe(3);
  });
});

describe('линия «сейчас»', () => {
  it('позиция считается по местным часам, а не по UTC или поясу устройства', () => {
    const now = Date.parse('2026-10-30T05:30:00Z');
    expect(calendarDay(now, ZONE)).toBe(DAY);
    expect(calendarTime(now, ZONE)).toBe('10:30');
    expect(nowPosition(DAY, now, ZONE)).toBe(10.5 * HOUR_HEIGHT);
    expect(nowPosition(DAY, now + 60_000, ZONE)).toBeCloseTo((631 / 60) * HOUR_HEIGHT);
  });

  it('появляется только в сегодняшнем дне и переходит через местную полночь', () => {
    const midnight = Date.parse('2026-10-29T19:00:00Z');
    expect(calendarDay(midnight, ZONE)).toBe(DAY);
    expect(nowPosition(DAY, midnight, ZONE)).toBe(0);
    expect(nowPosition('2026-10-29', midnight, ZONE)).toBeNull();
    expect(nowPosition('2026-10-31', midnight, ZONE)).toBeNull();
  });

  it('на дне смены смещения полдень остаётся у отметки 12:00', () => {
    const now = Date.parse('2026-03-29T12:00:00+02:00');
    expect(nowPosition('2026-03-29', now, 'Europe/Berlin')).toBe(12 * HOUR_HEIGHT);
  });
});
