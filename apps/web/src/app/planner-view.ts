/**
 * Настоящие проекты и дела → строки экранов «Сегодня» и Planner в виде DS-007:
 * неделя вокруг сегодняшнего дня, доска «Надо / В работе / Готово», полоски проектов.
 * Чистые функции — их проверяют юнит-тесты.
 */
import type {
  NewTask,
  PlannerProject,
  PlannerTask,
  Priority,
  Recurrence,
} from '@qubite/sync-client';
import type { ColorName, Parsed } from '@qubite/ui';
import { WD_SHORT, weekday, type Day, type Task } from './data';

const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Цвет дела — цвет его проекта; без проекта — оранжевый, как дела из Command. */
export const NO_PROJECT: ColorName = 'orange';

const WD_ON = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

/** «каждый день», «каждый вт и чт», «раз в 2 недели по пн», «каждое 5-е». */
export function repeatLabel(r: Recurrence): string {
  const n = r.interval ?? 1;
  switch (r.freq) {
    case 'daily':
      return n === 1 ? 'каждый день' : `раз в ${n} дн.`;
    case 'weekly': {
      const days = (r.weekdays ?? []).map((d) => WD_ON[d - 1]).filter(Boolean);
      const list = days.length > 1 ? `${days.slice(0, -1).join(', ')} и ${days.at(-1)}` : days[0];
      if (n === 1) return list ? `каждый ${list}` : 'каждую неделю';
      return list ? `раз в ${n} нед. по ${list}` : `раз в ${n} нед.`;
    }
    case 'monthly':
      return r.month_day ? `каждое ${r.month_day}-е` : 'каждый месяц';
  }
}

/** «16:00», «весь день», «без срока», «просрочено». */
export function timeLabel(t: PlannerTask, today: string): string {
  if (!t.due_date) return 'без срока';
  if (t.status !== 'done' && t.due_date < today) return 'просрочено';
  return t.due_time ?? 'весь день';
}

/**
 * Когда напомнит сервер (PLAN-004): «напомню в 15:45», в другой день — «напомню 19.10 в 19:00».
 * Сделанное и без напоминания — ничего.
 */
export function remindLabel(t: PlannerTask): string | null {
  if (!t.remind_at || t.status === 'done') return null;
  const [day, time] = t.remind_at.split('T');
  if (!day || !time) return null;
  if (day === t.due_date) return `напомню в ${time}`;
  const [, m, d] = day.split('-');
  return `напомню ${d}.${m} в ${time}`;
}

/** Подпись под делом: проект · важность · шаги · повторение · напоминание. */
export function metaLabel(t: PlannerTask, project?: PlannerProject): string {
  const steps = t.subtasks.length
    ? `шаги ${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}`
    : null;
  const priority =
    t.priority === 'urgent' ? 'срочно' : t.priority === 'important' ? 'важное' : null;
  return [
    project?.title,
    priority,
    steps,
    t.recurrence && repeatLabel(t.recurrence),
    remindLabel(t),
  ]
    .filter(Boolean)
    .join(' · ');
}

export function toRow(t: PlannerTask, projects: Map<string, PlannerProject>, today: string): Task {
  const project = t.project_id ? projects.get(t.project_id) : undefined;
  const tag = metaLabel(t, project);
  return {
    id: t.id,
    title: t.title,
    color: project?.color ?? NO_PROJECT,
    ...(tag ? { tag } : {}),
    time: timeLabel(t, today),
    done: t.status === 'done',
  };
}

const byTime = (a: PlannerTask, b: PlannerTask) =>
  (a.due_time ?? '99').localeCompare(b.due_time ?? '99') || a.title.localeCompare(b.title, 'ru');

/**
 * Неделя пн…вс вокруг `now`: дела по дням срока. В «сегодня» сверху — просроченные
 * несделанные (Sunsama: ничего не теряется), потом сегодняшние по времени.
 */
export function buildWeek(tasks: PlannerTask[], projects: PlannerProject[], now: Date): Day[] {
  const t = weekday(now);
  const today = iso(now);
  const byId = new Map(projects.map((p) => [p.id, p]));
  return WD_SHORT.map((d, i) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - t + i);
    const day = iso(date);
    const isToday = i === t;
    const own = tasks.filter((x) => x.due_date === day).sort(byTime);
    const overdue = isToday
      ? tasks
          .filter(
            (x) =>
              x.due_date !== null &&
              x.due_date < day &&
              // сделанное сегодня остаётся на месте, а не исчезает из-под пальца
              (x.status !== 'done' ||
                (x.completed_at_ms !== null && iso(new Date(x.completed_at_ms)) === day)),
          )
          .sort((a, b) => a.due_date!.localeCompare(b.due_date!) || byTime(a, b))
      : [];
    return {
      d,
      n: date.getDate(),
      date,
      today: isToday,
      tasks: [...overdue, ...own].map((x) => toRow(x, byId, today)),
    };
  });
}

export interface BoardCard {
  id: string;
  title: string;
  color: ColorName;
  tag: string;
}

export interface BoardColumn {
  /** какой статус у дел в колонке — куда переносит перетаскивание */
  status: PlannerTask['status'];
  name: string;
  color: ColorName;
  cards: BoardCard[];
}

/** Сколько дней «Готово» держит сделанное на доске. */
const DONE_DAYS = 7;

/** Доска на той же модели: «Надо», «В работе», «Готово» (сделанное за неделю). */
export function buildBoard(
  tasks: PlannerTask[],
  projects: PlannerProject[],
  nowMs: number,
): BoardColumn[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const card = (t: PlannerTask): BoardCard => {
    const p = t.project_id ? byId.get(t.project_id) : undefined;
    return {
      id: t.id,
      title: t.title,
      color: p?.color ?? NO_PROJECT,
      tag: p?.title ?? 'Без проекта',
    };
  };
  const open = (s: PlannerTask['status']) =>
    tasks
      .filter((t) => t.status === s)
      .sort((a, b) => (a.due_date ?? '9').localeCompare(b.due_date ?? '9') || byTime(a, b));
  const done = tasks
    .filter((t) => t.status === 'done' && (t.completed_at_ms ?? nowMs) >= nowMs - DONE_DAYS * 864e5)
    .sort((a, b) => (b.completed_at_ms ?? nowMs) - (a.completed_at_ms ?? nowMs));
  return [
    { status: 'todo', name: 'Надо', color: 'faint', cards: open('todo').map(card) },
    { status: 'doing', name: 'В работе', color: 'orange', cards: open('doing').map(card) },
    { status: 'done', name: 'Готово', color: 'green', cards: done.map(card) },
  ];
}

export interface ProjectBar {
  id: string;
  name: string;
  /** тег для Command: `#алгебра` */
  tag: string;
  color: ColorName;
  done: number;
  total: number;
  /** точек в полоске (не больше 12, чтобы влезло на телефоне) */
  dots: number;
  filled: number;
  /** дела проекта: сначала несделанные по сроку, потом сделанные */
  tasks: Task[];
}

const MAX_DOTS = 12;

/** Идущие проекты с прогрессом: сколько дел сделано из всех. */
export function buildProjects(
  projects: PlannerProject[],
  tasks: PlannerTask[],
  today = '',
): ProjectBar[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  return projects
    .filter((p) => p.status === 'active')
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
    .map((p) => {
      const own = tasks.filter((t) => t.project_id === p.id);
      const done = own.filter((t) => t.status === 'done').length;
      const total = own.length;
      const dots = Math.min(total, MAX_DOTS);
      const filled = total > MAX_DOTS ? Math.round((done / total) * MAX_DOTS) : done;
      const rows = [...own]
        .sort(
          (a, b) =>
            Number(a.status === 'done') - Number(b.status === 'done') ||
            (a.due_date ?? '9').localeCompare(b.due_date ?? '9') ||
            byTime(a, b),
        )
        .map((t) => toRow(t, byId, today));
      return {
        id: p.id,
        name: p.title,
        tag: p.tag,
        color: p.color,
        done,
        total,
        dots,
        filled,
        tasks: rows,
      };
    });
}

const FREQ = { day: 'daily', week: 'weekly', month: 'monthly' } as const;
const PRIORITY: Priority[] = ['normal', 'important', 'urgent'];

/**
 * Разбор строки (CMD-003, тот же, что на сервере) → новое дело: название без срока и меток,
 * день и время, повторение, важность, `#проект`. Без дня — сегодня (Q-53).
 * «Каждый год» в модели дел нет — срок остаётся, повторение нет.
 */
export function taskFrom(
  p: Parsed,
  today: string,
): { title: string; tag: string | null; task: NewTask } {
  const due_date = p.due?.date ?? today;
  const freq = p.repeat && p.repeat.every !== 'year' ? FREQ[p.repeat.every] : null;
  const recurrence: Recurrence | null = freq
    ? {
        freq,
        ...(p.repeat!.interval > 1 ? { interval: p.repeat!.interval } : {}),
        ...(freq === 'weekly' && p.repeat!.days.length ? { weekdays: p.repeat!.days } : {}),
      }
    : null;
  return {
    title: p.title.trim(),
    tag: p.project,
    task: {
      due_date,
      ...(p.due?.time ? { due_time: p.due.time } : {}),
      ...(recurrence ? { recurrence } : {}),
      ...(p.priority > 0 ? { priority: PRIORITY[Math.min(p.priority, 2)]! } : {}),
    },
  };
}

/** Название проекта из тега: `алгебра` → «Алгебра», `бот_для_домашки` → «Бот для домашки». */
export function nameFromTag(tag: string): string {
  const text = tag.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
