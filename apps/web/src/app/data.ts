/**
 * Разделы оболочки и тестовые данные Docs (DS-007, в памяти — настоящие придут в DOC-002).
 * «Входящие» (CMD-007), «Сегодня» и Planner (PLAN-001) — уже на настоящих данных.
 * «Главная» (HOME-001) — первый экран после входа (D-327).
 */
import type { ColorName, CompanionKind, ElikMood, IconName } from '@qubite/ui';

export type SectionId = 'home' | 'today' | 'inbox' | 'planner' | 'agent' | 'docs' | 'settings';

export interface Section {
  id: SectionId;
  path: `/${SectionId}`;
  name: string;
  /** заголовок из точек */
  title: string;
  icon: IconName;
  /** чей это раздел */
  who: CompanionKind;
}

export const SECTIONS: Section[] = [
  { id: 'home', path: '/home', name: 'Главная', title: 'ГЛАВНАЯ', icon: 'home', who: 'proto' },
  { id: 'today', path: '/today', name: 'Сегодня', title: 'СЕГОДНЯ', icon: 'today', who: 'proto' },
  { id: 'inbox', path: '/inbox', name: 'Входящие', title: 'ВХОДЯЩИЕ', icon: 'inbox', who: 'elik' },
  {
    id: 'planner',
    path: '/planner',
    name: 'Planner',
    title: 'PLANNER',
    icon: 'planner',
    who: 'proto',
  },
  { id: 'agent', path: '/agent', name: 'Агент', title: 'АГЕНТ', icon: 'agent', who: 'proto' },
  { id: 'docs', path: '/docs', name: 'Docs', title: 'DOCS', icon: 'docs', who: 'neit' },
  {
    id: 'settings',
    path: '/settings',
    name: 'Настройки',
    title: 'НАСТРОЙКИ',
    icon: 'settings',
    who: 'foti',
  },
];

export const HELPERS: { kind: CompanionKind; name: string; role: string }[] = [
  { kind: 'elik', name: 'Элик', role: 'ловит мысли во «Входящие»' },
  { kind: 'proto', name: 'Прото', role: 'ведёт дела и проекты' },
  { kind: 'neit', name: 'Нейт', role: 'учёба, конспекты, повторение' },
  { kind: 'foti', name: 'Фоти', role: 'бережёт личное' },
];

export interface Task {
  id: string;
  title: string;
  color: ColorName;
  /** проект или тема: «Олимпиада», «Школа» */
  tag?: string;
  /** «16:00», «вечер», «без срока» */
  time: string;
  done: boolean;
  travelMinutes?: number;
}

export type InboxFrom = 'voice' | 'link' | 'tg' | 'text';
export type InboxAct = 'planner' | 'docs' | 'later';
export interface InboxItem {
  id: string;
  text: string;
  src: string;
  from: InboxFrom;
  time: string;
  /** что предлагает Элик */
  hint: string;
  acts: [string, InboxAct][];
  /** настроение Элика: думает над мыслью, спрашивает (CMD-004) */
  mood?: ElikMood;
  /** варианты ответа на вопрос агента «посмотри сам» */
  answers?: string[];
}

export interface Doc {
  id: string;
  name: string;
  pre: string;
  tags: [ColorName, string][];
  when: string;
}

let seq = 0;
export const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export interface Day {
  /** «пн» */
  d: string;
  /** число месяца */
  n: number;
  date: Date;
  today: boolean;
  tasks: Task[];
}

export const WD_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const WD_LONG = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
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

/** Номер дня недели: 0 — понедельник. */
export const weekday = (d: Date) => (d.getDay() + 6) % 7;

/** «пятница, 17 октября» или коротко «пт, 17 октября». */
export function dayLabel(d: Date, short: boolean): string {
  const w = weekday(d);
  return `${short ? WD_SHORT[w] : WD_LONG[w]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** «13–19 октября» (или «29 сентября – 5 октября»). */
export function weekLabel(week: Day[]): string {
  const a = week[0]!.date;
  const b = week[6]!.date;
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}`
    : `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}

/** Номер недели по ISO. */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t.getTime() - y.getTime()) / 864e5 - 3 + ((y.getUTCDay() + 6) % 7)) / 7);
}

export const DOCS: Doc[] = [
  {
    id: 'fenwick',
    name: 'Дерево Фенвика',
    pre: 'Префиксные суммы за O(log n): обновление и запрос…',
    tags: [
      ['orange', 'Олимпиада'],
      ['sky', 'Ink'],
    ],
    when: 'вчера',
  },
  {
    id: 'physics',
    name: 'Физика: равноускоренное движение',
    pre: 'v = v₀ + at, графики пути и скорости…',
    tags: [['sky', 'Школа']],
    when: 'пн',
  },
  {
    id: 'bot',
    name: 'Идеи для бота',
    pre: 'Напоминать про дз, разбирать расписание из фото…',
    tags: [['yellow', 'Проект']],
    when: '12 окт',
  },
  {
    id: 'books',
    name: 'Список книг на осень',
    pre: '«Задача трёх тел», «Понедельник начинается в субботу»…',
    tags: [['peach', 'Личное']],
    when: '3 окт',
  },
];

/** Русское число: 1 мысль, 2 мысли, 5 мыслей. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m = n % 10;
  const h = n % 100;
  if (m === 1 && h !== 11) return one;
  if (m >= 2 && m <= 4 && (h < 10 || h >= 20)) return few;
  return many;
}
