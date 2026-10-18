/**
 * Тестовые данные оболочки (DS-007): как в макете app.html. Живут в памяти — после перезагрузки
 * всё возвращается как было. Настоящие данные придут с API в задачах HOME-001, CMD-001, PLAN-001, DOC-002.
 */
import type { ColorName, CompanionKind, IconName } from '@qubite/ui';

export type SectionId = 'today' | 'inbox' | 'planner' | 'docs' | 'settings';

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
}

export interface Doc {
  id: string;
  name: string;
  pre: string;
  tags: [ColorName, string][];
  when: string;
}

export interface Project {
  name: string;
  color: ColorName;
  done: number;
  total: number;
}

let seq = 0;
export const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const TODAY_TASKS: Task[] = [
  {
    id: 't1',
    title: 'Разобрать задачу на ДП с отбора',
    color: 'orange',
    tag: 'Олимпиада',
    time: '16:00',
    done: false,
  },
  { id: 't2', title: 'Алгебра: № 214–220', color: 'sky', tag: 'Школа', time: '18:00', done: false },
  {
    id: 't3',
    title: 'Позвонить бабушке',
    color: 'peach',
    tag: 'Личное',
    time: 'вечер',
    done: false,
  },
  {
    id: 't4',
    title: 'Сдать конспект по физике',
    color: 'sky',
    tag: 'Школа',
    time: '9:00',
    done: true,
  },
  { id: 't5', title: 'Зарядка', color: 'green', tag: 'Личное', time: '7:30', done: true },
];

/** Остальные дни недели (пн…вс); в день «сегодня» встают дела из TODAY_TASKS. */
const WEEK_TEMPLATE: [string, ColorName, string, boolean][][] = [
  [
    ['Алгебра: № 190–195', 'sky', '18:00', true],
    ['Зарядка', 'green', '7:30', true],
  ],
  [
    ['Физика: лабораторная', 'sky', '10:00', true],
    ['Отбор: задачи на графы', 'orange', '17:00', true],
  ],
  [
    ['Сдать эссе', 'sky', '9:00', true],
    ['Кружок: ДП', 'orange', '16:00', true],
    ['Купить подарок', 'peach', 'вечер', false],
  ],
  [
    ['Читать главу 3', 'sky', '19:00', true],
    ['Заказ на Kwork', 'orange', '20:00', true],
  ],
  [
    ['Решить задачи с отбора', 'orange', '17:00', false],
    ['Физика: задачи 4–9', 'sky', '19:00', false],
  ],
  [['Поход с классом', 'peach', '11:00', false]],
  [
    ['План на неделю', 'orange', '20:00', false],
    ['Позвонить бабушке', 'peach', '12:00', false],
  ],
];

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

/** Неделя вокруг сегодняшнего дня: дела из макета, «сегодня» — настоящее. */
export function makeWeek(now: Date): Day[] {
  const t = weekday(now);
  return WEEK_TEMPLATE.map((tpl, i) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - t + i);
    const tasks =
      i === t
        ? TODAY_TASKS.map((x) => ({ ...x }))
        : tpl.map(([title, color, time, done], k) => ({
            id: `w${i}-${k}`,
            title,
            color,
            time,
            done: i < t ? true : done,
          }));
    return { d: WD_SHORT[i]!, n: date.getDate(), date, today: i === t, tasks };
  });
}

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

export const INBOX: InboxItem[] = [
  {
    id: 'i1',
    text: 'Бот, который напоминает про домашку',
    src: 'голосом',
    from: 'voice',
    time: '9:12',
    hint: 'похоже на проект',
    acts: [
      ['В проекты', 'planner'],
      ['В Docs', 'docs'],
    ],
  },
  {
    id: 'i2',
    text: 'Лекция про дерево Фенвика — посмотреть',
    src: 'ссылка из браузера',
    from: 'link',
    time: '11:40',
    hint: 'дело на выходные?',
    acts: [
      ['В дела', 'planner'],
      ['В Docs', 'docs'],
    ],
  },
  {
    id: 'i3',
    text: 'Подарок маме — до 3 ноября',
    src: 'из Telegram',
    from: 'tg',
    time: 'вчера',
    hint: 'дело со сроком 3 ноября',
    acts: [
      ['В дела', 'planner'],
      ['Позже', 'later'],
    ],
  },
  {
    id: 'i4',
    text: 'Тема для проекта по физике?',
    src: 'написал',
    from: 'text',
    time: 'вчера',
    hint: 'это вопрос — сохранить в Docs',
    acts: [
      ['В Docs', 'docs'],
      ['В дела', 'planner'],
    ],
  },
  {
    id: 'i5',
    text: 'Купить батарейки для стилуса',
    src: 'голосом',
    from: 'voice',
    time: 'пн',
    hint: 'дело на завтра',
    acts: [
      ['В дела', 'planner'],
      ['Позже', 'later'],
    ],
  },
];

export const PROJECTS: Project[] = [
  { name: 'Олимпиада по информатике', color: 'orange', done: 4, total: 8 },
  { name: 'Школа: 10 класс', color: 'sky', done: 9, total: 12 },
  { name: 'Бот для домашки', color: 'yellow', done: 1, total: 6 },
];

export const BOARD: { name: string; color: ColorName; cards: [string, ColorName, string][] }[] = [
  {
    name: 'Надо',
    color: 'faint',
    cards: [
      ['Задача на графы', 'orange', 'Олимпиада'],
      ['Подарок маме', 'peach', 'Личное'],
      ['Эссе по литературе', 'sky', 'Школа'],
    ],
  },
  {
    name: 'В работе',
    color: 'orange',
    cards: [
      ['ДП на отрезках', 'orange', 'Олимпиада'],
      ['Бот: напоминания', 'yellow', 'Проект'],
    ],
  },
  {
    name: 'Готово',
    color: 'green',
    cards: [
      ['Конспект по физике', 'green', 'Школа'],
      ['Зарядка 5 дней', 'green', 'Личное'],
    ],
  },
];

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
