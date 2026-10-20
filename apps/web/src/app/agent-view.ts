/**
 * Лента «Что сделал агент» (AGT-002): как показать строку ленты человеку — кто, когда,
 * «было → стало» словами. Только преобразования, без запросов (их делает `agent.ts`).
 */
import type { components } from '@qubite/api-client';

type S = components['schemas'];
export type AgentAction = S['AgentAction'];
export type AgentChange = S['AgentChange'];
export type AgentConflict = S['AgentConflict'];
export type AgentPage = S['AgentTimelinePage'];
export type AgentRevertResult = S['AgentRevertResult'];

/** Имя проекта по ID (из Planner); нет — «другой проект». */
export type ProjectName = (id: string) => string | undefined;

const LABEL: Record<string, string> = {
  title: 'Название',
  deleted: 'Корзина',
  due_date: 'Срок',
  due_time: 'Время',
  project_id: 'Проект',
  priority: 'Важность',
  status: 'Статус',
  notes: 'Заметка',
  subtasks: 'Шаги',
  recurrence: 'Повторение',
  color: 'Цвет',
  tag: 'Тег',
  body: 'Текст',
  answer: 'Ответ',
};

const STATUS: Record<string, Record<string, string>> = {
  'planner.task': { todo: 'надо', doing: 'в работе', done: 'сделано' },
  'planner.project': { active: 'идёт', archived: 'в архиве' },
  'inbox.item': { new: 'ждёт разбора', archived: 'разобрана' },
  'agent.question': { open: 'ждёт ответа', answered: 'отвечен', dropped: 'закрыт' },
};

const PRIORITY: Record<string, string> = {
  normal: 'обычное',
  important: 'важное',
  urgent: 'срочное',
};

const COLOR: Record<string, string> = {
  orange: 'оранжевый',
  sky: 'голубой',
  yellow: 'жёлтый',
  green: 'зелёный',
  peach: 'персиковый',
};

const FREQ: Record<string, string> = {
  daily: 'каждый день',
  weekly: 'каждую неделю',
  monthly: 'каждый месяц',
};

export function fieldLabel(field: string): string {
  return LABEL[field] ?? field;
}

function short(text: string, max = 40): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** `2026-10-23` → `23.10` (год — только если не этот). */
export function dateLabel(iso: string, now = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return Number(y) === now.getFullYear() ? `${d}.${mo}` : `${d}.${mo}.${y}`;
}

/** Значение поля словами; `—` — пусто или объекта не было. */
export function valueLabel(
  objectType: string,
  field: string,
  value: unknown,
  projectName: ProjectName,
  now = new Date(),
): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (field) {
    case 'deleted':
      return value ? 'в корзине' : 'на месте';
    case 'due_date':
      return typeof value === 'string' ? dateLabel(value, now) : '—';
    case 'project_id':
      return typeof value === 'string' ? `«${projectName(value) ?? 'другой проект'}»` : '—';
    case 'priority':
      return PRIORITY[String(value)] ?? String(value);
    case 'status':
      return STATUS[objectType]?.[String(value)] ?? String(value);
    case 'color':
      return COLOR[String(value)] ?? String(value);
    case 'subtasks': {
      const n = Array.isArray(value) ? value.length : 0;
      return n ? `${n} ${plural(n, 'шаг', 'шага', 'шагов')}` : '—';
    }
    case 'recurrence': {
      const freq = (value as { freq?: string }).freq;
      return (freq && FREQ[freq]) ?? 'повторяется';
    }
    case 'title':
    case 'notes':
    case 'body':
      return `«${short(String(value))}»`;
    default:
      return typeof value === 'object' ? '…' : String(value);
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

export interface DiffLine {
  label: string;
  before: string;
  after: string;
  /** Строка файла агента: добавлена или убрана (вместо «было → стало»). */
  line?: 'added' | 'removed';
}

/** Какие строки текста убрали и какие добавили (порядок — как в тексте). */
export function lineDiff(before: string, after: string): { removed: string[]; added: string[] } {
  const split = (t: string) => t.split('\n').filter((l) => l.trim() !== '');
  const left = split(before);
  const right = split(after);
  const count = (lines: string[]) => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const keep = (lines: string[], other: Map<string, number>) =>
    lines.filter((l) => {
      const n = other.get(l) ?? 0;
      if (n > 0) {
        other.set(l, n - 1);
        return false;
      }
      return true;
    });
  return { removed: keep(left, count(right)), added: keep(right, count(left)) };
}

/** «Было → стало» одного объекта. У нового объекта «было» — «—», название не повторяем. */
export function diffLines(
  change: AgentChange,
  projectName: ProjectName,
  now = new Date(),
): DiffLine[] {
  return change.diff
    .filter((d) => !(change.created && d.field === 'title'))
    .flatMap((d): DiffLine[] => {
      if (change.object_type === 'agent.file' && d.field === 'body') {
        const { removed, added } = lineDiff(
          typeof d.before === 'string' ? d.before : '',
          typeof d.after === 'string' ? d.after : '',
        );
        return [
          ...removed.map((l) => ({ label: '−', before: l, after: '', line: 'removed' as const })),
          ...added.map((l) => ({ label: '+', before: '', after: l, line: 'added' as const })),
        ];
      }
      return [
        {
          label: fieldLabel(d.field),
          before: valueLabel(change.object_type, d.field, d.before as unknown, projectName, now),
          after: valueLabel(change.object_type, d.field, d.after as unknown, projectName, now),
        },
      ];
    });
}

export interface ConflictLine {
  title: string;
  label: string;
  before: string;
  action: string;
  now: string;
}

/** Три значения конфликта словами: было, сделал агент, сейчас. */
export function conflictLines(
  conflicts: AgentConflict[],
  projectName: ProjectName,
  now = new Date(),
): ConflictLine[] {
  return conflicts.map((c) => ({
    title: c.title,
    label: fieldLabel(c.field),
    before: valueLabel(c.object_type, c.field, c.before as unknown, projectName, now),
    action: valueLabel(c.object_type, c.field, c.action as unknown, projectName, now),
    now: valueLabel(c.object_type, c.field, c.now as unknown, projectName, now),
  }));
}

export function actorLabel(actor: string): string {
  return actor === 'agent' ? 'Агент' : actor === 'owner' ? 'Ты' : 'Qubite';
}

/** `20.10 08:12`; сегодня — только время. */
export function whenLabel(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return sameDay ? time : `${pad(at.getDate())}.${pad(at.getMonth() + 1)} ${time}`;
}

/** Цена вызова AI: `0,4 ¢`; без AI — ничего. */
export function costLabel(micros: number | null | undefined): string | null {
  if (!micros) return null;
  const cents = micros / 10_000;
  return cents < 100
    ? `${cents.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ¢`
    : `$${(cents / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`;
}

/** Действие ещё в силе — его можно откатить. */
export function canRevert(a: AgentAction): boolean {
  return !a.state.reverted_by;
}

/** «Исправить» — у действия агента, которое создало или поменяло дело или проект. */
export function fixTarget(a: AgentAction): AgentChange | undefined {
  if (a.actor !== 'agent' || a.state.reverted_by) return undefined;
  return (
    a.changes.find((c) => c.object_type === 'planner.task') ??
    a.changes.find((c) => c.object_type === 'planner.project')
  );
}
