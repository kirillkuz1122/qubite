/**
 * Возможности (AGT-005): чистые функции — что показать, как подписать вид и даты.
 * Их проверяют юнит-тесты.
 */
import type { components } from '@qubite/api-client';

type Item = components['schemas']['OpportunityItem'];

/** На Главной — не больше трёх карточек (D-734). */
export const MAX_CARDS = 3;

const KIND: Record<string, string> = {
  olympiad: 'олимпиада',
  hackathon: 'хакатон',
  contest: 'соревнование',
};

export function kindLabel(kind: string): string {
  return KIND[kind] ?? 'мероприятие';
}

/** Ещё не закончились (конец сегодня или позже). */
export function ahead<T extends Pick<Item, 'ends_at'>>(items: T[], now: Date): T[] {
  return items.filter((i) => {
    const end = Date.parse(i.ends_at);
    return !Number.isFinite(end) || end >= now.getTime();
  });
}

/**
 * У этих источников даты — календарные дни своего пояса, конец дня 23:59:59
 * (docs/engineering/OPPORTUNITIES.md). Читаем их в том же поясе, иначе «до 27 октября»
 * по Москве в Челябинске стало бы «до 28 октября». Остальные — в поясе устройства.
 */
const DAY_ZONE: Record<string, string> = { codolymp: 'Europe/Moscow', devpost: 'UTC' };

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];
/** Число и месяц не разрываются переносом. */
const NB = '\u00a0';

interface Day {
  y: number;
  m: number;
  d: number;
  /** «20:35» */
  time: string;
}

function dayOf(iso: string, zone: string | undefined): Day | null {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    time: `${get('hour')}:${get('minute')}`,
  };
}

const sameDay = (a: Day, b: Day) => a.y === b.y && a.m === b.m && a.d === b.d;
const month = (day: Day) => MONTHS[day.m - 1] ?? '';
/** «27 октября», в другом году — «15 января 2027»; `year = null` — год всегда. */
function dayText(day: Day, year: number | null): string {
  return `${day.d}${NB}${month(day)}${day.y === year ? '' : ` ${day.y}`}`;
}

/** «1–20 декабря», «1 октября – 14 декабря», «5 ноября, 20:35–22:35», «5 ноября, 23:35 – 6 ноября, 01:35». */
function range(start: Day, end: Day, year: number, timed: boolean): string {
  if (sameDay(start, end)) {
    if (!timed) return dayText(start, year);
    const time = end.time === start.time ? start.time : `${start.time}–${end.time}`;
    return `${dayText(start, year)}, ${time}`;
  }
  // соревнование через полночь: «5 ноября, 23:35 – 6 ноября, 01:35» — время подключения важно
  if (timed) {
    return `${dayText(start, year)}, ${start.time} – ${dayText(end, year)}, ${end.time}`;
  }
  if (start.y === end.y && start.m === end.m) {
    return `${start.d}–${dayText(end, year)}`;
  }
  if (start.y === end.y) {
    return `${start.d}${NB}${month(start)} – ${dayText(end, year)}`;
  }
  return `${dayText(start, null)} – ${dayText(end, null)}`;
}

export interface OpportunityWhen {
  /** «Регистрация до 27 октября» */
  registration: string | null;
  /** когда проходит: «1–20 декабря»; у этапа «Регистрация» — нет (это и есть его даты) */
  dates: string | null;
}

export function opportunityWhen(item: Item, now: Date): OpportunityWhen {
  const zone = DAY_ZONE[item.source];
  const year = dayOf(now.toISOString(), zone)?.y ?? now.getFullYear();
  const start = dayOf(item.starts_at, zone);
  const end = dayOf(item.ends_at, zone) ?? start;
  const regAt = item.registration_until ? Date.parse(item.registration_until) : NaN;
  const reg = item.registration_until ? dayOf(item.registration_until, zone) : null;
  const registration = reg
    ? `${regAt < now.getTime() ? 'Регистрация закончилась' : 'Регистрация до'} ${dayText(reg, year)}`
    : null;
  // этап «Регистрация» (Кодолимп): даты этапа — это и есть срок регистрации
  const onlyRegistration = reg !== null && regAt === Date.parse(item.ends_at);
  // у источников с днями время не пишем; у остальных — если начало не в полночь
  const timed = !zone && start !== null && start.time !== '00:00';
  const dates = start && end && !onlyRegistration ? range(start, end, year, timed) : null;
  return { registration, dates };
}

/** «олимпиада · Отборочный этап»; этап «Регистрация» не повторяем — о нём строка дат. */
export function kindLine(item: Item): string {
  const stage = item.stage.trim();
  const skip = !stage || (item.registration_until && stage.toLowerCase().startsWith('регистрация'));
  return skip ? kindLabel(item.kind) : `${kindLabel(item.kind)} · ${stage}`;
}

/** Для кого и о чём: «8–11 класс · математика»; у хакатонов — темы. */
export function whoLine(item: Item): string {
  const topic = item.subject.trim() || item.tags.slice(0, 2).join(', ');
  return [item.grades.trim(), topic].filter(Boolean).join(' · ');
}

/** Ссылку на сайт показываем, только если это обычный http(s)-адрес. */
export function siteUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Итог «Интересно». */
export function tasksLine(n: number): string {
  return n > 0 ? `Дела поставлены: ${n}` : 'Дела уже поставлены';
}
