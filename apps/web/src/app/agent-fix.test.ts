import { describe, expect, it } from 'vitest';
import { taskFixFields, taskFixValues } from './agent-fix';
import type { AgentChange } from './agent-view';

function change(values: Record<string, string | null>): AgentChange {
  return {
    object_id: 't1',
    object_type: 'planner.task',
    title: 'Сделать упражнение',
    created: false,
    diff: Object.entries(values).map(([field, after]) => ({ field, before: null, after })),
  };
}

describe('поля поправки к делу агента', () => {
  it('берёт проект и важность из результата действия', () => {
    expect(
      taskFixValues(change({ project_id: 'p1', priority: 'urgent', due_date: '2026-10-30' })),
    ).toEqual({ date: '2026-10-30', time: '', project: 'p1', priority: 'urgent' });
  });

  it('не подставляет before вместо отсутствующего проекта в after', () => {
    const c = change({ project_id: null, priority: 'important' });
    c.diff[0]!.before = 'старый-проект';
    expect(taskFixValues(c)).toMatchObject({ project: '', priority: 'important' });
  });

  it('пустой снимок и незнакомая важность дают обычное дело без проекта', () => {
    const empty = { date: '', time: '', project: '', priority: 'normal' };
    expect(taskFixValues(undefined)).toEqual(empty);
    expect(taskFixValues(change({ priority: 'неизвестно' }))).toEqual(empty);
  });

  it('без изменений не отправляет ни одно поле, даже если их не было в diff', () => {
    for (const c of [undefined, change({ project_id: 'p1', priority: 'urgent' })]) {
      const initial = taskFixValues(c);
      expect(taskFixFields(initial, { ...initial })).toEqual({});
    }
  });

  it('отправляет только выбранный проект', () => {
    const initial = taskFixValues(change({ project_id: 'p1', priority: 'important' }));
    expect(taskFixFields(initial, { ...initial, project: 'p2' })).toEqual({ project_id: 'p2' });
  });

  it('«Без проекта» снимает привязку через null', () => {
    const initial = taskFixValues(change({ project_id: 'p1' }));
    expect(taskFixFields(initial, { ...initial, project: '' })).toEqual({ project_id: null });
  });

  it.each(['normal', 'important', 'urgent'] as const)(
    'передаёт важность %s без остальных полей',
    (priority) => {
      const initial = taskFixValues(
        change({ priority: priority === 'urgent' ? 'normal' : 'urgent', project_id: 'p1' }),
      );
      expect(taskFixFields(initial, { ...initial, priority })).toEqual({ priority });
    },
  );

  it('поля, которых не было в diff, отправляет только после выбора', () => {
    const initial = taskFixValues(change({ due_date: '2026-10-30' }));
    expect(taskFixFields(initial, { ...initial, project: 'p2', priority: 'urgent' })).toEqual({
      project_id: 'p2',
      priority: 'urgent',
    });
  });

  it('возврат к исходным значениям не оставляет лишних полей', () => {
    const initial = taskFixValues(change({ project_id: 'p1', priority: 'important' }));
    const edited = { ...initial, project: 'p2', priority: 'urgent' as const };
    const restored = { ...edited, project: 'p1', priority: 'important' as const };
    expect(taskFixFields(initial, restored)).toEqual({});
  });

  it('сохраняет исправление срока и сбрасывает время при снятии даты', () => {
    const initial = taskFixValues(change({ due_date: '2026-10-30', due_time: '18:00' }));
    expect(taskFixFields(initial, { ...initial, date: '' })).toEqual({
      due_date: null,
      due_time: null,
    });
    expect(taskFixFields(initial, { ...initial, time: '19:00' })).toEqual({
      due_time: '19:00',
    });
  });
});
