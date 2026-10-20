/**
 * Planner поверх клиента синхронизации (PLAN-001): проекты и дела.
 *
 * Всё сначала записывается на устройство — работает без сети. Поля и правила
 * — как в Rust-модуле `qubite-planner`: дело входит в проект (`project_id`),
 * у него шаги с галочками, важность, срок (день и время по часам владельца) и
 * повторение. Следующее повторяющееся дело создаёт сервер, когда текущее
 * выполнено, — на устройстве оно появится после синхронизации.
 */
import type { SyncClient } from './client';
import type { Fields } from './protocol';
import type { LocalObject } from './store';
import { uuidv7 } from './uuid';

export const PLANNER_PROJECT = 'planner.project';
export const PLANNER_TASK = 'planner.task';
/** Как на сервере (`qubite_planner::MAX_TAG_CHARS`). */
export const MAX_TAG_CHARS = 64;

export type TaskStatus = 'todo' | 'doing' | 'done';
export type Priority = 'normal' | 'important' | 'urgent';
export type ProjectColor = 'orange' | 'sky' | 'yellow' | 'green' | 'peach';
export const PROJECT_COLORS: ProjectColor[] = ['orange', 'sky', 'yellow', 'green', 'peach'];

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

/** «Каждый день», «каждый вторник» (`weekdays: [2]`), «каждое 5-е» (`month_day: 5`). */
export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly';
  interval?: number;
  /** 1 — понедельник … 7 — воскресенье */
  weekdays?: number[];
  month_day?: number;
}

export interface NewTask {
  status?: TaskStatus;
  priority?: Priority;
  /** `ГГГГ-ММ-ДД` */
  due_date?: string | null;
  /** `ЧЧ:ММ`, только вместе с днём */
  due_time?: string | null;
  subtasks?: Subtask[];
  recurrence?: Recurrence | null;
  project_id?: string | null;
  notes?: string;
  /** мысль во Входящих, из которой сделано дело */
  from_inbox?: string;
}

/** Что можно поменять у дела: только меняющиеся поля, `null` — очистить. */
export type TaskPatch = Omit<NewTask, 'from_inbox'>;

/** Дело, как его видят экраны. */
export interface PlannerTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  due_time: string | null;
  subtasks: Subtask[];
  recurrence: Recurrence | null;
  project_id: string | null;
  notes: string;
  completed_at_ms: number | null;
  /**
   * Когда напомнит сервер (по часам владельца, `2026-10-20T15:45`) и почему; `null` — не напомнит
   * (дело без времени — о нём вспомнит агент). Считает сервер (PLAN-004).
   */
  remind_at: string | null;
  remind_why: string;
  /** кто выбрал время: `auto` — по смыслу дела, `owner` — сам, `agent` — агент */
  remind_by: 'auto' | 'owner' | 'agent';
  /** ещё не подтверждено сервером */
  pending: boolean;
}

export interface PlannerProject {
  id: string;
  title: string;
  color: ProjectColor;
  tag: string;
  status: 'active' | 'archived';
  pending: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Локальный день устройства: `2026-10-20`. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Тег проекта, как на сервере: «Олимпиада по информатике» → `олимпиада_по_информатике`. */
export function tagFrom(text: string): string {
  const tag = Array.from(
    text
      .split(/[\s#]+/u)
      .filter(Boolean)
      .map((w) => w.toLowerCase())
      .join('_'),
  )
    .slice(0, MAX_TAG_CHARS)
    .join('');
  return tag || 'проект';
}

/**
 * `#алгебра решить № 214` → `{ title: 'решить № 214', tag: 'алгебра' }`.
 * Берётся первый `#тег`; остальные остаются в тексте.
 */
export function splitProjectTag(text: string): { title: string; tag: string | null } {
  const m = text.match(/(^|\s)#([^\s#]+)/u);
  if (!m) return { title: text.trim(), tag: null };
  const title = (text.slice(0, m.index) + text.slice(m.index! + m[0].length))
    .replace(/\s+/gu, ' ')
    .trim();
  return { title, tag: tagFrom(m[2]!) };
}

/** Проект по `#тегу`: точное совпадение, иначе единственный с таким началом. */
export function findProject<T extends { tag: string }>(projects: T[], tag: string): T | undefined {
  const want = tagFrom(tag);
  const exact = projects.find((p) => p.tag.toLowerCase() === want);
  if (exact) return exact;
  const starts = projects.filter((p) => p.tag.toLowerCase().startsWith(want));
  return starts.length === 1 ? starts[0] : undefined;
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);

export function toTask(o: LocalObject): PlannerTask {
  const f = o.fields ?? {};
  const status = str(f.status);
  const priority = str(f.priority);
  return {
    id: o.id,
    title: o.title,
    status: status === 'doing' || status === 'done' ? status : 'todo',
    priority: priority === 'important' || priority === 'urgent' ? priority : 'normal',
    due_date: str(f.due_date),
    due_time: str(f.due_time),
    subtasks: Array.isArray(f.subtasks) ? (f.subtasks as Subtask[]) : [],
    recurrence:
      f.recurrence && typeof f.recurrence === 'object' ? (f.recurrence as Recurrence) : null,
    project_id: str(f.project_id),
    notes: str(f.notes) ?? '',
    completed_at_ms: typeof f.completed_at_ms === 'number' ? f.completed_at_ms : null,
    remind_at: str(f.remind_at),
    remind_why: str(f.remind_why) ?? '',
    remind_by: f.remind_by === 'owner' || f.remind_by === 'agent' ? f.remind_by : 'auto',
    pending: o.pending,
  };
}

export function toProject(o: LocalObject): PlannerProject {
  const f = o.fields ?? {};
  const color = str(f.color) as ProjectColor | null;
  return {
    id: o.id,
    title: o.title,
    color: color && PROJECT_COLORS.includes(color) ? color : 'orange',
    tag: str(f.tag) ?? tagFrom(o.title),
    status: f.status === 'archived' ? 'archived' : 'active',
    pending: o.pending,
  };
}

/** Живые проекты и дела на устройстве. */
export async function plannerData(
  client: SyncClient,
): Promise<{ projects: PlannerProject[]; tasks: PlannerTask[] }> {
  const live = await client.list();
  return {
    projects: live.filter((o) => o.object_type === PLANNER_PROJECT).map(toProject),
    tasks: live.filter((o) => o.object_type === PLANNER_TASK).map(toTask),
  };
}

export async function createProject(
  client: SyncClient,
  name: string,
  options: { color?: ProjectColor; tag?: string } = {},
): Promise<LocalObject> {
  const title = name.trim();
  if (!title) throw new Error('у проекта нужно название');
  const fields: Fields = { tag: tagFrom(options.tag ?? title) };
  if (options.color) fields.color = options.color;
  return client.create(PLANNER_PROJECT, title, fields, { color: 'orange', status: 'active' });
}

/** Новый шаг с галочкой (ID придумывает устройство). */
export function newSubtask(title: string): Subtask {
  return { id: uuidv7(), title: title.trim(), done: false };
}

export async function createTask(
  client: SyncClient,
  title: string,
  task: NewTask = {},
): Promise<LocalObject> {
  const name = title.trim();
  if (!name) throw new Error('у дела нужно название');
  const fields: Fields = Object.fromEntries(
    Object.entries(task).filter(([, v]) => v !== undefined),
  );
  return client.create(PLANNER_TASK, name, fields, {
    status: 'todo',
    priority: 'normal',
    subtasks: [],
    notes: '',
    ...(task.status === 'done' ? { completed_at_ms: Date.now() } : {}),
  });
}

/** Изменить дело (без сети — тоже). */
export function patchTask(client: SyncClient, id: string, patch: TaskPatch): Promise<LocalObject> {
  const fields: Fields = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  );
  return client.patch(id, fields);
}

/** Отметить сделанным или вернуть. */
export function setTaskDone(client: SyncClient, id: string, done: boolean): Promise<LocalObject> {
  return client.patch(
    id,
    { status: done ? 'done' : 'todo' },
    { completed_at_ms: done ? Date.now() : null },
  );
}

/** Галочка шага: весь список уходит целиком (так его проверяет сервер). */
export async function toggleSubtask(
  client: SyncClient,
  id: string,
  step: string,
  done: boolean,
): Promise<LocalObject> {
  const object = await client.get(id);
  if (!object) throw new Error(`дело ${id} не найдено на устройстве`);
  const subtasks = toTask(object).subtasks.map((s) => (s.id === step ? { ...s, done } : s));
  return patchTask(client, id, { subtasks });
}
