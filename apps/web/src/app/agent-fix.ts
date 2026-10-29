import type { AgentChange } from './agent-view';

export type FixPriority = 'normal' | 'important' | 'urgent';

export interface TaskFixValues {
  date: string;
  time: string;
  project: string;
  priority: FixPriority;
}

/** Показанные значения — результат действия агента, а не старое значение before. */
export function taskFixValues(change: AgentChange | undefined): TaskFixValues {
  const after = (field: string) => change?.diff.find((d) => d.field === field)?.after;
  const text = (field: string) => {
    const value = after(field);
    return typeof value === 'string' ? value : '';
  };
  const priority = after('priority');
  return {
    date: text('due_date'),
    time: text('due_time'),
    project: text('project_id'),
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
