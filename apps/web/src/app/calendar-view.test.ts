import { describe, expect, it } from 'vitest';
import {
  HOUR_HEIGHT,
  MAX_WINDOW_MS,
  eventForm,
  eventBody,
  localInstant,
  snapMinute,
  moveTimes,
  type CalendarEvent,
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

describe('форма события', () => {
  it('переводит часы платформы в UTC и очищает необязательные поля', () => {
    const form = eventForm(DAY, 607, ZONE);
    const result = eventBody(
      { ...form, title: '  Встреча  ', place: 'Кабинет 12', notes: 'Материалы' },
      ZONE,
    );
    expect(result.body).toEqual({
      title: 'Встреча',
      starts_at: at(DAY, '10:00'),
      ends_at: at(DAY, '11:00'),
      all_day: false,
      place: 'Кабинет 12',
      notes: 'Материалы',
      project_id: null,
      recurrence: null,
    });
  });

  it('конец события на весь день передаёт следующей полуночью', () => {
    const form = eventForm(DAY, 540, ZONE, undefined, true);
    const result = eventBody({ ...form, title: 'Поездка', endDay: '2026-11-01' }, ZONE);
    expect(result.body).toMatchObject({
      starts_at: at(DAY, '00:00'),
      ends_at: at('2026-11-02', '00:00'),
      all_day: true,
    });
  });

  it('для конца дня после 23:45 предлагает следующий день', () => {
    const form = eventForm(DAY, 1430, ZONE);
    expect(form.startTime).toBe('23:45');
    expect(form.endDay).toBe('2026-10-31');
    expect(form.endTime).toBe('00:45');
  });

  it('передаёт повтор в формате дел и выбранный проект', () => {
    const form = {
      ...eventForm(DAY, 540, ZONE),
      title: 'Занятие',
      project: 'project-id',
      repeat: 'weekly' as const,
      weekdays: [5, 1],
      interval: '2',
    };
    expect(eventBody(form, ZONE).body).toMatchObject({
      project_id: 'project-id',
      recurrence: { freq: 'weekly', interval: 2, weekdays: [1, 5] },
    });
    expect(eventBody({ ...form, repeat: 'daily' }, ZONE).body?.recurrence).toEqual({
      freq: 'daily',
      interval: 2,
    });
    expect(
      eventBody({ ...form, repeat: 'monthly', monthDay: '31' }, ZONE).body?.recurrence,
    ).toEqual({ freq: 'monthly', interval: 2, month_day: 31 });
  });

  it('не отправляет пустое название, обратное время и пустую неделю', () => {
    const form = {
      ...eventForm(DAY, 600, ZONE),
      title: ' ',
      endTime: '09:00',
      repeat: 'weekly' as const,
      weekdays: [],
    };
    const result = eventBody(form, ZONE);
    expect(result.body).toBeUndefined();
    expect(result.errors).toMatchObject({
      title: expect.any(String),
      endDay: expect.any(String),
      weekdays: expect.any(String),
    });
  });

  it('отклоняет несуществующие даты, часы и некорректные параметры повтора', () => {
    const form = { ...eventForm(DAY, 600, ZONE), title: 'Встреча' };
    for (const fields of [
      { startDay: '2026-02-30' },
      { endDay: '' },
      { startTime: '' },
      { startTime: '25:00' },
    ]) {
      expect(eventBody({ ...form, ...fields }, ZONE).body).toBeUndefined();
    }
    expect(
      eventBody({ ...form, repeat: 'daily', interval: '0' }, ZONE).errors?.interval,
    ).toBeTruthy();
    expect(
      eventBody({ ...form, repeat: 'monthly', monthDay: '32' }, ZONE).errors?.monthDay,
    ).toBeTruthy();
    expect(eventBody({ ...form, notes: 'я'.repeat(20_001) }, ZONE).errors?.notes).toBeTruthy();
  });

  it('сохраняет все поля и параметры серии при открытии полной записи', () => {
    const event: CalendarEvent = {
      id: 'event',
      owner_id: 'owner',
      title: 'Поездка',
      notes: 'Подробности',
      place: 'Город',
      starts_at: at(DAY, '00:00'),
      ends_at: at('2026-11-02', '00:00'),
      all_day: true,
      project_id: 'project',
      recurrence: { freq: 'monthly', interval: 3, month_day: 30 },
      revision: 4,
      created_at: 0,
      updated_at: 0,
      deleted: false,
    };
    const form = eventForm('2026-12-01', 0, ZONE, event);
    expect(form.endDay).toBe('2026-11-01');
    expect(eventBody(form, ZONE).body).toEqual({
      title: event.title,
      notes: event.notes,
      place: event.place,
      project_id: event.project_id,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      all_day: true,
      recurrence: event.recurrence,
    });
  });
});

describe('перенос по шкале', () => {
  it('округляет к 15 минутам и не выходит за день', () => {
    expect([
      snapMinute(-20),
      snapMinute(7),
      snapMinute(8),
      snapMinute(67),
      snapMinute(68),
      snapMinute(1450),
    ]).toEqual([0, 0, 15, 60, 75, 1425]);
  });

  it('переносит между днями недели и сохраняет длительность через полночь', () => {
    const event = item('ночь', '23:00', '23:00', { ends_at: at('2026-10-31', '02:00') });
    const moved = moveTimes(event, DAY, 1380, '2026-11-01', 1390, ZONE);
    expect(moved).toEqual({
      starts_at: at('2026-11-01', '23:15'),
      ends_at: at('2026-11-02', '02:15'),
    });
    expect(moved.ends_at - moved.starts_at).toBe(event.ends_at - event.starts_at);
  });

  it('захват продолжения события двигает всю запись, сохраняя смещение до полуночи', () => {
    const event = item('ночь', '23:00', '23:00', { ends_at: at('2026-10-31', '02:00') });
    expect(moveTimes(event, '2026-10-31', 0, '2026-11-01', 60, ZONE)).toEqual({
      starts_at: at('2026-11-01', '00:00'),
      ends_at: at('2026-11-01', '03:00'),
    });
  });

  it('срок дела остаётся без длительности, секунды при привязке убираются', () => {
    const task = item('срок', '10:00', '10:00', { kind: 'task' });
    expect(moveTimes(task, DAY, 600, '2026-11-01', 675, ZONE)).toEqual({
      starts_at: at('2026-11-01', '11:15'),
      ends_at: at('2026-11-01', '11:15'),
    });
    const event = item('секунды', '10:07', '11:07');
    event.starts_at += 30_000;
    event.ends_at += 30_000;
    expect(moveTimes(event, DAY, 607, DAY, 615, ZONE)).toEqual({
      starts_at: at(DAY, '10:15'),
      ends_at: at(DAY, '11:15'),
    });
  });

  it('время формы не зависит от часового пояса устройства', () => {
    expect(localInstant(DAY, '10:30', ZONE)).toBe(at(DAY, '10:30'));
    expect(Number.isNaN(localInstant('2026-02-30', '10:30', ZONE))).toBe(true);
  });
});
