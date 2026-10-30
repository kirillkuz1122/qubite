import type { PlannerTask } from '@qubite/sync-client';
import { describe, expect, it } from 'vitest';
import {
  buildAgenda,
  countsLabel,
  dueLabel,
  feedLine,
  fieldsLabel,
  fileUrl,
  projectFromPath,
  projectPath,
  sizeLabel,
  type ProjectFeedItem,
} from './project-view';

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
    project_id: 'p',
    notes: '',
    place_text: null,
    travel_minutes: null,
    completed_at_ms: null,
    remind_at: null,
    remind_why: '',
    remind_by: 'auto',
    pending: false,
    ...fields,
  };
}

const feed = (fields: Partial<ProjectFeedItem>): ProjectFeedItem => ({
  seq: 1,
  at: '2026-10-22T10:00:00Z',
  kind: 'created',
  object: 'task',
  object_id: 'x',
  title: 'Календарь',
  details: [],
  by: 'owner',
  ...fields,
});

describe('страница проекта (PROJ-001)', () => {
  it('адрес страницы проекта туда и обратно', () => {
    expect(projectPath('abc')).toBe('/planner/project/abc');
    expect(projectFromPath('/planner/project/abc')).toBe('abc');
    expect(projectFromPath('/planner/project/abc/')).toBe('abc');
    expect(projectFromPath('/planner')).toBeNull();
    expect(projectFromPath('/planner/project/')).toBeNull();
  });

  it('«События»: дела со сроком по дням, просроченное сверху, без срока — нет', () => {
    const today = '2026-10-22';
    const days = buildAgenda(
      [
        task('Без срока', {}),
        task('Старое сделанное', { due_date: '2026-10-20', status: 'done' }),
        task('Забыл', { due_date: '2026-10-21' }),
        task('Вечером', { due_date: today, due_time: '19:00' }),
        task('Утром', { due_date: today, due_time: '09:00' }),
        task('Весь день', { due_date: today }),
        task('Завтра', { due_date: '2026-10-23', status: 'done' }),
        task('Потом', { due_date: '2026-10-30' }),
      ],
      [{ id: 'e', title: 'Встреча', date: '2026-10-23', time: '15:00' }],
      today,
    );
    expect(days.map((d) => d.label)).toEqual([
      'Просрочено',
      'сегодня, чт, 22 октября',
      'завтра, пт, 23 октября',
      'пт, 30 октября',
    ]);
    expect(days[0]!.items.map((i) => i.title)).toEqual(['Забыл']);
    expect(days[1]!.items.map((i) => i.title)).toEqual(['Весь день', 'Утром', 'Вечером']);
    expect(days[2]!.items).toMatchObject([
      { title: 'Завтра', done: true, kind: 'task' },
      { title: 'Встреча', time: '15:00', kind: 'event' },
    ]);
  });

  it('срок дела в списке', () => {
    expect(dueLabel(null, '2026-10-22')).toBe('без срока');
    expect(dueLabel('2026-10-22', '2026-10-22')).toBe('сегодня');
    expect(dueLabel('2026-10-23', '2026-10-22')).toBe('завтра');
    expect(dueLabel('2026-10-21', '2026-10-22')).toBe('вчера');
    expect(dueLabel('2026-10-30', '2026-10-22')).toBe('пт, 30 октября');
  });

  it('«Лента» простыми словами', () => {
    expect(feedLine(feed({}))).toBe('Дело «Календарь» — новое');
    expect(feedLine(feed({ kind: 'done' }))).toBe('Дело «Календарь» — сделано');
    expect(feedLine(feed({ kind: 'changed', details: ['due_date', 'due_time', 'remind'] }))).toBe(
      'Дело «Календарь»: срок, время, напоминание',
    );
    expect(feedLine(feed({ kind: 'deleted' }))).toBe('Дело «Календарь» — в корзине');
    expect(feedLine(feed({ object: 'project', title: 'Qubite' }))).toBe('Проект «Qubite» создан');
    expect(
      feedLine(feed({ object: 'project', kind: 'changed', details: ['notes', 'color'] })),
    ).toBe('Проект: описание, цвет');
    expect(feedLine(feed({ object: 'project', kind: 'file_added', details: ['план.pdf'] }))).toBe(
      'Файл «план.pdf» добавлен',
    );
    expect(feedLine(feed({ object: 'doc', title: 'Устройство' }))).toBe(
      'Документ «Устройство» — новый',
    );
    expect(feedLine(feed({ object: 'doc', kind: 'doc_unlinked', title: 'Устройство' }))).toBe(
      'Документ «Устройство» — убран из проекта',
    );
    expect(fieldsLabel('task', ['notes', 'notes'])).toBe('заметка');
  });

  it('размер файла, счётчики и адрес файла', () => {
    expect(sizeLabel(512)).toBe('512 Б');
    expect(sizeLabel(1536)).toBe('1,5 КБ');
    expect(sizeLabel(3.4 * 1024 * 1024)).toBe('3,4 МБ');
    expect(countsLabel(1, 2, 5)).toBe('1 дело · 2 файла · 5 документов');
    expect(countsLabel(0, 1, null)).toBe('0 дел · 1 файл');
    expect(fileUrl('p', 'отчёт (2).pdf')).toBe(
      '/api/v1/projects/p/files/%D0%BE%D1%82%D1%87%D1%91%D1%82%20(2).pdf',
    );
  });
});
