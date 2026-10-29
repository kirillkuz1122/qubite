import type { PlannerTask } from '@qubite/sync-client';
import type { AgentChange } from './agent-view';

export type FixPriority = 'normal' | 'important' | 'urgent';

export interface TaskFixValues {
  date: string;
  time: string;
  project: string;
  priority: FixPriority;
}

/**
 * Показанные значения — результат действия агента, а не старое значение before. Поля, которых
 * нет в diff (агент их не менял), берутся из самого дела на устройстве.
 */
export function taskFixValues(
  change: AgentChange | undefined,
  task?: Pick<PlannerTask, 'project_id' | 'priority'>,
): TaskFixValues {
  const after = (field: string) => change?.diff.find((d) => d.field === field)?.after as unknown;
  const text = (field: string) => {
    const value = after(field);
    return typeof value === 'string' ? value : '';
  };
  const known = (field: string) => change?.diff.some((d) => d.field === field) ?? false;
  const priority = known('priority') ? after('priority') : task?.priority;
  return {
    date: text('due_date'),
    time: text('due_time'),
    project: known('project_id') ? text('project_id') : (task?.project_id ?? ''),
    priority: priority === 'important' || priority === 'urgent' ? priority : 'normal',
  };
}

/** В поправку уходят только изменённые поля; пустой проект означает снять привязку. */
export function taskFixFields(
  initial: TaskFixValues,
  current: TaskFixValues,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (current.date !== initial.date) fields.due_date = current.date || null;
  if (current.time !== initial.time || (!current.date && current.time))
    fields.due_time = current.date ? current.time || null : null;
  if (current.project !== initial.project) fields.project_id = current.project || null;
  if (current.priority !== initial.priority) fields.priority = current.priority;
  return fields;
}
