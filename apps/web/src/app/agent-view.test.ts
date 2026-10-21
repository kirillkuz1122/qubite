import { describe, expect, it } from 'vitest';
import {
  actorLabel,
  asksWhy,
  conflictLines,
  costLabel,
  dateLabel,
  diffLines,
  fixTarget,
  valueLabel,
  whenLabel,
  whyLine,
  type AgentAction,
  type AgentChange,
} from './agent-view';

const NOW = new Date(2026, 9, 20, 21, 5);
const names = (id: string) => (id === 'p1' ? 'Русский' : undefined);

function change(over: Partial<AgentChange>): AgentChange {
  return {
    object_id: 't1',
    object_type: 'planner.task',
    title: 'Упр. 145',
    created: false,
    diff: [],
    ...over,
  } as AgentChange;
}

function action(over: Partial<AgentAction>): AgentAction {
  return {
    id: 'a1',
    seq: 1,
    at: '2026-10-20T08:12:00+05:00',
    actor: 'agent',
    batch_id: 'b1',
    tool: 'task.create',
    summary: 'Создал дело',
    changes: [],
    state: { batch_size: 1, corrected_by: [] },
    ...over,
  } as AgentAction;
}

describe('лента агента словами', () => {
  it('значения полей', () => {
    expect(dateLabel('2026-10-23', NOW)).toBe('23.10');
    expect(dateLabel('2027-01-05', NOW)).toBe('05.01.2027');
    expect(valueLabel('planner.task', 'due_date', null, names)).toBe('—');
    expect(valueLabel('planner.task', 'project_id', 'p1', names)).toBe('«Русский»');
    expect(valueLabel('planner.task', 'project_id', 'p9', names)).toBe('«другой проект»');
    expect(valueLabel('planner.task', 'status', 'doing', names)).toBe('в работе');
    expect(valueLabel('inbox.item', 'status', 'archived', names)).toBe('разобрана');
    expect(valueLabel('planner.task', 'priority', 'urgent', names)).toBe('срочное');
    expect(valueLabel('planner.task', 'deleted', true, names)).toBe('в корзине');
    expect(valueLabel('planner.task', 'subtasks', [{}, {}], names)).toBe('2 шага');
    expect(valueLabel('planner.task', 'recurrence', { freq: 'weekly' }, names)).toBe(
      'каждую неделю',
    );
    expect(valueLabel('planner.task', 'notes', 'а'.repeat(60), names)).toHaveLength(42);
  });

  it('было → стало; у нового объекта название не повторяется', () => {
    const moved = change({
      diff: [{ field: 'due_date', before: '2026-10-22', after: '2026-10-23' }] as never,
    });
    expect(diffLines(moved, names, NOW)).toEqual([
      { label: 'Срок', before: '22.10', after: '23.10' },
    ]);
    const made = change({
      created: true,
      diff: [
        { field: 'title', before: null, after: 'Упр. 145' },
        { field: 'project_id', before: null, after: 'p1' },
      ] as never,
    });
    expect(diffLines(made, names, NOW)).toEqual([
      { label: 'Проект', before: '—', after: '«Русский»' },
    ]);
  });

  it('три значения конфликта', () => {
    const lines = conflictLines(
      [
        {
          action_id: 'a1',
          object_id: 't1',
          object_type: 'planner.task',
          title: 'Музей',
          field: 'due_date',
          before: '2026-10-24',
          action: '2026-10-25',
          now: '2026-10-26',
        } as never,
      ],
      names,
      NOW,
    );
    expect(lines).toEqual([
      { title: 'Музей', label: 'Срок', before: '24.10', action: '25.10', now: '26.10' },
    ]);
  });

  it('кто, когда, цена', () => {
    expect(actorLabel('agent')).toBe('Агент');
    expect(actorLabel('owner')).toBe('Ты');
    expect(whenLabel(new Date(2026, 9, 20, 8, 12).toISOString(), NOW)).toBe('08:12');
    expect(whenLabel(new Date(2026, 9, 19, 17, 40).toISOString(), NOW)).toBe('19.10 17:40');
    expect(costLabel(null)).toBeNull();
    expect(costLabel(4000)).toBe('0,4 ¢');
    expect(costLabel(2_500_000)).toBe('$2,5');
  });

  it('«Исправить» — только у действия агента в силе, с делом или проектом', () => {
    const task = change({});
    expect(fixTarget(action({ changes: [task] }))?.object_id).toBe('t1');
    expect(fixTarget(action({ actor: 'owner', changes: [task] }))).toBeUndefined();
    expect(
      fixTarget(
        action({ changes: [task], state: { batch_size: 1, corrected_by: [], reverted_by: 'r' } }),
      ),
    ).toBeUndefined();
    expect(fixTarget(action({ changes: [change({ object_type: 'inbox.item' })] }))).toBeUndefined();
  });
});

describe('почему откатил (D-397)', () => {
  it('спрашивает только у отката без ответа', () => {
    const asked = { kind: null, answer: '', lesson: false };
    expect(
      asksWhy(action({ reverts: 'a1', state: { batch_size: 1, corrected_by: [], why: asked } })),
    ).toBe(true);
    expect(asksWhy(action({ state: { batch_size: 1, corrected_by: [], why: asked } }))).toBe(false);
    expect(asksWhy(action({ reverts: 'a1' }))).toBe(false);
    expect(
      asksWhy(
        action({
          reverts: 'a1',
          state: {
            batch_size: 1,
            corrected_by: [],
            why: { kind: 'never', answer: '', lesson: true },
          },
        }),
      ),
    ).toBe(false);
  });
  it('ответ словами: урок или нет', () => {
    expect(whyLine({ kind: 'mistake', answer: '', lesson: true })).toBe(
      'почему откатил: ошибся — агент учтёт',
    );
    expect(whyLine({ kind: 'not_now', answer: '', lesson: false })).toBe(
      'почему откатил: не сейчас — не урок',
    );
    expect(whyLine({ kind: 'own', answer: 'физру не делаю', lesson: true })).toBe(
      'почему откатил: «физру не делаю» — агент учтёт',
    );
    expect(whyLine({ kind: null, answer: '', lesson: false })).toBeNull();
    expect(whyLine(undefined)).toBeNull();
  });
});
