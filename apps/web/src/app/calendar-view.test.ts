import { describe, expect, it } from 'vitest';
import {
  HOUR_HEIGHT,
  BLOCK_MIN_SIZE,
  MAX_WINDOW_MS,
  calendarDay,
  calendarTime,
  dateWindow,
  dayStart,
  eventForm,
  eventMovePatch,
  eventRequest,
  fitDayBlocks,
  intersects,
  itemKey,
  itemsOnDay,
  layoutBlocks,
  localInstant,
  moveCalendarItem,
  newEventForm,
  nowPosition,
  shiftPeriod,
  snapMinute,
  type CalendarEvent,
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

describe('перенос по шкале', () => {
  it('привязывает к 15 минутам и не выводит начало за границы дня', () => {
    expect([0, 7, 8, 22, 23, 1439, -50].map(snapMinute)).toEqual([0, 0, 15, 15, 30, 1425, 0]);
  });

  it('переносит в другой день недели и сохраняет длительность', () => {
    const event = item('встреча', '10:00', '11:30');
    expect(moveCalendarItem(event, DAY, '2026-11-01', 38, ZONE)).toEqual({
      starts_at: at('2026-11-01', '10:45'),
      ends_at: at('2026-11-01', '12:15'),
    });
  });

  it('переносит дело без придуманной длительности', () => {
    const task = item('дело', '10:07', '10:07', { kind: 'task' });
    expect(moveCalendarItem(task, DAY, '2026-10-29', 15, ZONE)).toEqual({
      starts_at: at('2026-10-29', '10:15'),
      ends_at: at('2026-10-29', '10:15'),
    });
  });

  it('сдвигает многодневное событие за любой его отрезок без потери ночной части', () => {
    const event = item('ночь', '23:00', '23:00', { ends_at: at('2026-10-31', '02:00') });
    expect(moveCalendarItem(event, '2026-10-31', '2026-11-01', 30, ZONE)).toEqual({
      starts_at: at('2026-10-31', '23:30'),
      ends_at: at('2026-11-01', '02:30'),
    });
  });

  it('сохраняет длительность через границу суток', () => {
    const event = item('вечер', '23:30', '23:45');
    expect(moveCalendarItem(event, DAY, DAY, 45, ZONE)).toEqual({
      starts_at: at('2026-10-31', '00:15'),
      ends_at: at('2026-10-31', '00:30'),
    });
  });
});

const fullEvent: CalendarEvent = {
  id: 'event',
  owner_id: 'owner',
  title: 'Встреча',
  notes: 'Заметки',
  place: 'Библиотека',
  starts_at: at(DAY, '10:00'),
  ends_at: at(DAY, '11:30'),
  all_day: false,
  project_id: 'project',
  recurrence: null,
  revision: 4,
  deleted: false,
  created_at: 0,
  updated_at: 0,
};

describe('форма события → запрос', () => {
  it('сохраняет поля полного события, версию передаёт слой PATCH', () => {
    expect(eventRequest(eventForm(fullEvent, ZONE), ZONE)).toEqual({
      body: {
        title: 'Встреча',
        notes: 'Заметки',
        place: 'Библиотека',
        starts_at: fullEvent.starts_at,
        ends_at: fullEvent.ends_at,
        all_day: false,
        project_id: 'project',
        recurrence: null,
      },
    });
  });

  it('переводит время в UTC по поясу платформы, включая другой пояс', () => {
    expect(localInstant(DAY, '10:00', ZONE)).toBe(at(DAY, '10:00'));
    expect(localInstant(DAY, '10:00', 'UTC')).toBe(Date.parse(`${DAY}T10:00:00Z`));
  });

  it('считает последний день включительно и восстанавливает его при правке', () => {
    const form = { ...newEventForm(DAY, 0, true), title: 'Поездка', endDay: '2026-11-01' };
    const result = eventRequest(form, ZONE);
    expect(result.body).toMatchObject({
      starts_at: at(DAY, '00:00'),
      ends_at: at('2026-11-02', '00:00'),
      all_day: true,
    });
    expect(eventForm({ ...fullEvent, ...result.body }, ZONE)).toMatchObject({
      startDay: DAY,
      endDay: '2026-11-01',
      allDay: true,
    });
  });

  it('позднее новое событие заканчивается на следующий день', () => {
    expect(newEventForm(DAY, 23 * 60 + 45)).toMatchObject({
      startTime: '23:45',
      endDay: '2026-10-31',
      endTime: '00:45',
    });
  });

  it('передаёт общий формат повторов и явное очищение проекта и повтора', () => {
    const form = {
      ...newEventForm(DAY),
      title: ' Зарядка ',
      repeat: 'weekly' as const,
      weekdays: [5, 1],
    };
    expect(eventRequest(form, ZONE).body).toMatchObject({
      title: 'Зарядка',
      project_id: null,
      recurrence: { freq: 'weekly', interval: 1, weekdays: [1, 5] },
    });
    expect(
      eventRequest({ ...form, repeat: 'monthly', monthDay: 31 }, ZONE).body?.recurrence,
    ).toEqual({
      freq: 'monthly',
      interval: 1,
      month_day: 31,
    });
    expect(eventRequest({ ...form, repeat: '' }, ZONE).body?.recurrence).toBeNull();
  });

  it('не теряет интервал существующей серии', () => {
    const event = { ...fullEvent, recurrence: { freq: 'weekly', interval: 2, weekdays: [5] } };
    expect(eventRequest(eventForm(event, ZONE), ZONE).body?.recurrence).toEqual(event.recurrence);
  });

  it('не отправляет пустое название, неверные даты, конец до начала и пустые дни повтора', () => {
    const form = {
      ...newEventForm(DAY),
      startDay: '',
      endDay: '2026-02-30',
      repeat: 'weekly' as const,
      weekdays: [],
    };
    expect(eventRequest(form, ZONE).errors).toMatchObject({
      title: expect.any(String),
      startDay: expect.any(String),
      endDay: expect.any(String),
      repeat: expect.any(String),
    });
    expect(
      eventRequest({ ...newEventForm(DAY), title: 'Встреча', endTime: '08:00' }, ZONE).errors
        ?.endDay,
    ).toBeTruthy();
    expect(
      eventRequest(
        { ...newEventForm(DAY), title: 'Встреча', repeat: 'monthly', interval: 0, monthDay: 32 },
        ZONE,
      ).errors,
    ).toMatchObject({
      interval: expect.any(String),
      monthDay: expect.any(String),
    });
  });

  it('не заменяет несуществующий час при переводе часов другим временем', () => {
    expect(localInstant('2026-03-29', '02:30', 'Europe/Berlin')).toBeNaN();
  });

  it('перенос позднего повтора сдвигает базовую серию на тот же интервал', () => {
    const occurrence = item('event', '10:00', '11:30', {
      starts_at: at('2026-11-06', '10:00'),
      ends_at: at('2026-11-06', '11:30'),
    });
    const moved = moveCalendarItem(occurrence, '2026-11-06', '2026-11-07', 15, ZONE);
    expect(eventMovePatch(fullEvent, occurrence, moved, ZONE)).toEqual({
      starts_at: at('2026-10-31', '10:15'),
      ends_at: at('2026-10-31', '11:45'),
    });
  });

  it('сдвигает все дни недельного повтора и сохраняет интервал', () => {
    const event = {
      ...fullEvent,
      recurrence: { freq: 'weekly', interval: 2, weekdays: [1, 5, 7] },
    };
    const occurrence = item('event', '10:00', '11:30');
    const moved = moveCalendarItem(occurrence, DAY, '2026-11-01', 15, ZONE);
    expect(eventMovePatch(event, occurrence, moved, ZONE)).toEqual({
      starts_at: at('2026-11-01', '10:15'),
      ends_at: at('2026-11-01', '11:45'),
      recurrence: { freq: 'weekly', interval: 2, weekdays: [2, 3, 7] },
    });
    expect(event.recurrence.weekdays).toEqual([1, 5, 7]);
    const backwards = moveCalendarItem(occurrence, DAY, '2026-10-28', 0, ZONE);
    expect(eventMovePatch(event, occurrence, backwards, ZONE).recurrence?.weekdays).toEqual([
      3, 5, 6,
    ]);
  });

  it('сдвигает число месячного повтора через границу месяца', () => {
    const event = {
      ...fullEvent,
      recurrence: { freq: 'monthly', interval: 3, month_day: 30 },
    };
    const occurrence = item('event', '10:00', '11:30');
    const moved = moveCalendarItem(occurrence, DAY, '2026-11-01', 0, ZONE);
    expect(eventMovePatch(event, occurrence, moved, ZONE)).toEqual({
      starts_at: at('2026-11-01', '10:00'),
      ends_at: at('2026-11-01', '11:30'),
      recurrence: { freq: 'monthly', interval: 3, month_day: 1 },
    });
    expect(event.recurrence.month_day).toBe(30);
    const backwards = moveCalendarItem(occurrence, DAY, '2026-10-29', 0, ZONE);
    expect(eventMovePatch(event, occurrence, backwards, ZONE).recurrence?.month_day).toBe(29);
  });

  it('при переходе через полночь меняет правило вместе со временем', () => {
    const event = {
      ...fullEvent,
      starts_at: at(DAY, '23:45'),
      ends_at: at('2026-10-31', '00:45'),
      recurrence: { freq: 'weekly', interval: 1, weekdays: [5] },
    };
    const occurrence = item('event', '23:45', '23:45', { ends_at: event.ends_at });
    const moved = moveCalendarItem(occurrence, DAY, DAY, 15, ZONE);
    expect(eventMovePatch(event, occurrence, moved, ZONE)).toEqual({
      starts_at: at('2026-10-31', '00:00'),
      ends_at: at('2026-10-31', '01:00'),
      recurrence: { freq: 'weekly', interval: 1, weekdays: [6] },
    });
  });

  it('дневной повтор и перенос внутри дня не переписывает', () => {
    const occurrence = item('event', '10:00', '11:30');
    const daily = { ...fullEvent, recurrence: { freq: 'daily', interval: 2 } };
    const moved = moveCalendarItem(occurrence, DAY, '2026-11-01', 0, ZONE);
    expect(eventMovePatch(daily, occurrence, moved, ZONE)).toEqual({
      starts_at: at('2026-11-01', '10:00'),
      ends_at: at('2026-11-01', '11:30'),
    });
    const monthly = {
      ...fullEvent,
      recurrence: { freq: 'monthly', interval: 1, month_day: 31 },
    };
    const later = moveCalendarItem(occurrence, DAY, DAY, 15, ZONE);
    expect(eventMovePatch(monthly, occurrence, later, ZONE)).toEqual({
      starts_at: at(DAY, '10:15'),
      ends_at: at(DAY, '11:45'),
    });
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
        item('снова', '10:15', '11:00'),
        item('отдельное', '12:00', '13:00'),
      ],
      DAY,
      ZONE,
    );
    expect(blocks.map((block) => [block.item.title, block.column, block.columns])).toEqual([
      ['длинное', 0, 4],
      ['событие', 1, 4],
      ['урок', 2, 4],
      ['после', 3, 4],
      ['снова', 1, 4],
      ['отдельное', 0, 1],
    ]);
    expect(blocks[0]).toMatchObject({ top: 9 * HOUR_HEIGHT, height: 3 * HOUR_HEIGHT });
  });

  it('три коротких записи подряд раскладывает по фактической высоте 44 px', () => {
    const blocks = layoutBlocks(
      [
        item('а', '10:00', '10:15'),
        item('б', '10:15', '10:30'),
        item('в', '10:30', '10:45'),
      ],
      DAY,
      ZONE,
    );
    expect(blocks.map(({ height, column, columns }) => [height, column, columns])).toEqual([
      [44, 0, 3],
      [44, 1, 3],
      [44, 2, 3],
    ]);
    for (const block of blocks) {
      for (const other of blocks) {
        if (block === other || block.column !== other.column) continue;
        expect(
          block.top + block.height <= other.top || other.top + other.height <= block.top,
        ).toBe(true);
      }
    }
  });

  it('на ширине 93 px оставляет место для полосы «ещё N»', () => {
    const blocks = layoutBlocks(
      ['а', 'б', 'в'].map((id) => item(id, '10:00', '11:00')),
      DAY,
      ZONE,
    );
    const fitted = fitDayBlocks(blocks, 93);
    expect(fitted.blocks.map(({ column, columns }) => [column, columns])).toEqual([[0, 2]]);
    expect(fitted.overflow).toEqual([
      {
        key: blocks[0]!.key,
        top: 10 * HOUR_HEIGHT,
        height: HOUR_HEIGHT,
        column: 1,
        columns: 2,
        count: 2,
      },
    ]);
    for (const block of [...fitted.blocks, ...fitted.overflow]) {
      expect(93 / block.columns).toBeGreaterThanOrEqual(BLOCK_MIN_SIZE);
      expect(((block.column + 1) / block.columns) * 93).toBeLessThanOrEqual(93);
    }
    expect(fitDayBlocks(blocks, 3 * BLOCK_MIN_SIZE)).toEqual({ blocks, overflow: [] });
  });

  it('при одной доступной колонке сворачивает группу целиком', () => {
    const blocks = layoutBlocks(
      ['а', 'б', 'в'].map((id) => item(id, '10:00', '11:00')),
      DAY,
      ZONE,
    );
    const fitted = fitDayBlocks(blocks, 87);
    expect(fitted.blocks).toEqual([]);
    expect(fitted.overflow).toMatchObject([{ column: 0, columns: 1, count: 3 }]);
  });

  it('не сворачивает соседние группы и сохраняет перенесённую запись видимой', () => {
    const selected = item('в', '10:00', '11:00');
    const blocks = layoutBlocks(
      [
        item('а', '10:00', '11:00'),
        item('б', '10:00', '11:00'),
        selected,
        item('позже', '12:00', '13:00'),
      ],
      DAY,
      ZONE,
    );
    const fitted = fitDayBlocks(blocks, 93, selected);
    expect(
      fitted.blocks.map(({ item, column, columns }) => [item.source_id, column, columns]),
    ).toEqual([
      ['в', 0, 2],
      ['позже', 0, 1],
    ]);
    expect(fitted.overflow).toMatchObject([{ count: 2 }]);
  });

  it('ключ блока сохраняется при переносе и изменении текста, но различает повторы', () => {
    const first = item('серия', '10:00', '11:00');
    const second = {
      ...first,
      starts_at: at('2026-11-06', '10:00'),
      ends_at: at('2026-11-06', '11:00'),
    };
    const before = layoutBlocks([first, second], DAY, ZONE)[0]!;
    const moved = {
      ...first,
      ...moveCalendarItem(first, DAY, '2026-10-31', 15, ZONE),
      title: 'Новое название',
      place: 'Новое место',
    };
    const after = layoutBlocks([second, moved], '2026-10-31', ZONE)[0]!;
    const repeat = layoutBlocks([first, second], '2026-11-06', ZONE)[0]!;
    expect(after.key).toBe(before.key);
    expect(repeat.key).not.toBe(before.key);
    expect(layoutBlocks([{ ...first, kind: 'task' }], DAY, ZONE)[0]!.key).not.toBe(before.key);
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
    expect(blocks[0]).toMatchObject({ height: BLOCK_MIN_SIZE, columns: 2 });
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
