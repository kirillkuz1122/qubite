/** CAL-001b: календарные даты и геометрия шкалы, без React и часового пояса устройства. */
import type { components } from '@qubite/api-client';

export type CalendarItem = components['schemas']['CalendarItem'];
export type CalendarKind = CalendarItem['kind'];
export type CalendarMode = 'day' | 'week' | 'month';

export const CALENDAR_MODES: readonly CalendarMode[] = ['day', 'week', 'month'];
export const HOUR_HEIGHT = 64;
/** Та же минимальная зона нажатия, что у .calendar-block-hit. */
export const BLOCK_MIN_SIZE = 44;
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

/** Ключ React не зависит от времени и текста; индекс различает повторы одной серии. */
export function occurrenceKey(item: CalendarItem, index: number): string {
  return `${item.kind}:${item.source_id}:${index}`;
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

export function minuteAt(instant: number, timeZone: string): number {
  const p = parts(instant, timeZone);
  return Number(p.hour) * 60 + Number(p.minute);
}

/** Координата линии в px; вне сегодняшней колонки линии нет. */
export function nowPosition(day: string, now: number, timeZone: string): number | null {
  return calendarDay(now, timeZone) === day ? (minuteAt(now, timeZone) / 60) * HOUR_HEIGHT : null;
}

export interface CalendarBlock {
  key: string;
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
  // Индекс во всём окне, а не внутри дня: после переноса между днями ключ сохраняется.
  const counts = new Map<string, number>();
  const keys = new Map<CalendarItem, string>();
  for (const item of [...items].sort((a, b) => a.starts_at - b.starts_at)) {
    const source = `${item.kind}:${item.source_id}`;
    const index = counts.get(source) ?? 0;
    keys.set(item, occurrenceKey(item, index));
    counts.set(source, index + 1);
  }
  const blocks = itemsOnDay(items, day, timeZone)
    .filter((item) => !item.all_day)
    .map((item): CalendarBlock => {
      const start = item.starts_at <= from ? 0 : minuteAt(item.starts_at, timeZone);
      // Решил так, можно откатить: срок без длительности занимает 30 минут на шкале.
      const finish =
        item.ends_at === item.starts_at ? item.starts_at + 30 * MINUTE_MS : item.ends_at;
      const end = finish >= to ? 1440 : Math.max(start + 1, minuteAt(finish, timeZone));
      return {
        key: keys.get(item)!,
        item,
        start,
        end,
        top: (start / 60) * HOUR_HEIGHT,
        height: Math.max(BLOCK_MIN_SIZE, ((end - start) / 60) * HOUR_HEIGHT),
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
    if (block.top >= groupEnd) {
      finishGroup();
      group = [];
      ends = [];
      groupEnd = -1;
    }
    let column = ends.findIndex((end) => end <= block.top);
    if (column === -1) column = ends.length;
    ends[column] = block.top + block.height;
    block.column = column;
    group.push(block);
    groupEnd = Math.max(groupEnd, block.top + block.height);
  }
  finishGroup();
  return blocks;
}

export interface CalendarOverflow {
  key: string;
  top: number;
  height: number;
  column: number;
  columns: number;
  count: number;
}

/** В тесной группе последняя колонка — одна общая полоса скрытых записей. */
export function fitDayBlocks(
  blocks: readonly CalendarBlock[],
  width: number,
  preferred?: CalendarItem,
): { blocks: CalendarBlock[]; overflow: CalendarOverflow[] } {
  const limit = Math.max(1, Math.floor(width / BLOCK_MIN_SIZE));
  const visible: CalendarBlock[] = [];
  const overflow: CalendarOverflow[] = [];
  let group: CalendarBlock[] = [];
  let groupEnd = -1;
  function finishGroup() {
    if (!group.length) return;
    const columns = group[0]!.columns;
    if (columns <= limit) {
      visible.push(...group);
      return;
    }
    const available = limit - 1;
    const selected = group.find(
      ({ item }) =>
        preferred &&
        item.kind === preferred.kind &&
        item.source_id === preferred.source_id &&
        item.starts_at === preferred.starts_at,
    );
    // Перенос с клавиатуры может попасть в тесную группу: оставляем запись доступной.
    const swap = available > 0 && selected && selected.column >= available ? selected.column : 0;
    const hidden: CalendarBlock[] = [];
    for (const block of group) {
      const column = block.column === swap ? 0 : block.column === 0 ? swap : block.column;
      if (column < available) visible.push({ ...block, column, columns: limit });
      else hidden.push(block);
    }
    const top = Math.min(...hidden.map((block) => block.top));
    const bottom = Math.max(...hidden.map((block) => block.top + block.height));
    overflow.push({
      key: group[0]!.key,
      top,
      height: bottom - top,
      column: available,
      columns: limit,
      count: hidden.length,
    });
  }
  for (const block of blocks) {
    if (block.top >= groupEnd) {
      finishGroup();
      group = [];
      groupEnd = -1;
    }
    group.push(block);
    groupEnd = Math.max(groupEnd, block.top + block.height);
  }
  finishGroup();
  return { blocks: visible, overflow };
}

/** Ограничение API; сутки здесь — длительность UTC. */
export const MAX_WINDOW_MS = 62 * DAY_MS;

export type CalendarEvent = components['schemas']['CalendarEvent'];
export type EventBody = components['schemas']['CalendarEventCreate'];
export type EventPatch = components['schemas']['CalendarEventPatch'];
export type EventRepeat = '' | 'daily' | 'weekly' | 'monthly';

export interface EventForm {
  title: string;
  startDay: string;
  startTime: string;
  endDay: string;
  endTime: string;
  allDay: boolean;
  place: string;
  project: string;
  repeat: EventRepeat;
  interval: number;
  weekdays: number[];
  monthDay: number;
  notes: string;
}

/** Шаг шкалы; граница 24:00 остаётся в следующем дне только у конца события. */
export function snapMinute(minute: number): number {
  return Math.max(0, Math.min(1425, Math.round(minute / 15) * 15));
}

export function timeFromMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** Гражданское время платформы → UTC, независимо от пояса устройства. */
export function localInstant(day: string, time: string, timeZone: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN;
  const target = Date.parse(`${day}T${time}:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== day) return NaN;
  let instant = target;
  for (let i = 0; i < 4; i++) {
    const p = parts(instant, timeZone);
    const local = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const next = instant + target - local;
    if (next === instant) return instant;
    instant = next;
  }
  // Несуществующее время в разрыве при переводе часов не подменяем другим временем.
  return NaN;
}

export function newEventForm(day: string, minute = 9 * 60, allDay = false): EventForm {
  const start = snapMinute(minute);
  const end = start + 60;
  return {
    title: '',
    startDay: day,
    startTime: timeFromMinute(start),
    endDay: allDay || end < 1440 ? day : addDays(day, 1),
    endTime: timeFromMinute(end % 1440),
    allDay,
    place: '',
    project: '',
    repeat: '',
    interval: 1,
    weekdays: [((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1],
    monthDay: Number(day.slice(8)),
    notes: '',
  };
}

/** У «весь день» форма показывает последний включённый день, API — исключённую границу. */
export function eventForm(event: CalendarEvent, timeZone: string): EventForm {
  const day = calendarDay(event.starts_at, timeZone);
  return {
    ...newEventForm(day),
    title: event.title,
    startTime: calendarTime(event.starts_at, timeZone),
    endDay: calendarDay(event.all_day ? event.ends_at - 1 : event.ends_at, timeZone),
    endTime: calendarTime(event.ends_at, timeZone),
    allDay: event.all_day,
    place: event.place,
    project: event.project_id ?? '',
    repeat: (event.recurrence?.freq ?? '') as EventRepeat,
    interval: event.recurrence?.interval ?? 1,
    weekdays: event.recurrence?.weekdays ?? [],
    monthDay: event.recurrence?.month_day ?? Number(day.slice(8)),
    notes: event.notes,
  };
}

export type EventFormErrors = Partial<Record<keyof EventForm, string>>;

export function eventRequest(
  form: EventForm,
  timeZone: string,
): { body: EventBody; errors?: never } | { body?: never; errors: EventFormErrors } {
  const errors: EventFormErrors = {};
  if (!form.title.trim() || [...form.title.trim()].length > 500)
    errors.title = 'Название — от 1 до 500 знаков';
  if ([...form.place].length > 500) errors.place = 'Место — до 500 знаков';
  const starts_at = localInstant(form.startDay, form.allDay ? '00:00' : form.startTime, timeZone);
  // Проверяем дату до addDays: пустое поле не должно бросать RangeError.
  const end = localInstant(form.endDay, form.allDay ? '00:00' : form.endTime, timeZone);
  const ends_at =
    form.allDay && Number.isFinite(end) ? dayStart(addDays(form.endDay, 1), timeZone) : end;
  if (!Number.isFinite(starts_at)) errors.startDay = 'Укажите существующую дату и время начала';
  if (!Number.isFinite(ends_at)) errors.endDay = 'Укажите существующую дату и время конца';
  else if (ends_at <= starts_at) errors.endDay = 'Конец должен быть позже начала';
  if (form.repeat === 'weekly' && !form.weekdays.length)
    errors.repeat = 'Выберите хотя бы один день недели';
  if (form.repeat && (!Number.isInteger(form.interval) || form.interval < 1 || form.interval > 365))
    errors.interval = 'Интервал — от 1 до 365';
  if (
    form.repeat === 'monthly' &&
    (!Number.isInteger(form.monthDay) || form.monthDay < 1 || form.monthDay > 31)
  )
    errors.monthDay = 'Число месяца — от 1 до 31';
  if (Object.keys(errors).length) return { errors };
  return {
    body: {
      title: form.title.trim(),
      starts_at,
      ends_at,
      all_day: form.allDay,
      place: form.place,
      project_id: form.project || null,
      notes: form.notes,
      recurrence: form.repeat
        ? {
            freq: form.repeat,
            interval: form.interval,
            ...(form.repeat === 'weekly'
              ? { weekdays: [...form.weekdays].sort((a, b) => a - b) }
              : {}),
            ...(form.repeat === 'monthly' ? { month_day: form.monthDay } : {}),
          }
        : null,
    },
  };
}

/** Перенос выбранного отрезка, включая отрезки многодневного события. Длительность неизменна. */
export function moveCalendarItem(
  item: CalendarItem,
  fromDay: string,
  toDay: string,
  minuteDelta: number,
  timeZone: string,
): Pick<CalendarItem, 'starts_at' | 'ends_at'> {
  const dayDelta = (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS;
  const originalMinute = minuteAt(item.starts_at, timeZone);
  const minute = Math.round((originalMinute + minuteDelta) / 15) * 15;
  const day = addDays(calendarDay(item.starts_at, timeZone), dayDelta + Math.floor(minute / 1440));
  const starts_at = localInstant(day, timeFromMinute(((minute % 1440) + 1440) % 1440), timeZone);
  return { starts_at, ends_at: starts_at + item.ends_at - item.starts_at };
}

/** Сдвигается исходная серия, а не превращается в выбранный поздний повтор. */
export function eventMovePatch(
  event: CalendarEvent,
  occurrence: CalendarItem,
  moved: Pick<CalendarItem, 'starts_at' | 'ends_at'>,
  timeZone: string,
): EventPatch {
  const delta = moved.starts_at - occurrence.starts_at;
  const patch: EventPatch = {
    starts_at: event.starts_at + delta,
    ends_at: event.ends_at + delta,
  };
  const from = calendarDay(occurrence.starts_at, timeZone);
  const to = calendarDay(moved.starts_at, timeZone);
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
  const rule = event.recurrence;
  if (days && rule?.freq === 'weekly') {
    const weekdays = rule.weekdays?.length
      ? rule.weekdays
      : [((new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7) + 1];
    patch.recurrence = {
      ...rule,
      weekdays: weekdays.map((day) => ((((day - 1 + days) % 7) + 7) % 7) + 1).sort((a, b) => a - b),
    };
  } else if (days && rule?.freq === 'monthly') {
    patch.recurrence = { ...rule, month_day: Number(to.slice(8)) };
  }
  return patch;
}
