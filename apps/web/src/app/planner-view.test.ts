import type { PlannerProject, PlannerTask } from '@qubite/sync-client';
import { localNow, parse } from '@qubite/ui';
import { describe, expect, it } from 'vitest';
import {
  remindLabel,
  buildBoard,
  buildProjects,
  buildWeek,
  nameFromTag,
  repeatLabel,
  taskFrom,
} from './planner-view';

/* вторник, 20 октября 2026, 10:30 */
const NOW = new Date(2026, 9, 20, 10, 30);

const algebra: PlannerProject = {
  id: 'p1',
  title: 'Алгебра',
  color: 'sky',
  tag: 'алгебра',
  status: 'active',
  notes: '',
  pending: false,
};

function task(id: string, fields: Partial<PlannerTask>): PlannerTask {
  return {
    id,
    title: id,
    status: 'todo',
    priority: 'normal',
    due_date: null,
    due_time: null,
    subtasks: [],
    recurrence: null,
    project_id: null,
    notes: '',
    completed_at_ms: null,
    remind_at: null,
    remind_why: '',
    remind_by: 'auto',
    pending: false,
    ...fields,
  };
}

describe('настоящие дела в виде DS-007', () => {
  it('неделя: дела по дням, в «сегодня» сверху просроченные', () => {
    const tasks = [
      task('№ 214', {
        due_date: '2026-10-20',
        due_time: '18:00',
        project_id: 'p1',
        priority: 'urgent',
        subtasks: [
          { id: 'a', title: 'a', done: true },
          { id: 'b', title: 'b', done: false },
        ],
      }),
      task('Зарядка', {
        due_date: '2026-10-20',
        due_time: '07:30',
        status: 'done',
        recurrence: { freq: 'daily' },
      }),
      task('Эссе', { due_date: '2026-10-19' }),
      task('Сделано вчера', { due_date: '2026-10-19', status: 'done' }),
      task('Пятница', { due_date: '2026-10-23' }),
      task('Без срока', {}),
    ];
    const week = buildWeek(tasks, [algebra], NOW);
    const today = week[1]!;
    expect(today.today).toBe(true);
    expect(today.tasks.map((t) => [t.title, t.time])).toEqual([
      ['Эссе', 'просрочено'],
      ['Зарядка', '07:30'],
      ['№ 214', '18:00'],
    ]);
    expect(today.tasks[2]).toMatchObject({ color: 'sky', tag: 'Алгебра · срочно · шаги 1/2' });
    expect(today.tasks[1]).toMatchObject({ done: true, color: 'orange', tag: 'каждый день' });
    expect(week[0]!.tasks.map((t) => t.title)).toEqual(['Сделано вчера', 'Эссе']);
    expect(week[4]!.tasks[0]).toMatchObject({ title: 'Пятница', time: 'весь день' });
    expect(week.flatMap((d) => d.tasks).some((t) => t.title === 'Без срока')).toBe(false);
  });

  it('просроченное, сделанное сегодня, не исчезает из «Сегодня»', () => {
    const done = task('Эссе', {
      due_date: '2026-10-19',
      status: 'done',
      completed_at_ms: NOW.getTime(),
    });
    expect(buildWeek([done], [], NOW)[1]!.tasks.map((t) => t.title)).toEqual(['Эссе']);
  });

  it('доска и полоски проектов', () => {
    const tasks = [
      task('надо', { project_id: 'p1' }),
      task('в работе', { status: 'doing' }),
      task('готово', { status: 'done', project_id: 'p1', completed_at_ms: NOW.getTime() }),
      task('давно', { status: 'done', completed_at_ms: NOW.getTime() - 30 * 864e5 }),
    ];
    const board = buildBoard(tasks, [algebra], NOW.getTime());
    expect(board.map((c) => [c.name, c.cards.map((x) => x.title)])).toEqual([
      ['Надо', ['надо']],
      ['В работе', ['в работе']],
      ['Готово', ['готово']],
    ]);
    expect(board[0]!.cards[0]).toMatchObject({ color: 'sky', tag: 'Алгебра' });
    expect(board[1]!.cards[0]!.tag).toBe('Без проекта');
    const many = Array.from({ length: 24 }, (_, i) =>
      task(`д${i}`, { project_id: 'p1', status: i < 6 ? 'done' : 'todo' }),
    );
    expect(buildProjects([algebra], many)[0]).toMatchObject({
      done: 6,
      total: 24,
      dots: 12,
      filled: 3,
    });
  });

  it('повторения, срок из Command, имя проекта из тега', () => {
    expect(repeatLabel({ freq: 'weekly', weekdays: [2] })).toBe('каждый вт');
    expect(repeatLabel({ freq: 'weekly', weekdays: [1, 3, 5] })).toBe('каждый пн, ср и пт');
    expect(repeatLabel({ freq: 'weekly', interval: 2, weekdays: [1] })).toBe('раз в 2 нед. по пн');
    expect(repeatLabel({ freq: 'monthly', month_day: 5 })).toBe('каждое 5-е');
    const task = (text: string) => taskFrom(parse(text, localNow(NOW))!, '2026-10-20');
    expect(task('#алгебра решить № 214 завтра в 16:00 !!')).toEqual({
      title: 'решить № 214',
      tag: 'алгебра',
      task: { due_date: '2026-10-21', due_time: '16:00', priority: 'urgent' },
    });
    expect(task('позвонить бабушке').task).toEqual({ due_date: '2026-10-20' });
    expect(task('зарядка каждый вторник и четверг в 7 утра').task).toMatchObject({
      due_time: '07:00',
      recurrence: { freq: 'weekly', weekdays: [2, 4] },
    });
    expect(task('дело: зарядка каждый день').task.recurrence).toEqual({ freq: 'daily' });
    expect(nameFromTag('бот_для_домашки')).toBe('Бот для домашки');
  });
});

describe('напоминание у дела (PLAN-004)', () => {
  it('«напомню в 15:45», в другой день — с датой, сделанное — ничего', () => {
    const t = task('Контрольная', { due_date: '2026-10-20', due_time: '16:00' });
    expect(remindLabel(t)).toBeNull();
    expect(remindLabel({ ...t, remind_at: '2026-10-20T15:45' })).toBe('напомню в 15:45');
    expect(remindLabel({ ...t, remind_at: '2026-10-19T19:00' })).toBe('напомню 19.10 в 19:00');
    expect(remindLabel({ ...t, remind_at: '2026-10-20T15:45', status: 'done' })).toBeNull();
  });
});
