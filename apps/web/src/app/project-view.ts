/**
 * Страница проекта (PROJ-001): чистые функции — их проверяют юнит-тесты.
 * Лента «События» по дням, подписи строк «Ленты», размер файла.
 */
import type { BoardColumn, PlannerTask, ProjectBoard } from '@qubite/sync-client';
import type { components } from '@qubite/api-client';
import { dayLabel, plural } from './data';

export type ProjectPage = components['schemas']['ProjectPage'];
export type ProjectFeedItem = components['schemas']['ProjectFeedItem'];
export type ProjectFileItem = components['schemas']['ProjectFileItem'];
export type ProjectDocItem = components['schemas']['ProjectDocItem'];
export type ProjectDoc = components['schemas']['ProjectDoc'];
export type ProjectEventItem = components['schemas']['ProjectEventItem'];

/** Вкладки страницы проекта — в этом порядке въезжают в `Swap`. */
export type ProjectTab = 'tasks' | 'events' | 'files' | 'memory' | 'feed';
export const PROJECT_TABS: readonly ProjectTab[] = ['tasks', 'events', 'files', 'memory', 'feed'];

/** Адрес страницы проекта (прямая ссылка). */
export const projectPath = (id: string) => `/planner/project/${id}`;

/** ID проекта из адреса `/planner/project/<id>`; другой адрес — `null`. */
export function projectFromPath(path: string): string | null {
  const m = path.match(/^\/planner\/project\/([^/?#]+)\/?$/);
  return m ? decodeURIComponent(m[1]!) : null;
}

// ---------------------------------------------------------------- доска проекта

/** Новая копия: правка вида или колонок не меняет исходную настройку проекта. */
export function projectBoard(board: ProjectBoard | null | undefined): ProjectBoard {
  return {
    view: board?.view ?? 'board',
    columns: board
      ? board.columns.map((column) => ({ ...column }))
      : [
          { status: 'todo', title: 'Надо' },
          { status: 'doing', title: 'В работе' },
          { status: 'done', title: 'Готово' },
        ],
  };
}

export interface ProjectTaskColumn extends BoardColumn {
  tasks: PlannerTask[];
}

/** D-782: скрытый статус показываем в первой колонке, само дело не меняем. */
export function buildProjectColumns(
  tasks: readonly PlannerTask[],
  board: ProjectBoard | null | undefined,
): ProjectTaskColumn[] {
  const columns = projectBoard(board).columns.map((column) => ({
    ...column,
    tasks: [] as PlannerTask[],
  }));
  for (const task of tasks) {
    const column = columns.find((column) => column.status === task.status) ?? columns[0];
    column?.tasks.push(task);
  }
  return columns;
}

// ---------------------------------------------------------------- события по дням

/** Строка ленты «События»: дело со сроком или событие календаря (CAL-001). */
export interface AgendaItem {
  id: string;
  kind: 'task' | 'event';
  title: string;
  /** `16:00`; `null` — весь день */
  time: string | null;
  done: boolean;
}

export interface AgendaDay {
  /** `2026-10-23`; у просроченного — `overdue` */
  date: string;
  label: string;
  items: AgendaItem[];
}

const parseDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};

/** «сегодня, чт, 23 октября», «завтра, …», иначе «пт, 24 октября». */
export function agendaLabel(date: string, today: string): string {
  const d = parseDay(date);
  const diff = Math.round((d.getTime() - parseDay(today).getTime()) / 864e5);
  const day = dayLabel(d, true);
  if (diff === 0) return `сегодня, ${day}`;
  if (diff === 1) return `завтра, ${day}`;
  return day;
}

/** Срок дела в списке проекта: «сегодня», «завтра», «пт, 24 октября», «без срока». */
export function dueLabel(date: string | null, today: string): string {
  if (!date) return 'без срока';
  const d = parseDay(date);
  const diff = Math.round((d.getTime() - parseDay(today).getTime()) / 864e5);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === -1) return 'вчера';
  return dayLabel(d, true);
}

/**
 * Дела проекта со сроком и события по дням, от сегодня вперёд. Несделанное с прошедшим сроком —
 * сверху, в «Просрочено»; сделанное в прошлом не показываем. В дне — сначала «весь день»,
 * потом по времени. События календаря придут с CAL-001 (D-472) — точка подключения `events`.
 */
export function buildAgenda(
  tasks: PlannerTask[],
  events: ProjectEventItem[],
  today: string,
): AgendaDay[] {
  const overdue: AgendaItem[] = [];
  const days = new Map<string, AgendaItem[]>();
  const put = (date: string, item: AgendaItem) => {
    const list = days.get(date) ?? [];
    list.push(item);
    days.set(date, list);
  };
  for (const t of tasks) {
    if (!t.due_date) continue;
    const item: AgendaItem = {
      id: t.id,
      kind: 'task',
      title: t.title,
      time: t.due_time,
      done: t.status === 'done',
    };
    if (t.due_date < today) {
      if (!item.done) overdue.push(item);
    } else put(t.due_date, item);
  }
  for (const e of events) {
    if (e.date < today) continue;
    put(e.date, { id: e.id, kind: 'event', title: e.title, time: e.time ?? null, done: false });
  }
  const order = (a: AgendaItem, b: AgendaItem) =>
    (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title, 'ru');
  const result: AgendaDay[] = [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({ date, label: agendaLabel(date, today), items: items.sort(order) }));
  if (overdue.length)
    result.unshift({ date: 'overdue', label: 'Просрочено', items: overdue.sort(order) });
  return result;
}

// ---------------------------------------------------------------- лента

const FIELD: Record<string, string> = {
  title: 'название',
  due_date: 'срок',
  due_time: 'время',
  status: 'статус',
  priority: 'важность',
  notes: 'заметка',
  subtasks: 'шаги',
  recurrence: 'повторение',
  remind: 'напоминание',
  remind_why: 'напоминание',
  remind_by: 'напоминание',
  project_id: 'проект',
  color: 'цвет',
  board: 'доска',
  tag: 'тег',
  body: 'текст',
};

const OBJECT: Record<string, string> = { project: 'Проект', task: 'Дело', doc: 'Документ' };

/** Что поменялось — словами, без повторов: «срок, время». */
export function fieldsLabel(object: string, fields: string[]): string {
  const words = fields.map((f) =>
    object === 'project' && f === 'notes' ? 'описание' : (FIELD[f] ?? f),
  );
  return [...new Set(words)].join(', ');
}

/** Строка «Ленты» проекта простыми словами. */
export function feedLine(item: ProjectFeedItem): string {
  const what = OBJECT[item.object] ?? 'Объект';
  const name = item.object === 'project' ? what : `${what} «${item.title}»`;
  switch (item.kind) {
    case 'created':
      if (item.object === 'project') return `Проект «${item.title}» создан`;
      return item.object === 'doc' ? `${name} — новый` : `${name} — новое`;
    case 'done':
      return `${name} — сделано`;
    case 'changed':
      return item.details.length ? `${name}: ${fieldsLabel(item.object, item.details)}` : name;
    case 'deleted':
      return `${name} — в корзине`;
    case 'restored':
      return `${name} — вернул из корзины`;
    case 'file_added':
      return `Файл «${item.details[0] ?? ''}» добавлен`;
    case 'file_removed':
      return `Файл «${item.details[0] ?? ''}» убран`;
    case 'doc_linked':
      return `${name} — в проекте`;
    case 'doc_unlinked':
      return `${name} — убран из проекта`;
    default:
      return name;
  }
}

/** «23 окт, 16:05» (сегодня — только время). */
export function feedWhen(at: string, now = new Date()): string {
  const d = new Date(at);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}, ${time}`;
}

const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

// ---------------------------------------------------------------- файлы

/** «512 Б», «1,2 КБ», «3,4 МБ». */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} КБ`;
  return `${(kb / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`;
}

/** Самый большой файл — как на сервере (D-473). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** «3 дела · 2 файла · 1 документ». */
export function countsLabel(tasks: number, files: number, docs: number | null): string {
  const parts = [
    `${tasks} ${plural(tasks, 'дело', 'дела', 'дел')}`,
    `${files} ${plural(files, 'файл', 'файла', 'файлов')}`,
  ];
  if (docs !== null) parts.push(`${docs} ${plural(docs, 'документ', 'документа', 'документов')}`);
  return parts.join(' · ');
}

/** Адрес файла проекта (скачать или показать). */
export const fileUrl = (project: string, name: string) =>
  `/api/v1/projects/${project}/files/${encodeURIComponent(name)}`;
