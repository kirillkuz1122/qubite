/** CAL-001b: календарные даты и геометрия шкалы, без React и часового пояса устройства. */
import type { components } from '@qubite/api-client';

export type CalendarItem = components['schemas']['CalendarItem'];
export type CalendarKind = CalendarItem['kind'];
export type CalendarMode = 'day' | 'week' | 'month';

export const CALENDAR_MODES: readonly CalendarMode[] = ['day', 'week', 'month'];
export const HOUR_HEIGHT = 64;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const PART_FORMATS = new Map<string, Intl.DateTimeFormat>();

export const KIND_LABEL: Record<CalendarKind, string> = {
  event: 'Событие',
  task: 'Дело',
  lesson: 'Урок',
};

export const KIND_COLOR: Record<CalendarKind, string> = {
  event: 'sky',
  task: 'yellow',
  lesson: 'green',
};

function parts(instant: number, timeZone: string) {
  let format = PART_FORMATS.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    PART_FORMATS.set(timeZone, format);
  }
  return Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, p.value]));
}

/** YYYY-MM-DD именно в часовом поясе платформы. */
export function calendarDay(instant: number, timeZone: string): string {
  const p = parts(instant, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** UTC здесь — только арифметика гражданских дат, не время события. */
export function addDays(day: string, count: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}

/** Местная полночь → UTC; отдельно для каждой границы, включая дни смены смещения. */
export function dayStart(day: string, timeZone: string): number {
  const target = Date.parse(`${day}T00:00:00Z`);
  let instant = target;
  let previous = instant;
  for (let i = 0; i < 4; i++) {
    const p = parts(instant, timeZone);
    const local = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const next = instant + target - local;
    if (next === instant) return instant;
    previous = instant;
    instant = next;
  }
  // Если перевод часов пропустил саму полночь, день начинается после разрыва.
  return Math.max(previous, instant);
}

export interface CalendarWindow {
  days: string[];
  /** Полуинтервал UTC-миллисекунд для API, максимум 42 местных дня (< 62 суток). */
  from: number;
  to: number;
}

export function dateWindow(
  mode: CalendarMode,
  anchor: string,
  timeZone: string,
  weekDays: 3 | 7 = 7,
): CalendarWindow {
  let first = anchor;
  let count = 1;
  const weekday = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  if (mode === 'week') {
    // Решил так, можно откатить: на телефоне — три дня от выбранной даты;
    // стрелки перелистывают по три дня, поэтому доступны все дни, включая выходные.
    first = weekDays === 7 ? addDays(anchor, -weekday(anchor)) : anchor;
    count = weekDays;
  } else if (mode === 'month') {
    const month = `${anchor.slice(0, 7)}-01`;
    first = addDays(month, -weekday(month));
    count = 42;
  }
  const days = Array.from({ length: count }, (_, i) => addDays(first, i));
  return {
    days,
    from: dayStart(first, timeZone),
    to: dayStart(addDays(first, count), timeZone),
  };
}

export function shiftPeriod(
  mode: CalendarMode,
  anchor: string,
  direction: -1 | 1,
  weekDays: 3 | 7 = 7,
): string {
  if (mode !== 'month') return addDays(anchor, direction * (mode === 'day' ? 1 : weekDays));
  const d = new Date(`${anchor.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + direction);
  return d.toISOString().slice(0, 10);
}

function dateLabel(day: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

export function periodLabel(mode: CalendarMode, anchor: string, days: string[]): string {
  if (mode === 'month') return dateLabel(anchor, { month: 'long', year: 'numeric' });
  const options = { day: 'numeric', month: 'long', year: 'numeric' } as const;
  if (mode === 'day') return dateLabel(anchor, { ...options, weekday: 'long' });
  return `${dateLabel(days[0]!, options)} — ${dateLabel(days.at(-1)!, options)}`;
}

export function shortDayLabel(day: string): string {
  return dateLabel(day, { weekday: 'short', day: 'numeric' });
}

export function calendarTime(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

/** Повторы и разные источники могут иметь один source_id. */
export function itemKey(item: CalendarItem): string {
  return `${item.kind}:${item.source_id}:${item.starts_at}:${item.ends_at}:${item.title}`;
}

export function intersects(item: CalendarItem, from: number, to: number): boolean {
  // У дела с due_time нет длительности: сервер отдаёт starts_at === ends_at.
  return item.starts_at < to && (item.ends_at > from || item.starts_at >= from);
}

export function itemsOnDay(
  items: readonly CalendarItem[],
  day: string,
  timeZone: string,
): CalendarItem[] {
  const from = dayStart(day, timeZone);
  const to = dayStart(addDays(day, 1), timeZone);
  return items
    .filter((item) => intersects(item, from, to))
    .sort((a, b) => a.starts_at - b.starts_at || itemKey(a).localeCompare(itemKey(b)));
}

function minuteAt(instant: number, timeZone: string): number {
  const p = parts(instant, timeZone);
  return Number(p.hour) * 60 + Number(p.minute);
}

/** Координата линии в px; вне сегодняшней колонки линии нет. */
export function nowPosition(day: string, now: number, timeZone: string): number | null {
  return calendarDay(now, timeZone) === day ? (minuteAt(now, timeZone) / 60) * HOUR_HEIGHT : null;
}

export interface CalendarBlock {
  item: CalendarItem;
  start: number;
  end: number;
  top: number;
  height: number;
  column: number;
  columns: number;
}

/**
 * Отрезки одного дня на шкале 00–24. Пересечения образуют группы;
 * ширина каждой группы равна максимальному числу одновременных блоков.
 */
export function layoutBlocks(
  items: readonly CalendarItem[],
  day: string,
  timeZone: string,
): CalendarBlock[] {
  const from = dayStart(day, timeZone);
  const to = dayStart(addDays(day, 1), timeZone);
  const blocks = itemsOnDay(items, day, timeZone)
    .filter((item) => !item.all_day)
    .map((item): CalendarBlock => {
      const start = item.starts_at <= from ? 0 : minuteAt(item.starts_at, timeZone);
      // Решил так, можно откатить: срок без длительности занимает 30 минут на шкале.
      const finish =
        item.ends_at === item.starts_at ? item.starts_at + 30 * MINUTE_MS : item.ends_at;
      const end = finish >= to ? 1440 : Math.max(start + 1, minuteAt(finish, timeZone));
      return {
        item,
        start,
        end,
        top: (start / 60) * HOUR_HEIGHT,
        height: ((end - start) / 60) * HOUR_HEIGHT,
        column: 0,
        columns: 1,
      };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  let group: CalendarBlock[] = [];
  let groupEnd = -1;
  let ends: number[] = [];
  function finishGroup() {
    for (const block of group) block.columns = ends.length;
  }
  for (const block of blocks) {
    if (block.start >= groupEnd) {
      finishGroup();
      group = [];
      ends = [];
      groupEnd = -1;
    }
    let column = ends.findIndex((end) => end <= block.start);
    if (column === -1) column = ends.length;
    ends[column] = block.end;
    block.column = column;
    group.push(block);
    groupEnd = Math.max(groupEnd, block.end);
  }
  finishGroup();
  return blocks;
}

/** Ограничение API; сутки здесь — длительность UTC. */
export const MAX_WINDOW_MS = 62 * DAY_MS;
