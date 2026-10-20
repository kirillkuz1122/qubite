import type { PlannerProject, PlannerTask } from '@qubite/sync-client';
import { describe, expect, it } from 'vitest';
import {
  ago,
  dayName,
  digestTarget,
  heldLine,
  rateChange,
  rateValue,
  temp,
  upcoming,
} from './home-view';

const task = (over: Partial<PlannerTask>): PlannerTask => ({
  id: 't',
  title: 'Дело',
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
  ...over,
});

// вторник, 20 октября 2026
const NOW = new Date(2026, 9, 20, 9, 0);

describe('ближайшие сроки', () => {
  const project = { id: 'p', title: 'Русский', color: 'sky', tag: 'русский' } as PlannerProject;

  it('неделя вперёд без сегодняшних и сделанных, по дню и времени', () => {
    const list = upcoming(
      [
        task({ id: 'today', due_date: '2026-10-20' }),
        task({ id: 'late', title: 'Поздно', due_date: '2026-10-22', due_time: '18:00' }),
        task({ id: 'early', title: 'Рано', due_date: '2026-10-22', due_time: '08:00' }),
        task({ id: 'tomorrow', title: 'Упр. 145', due_date: '2026-10-21', project_id: 'p' }),
        task({ id: 'done', due_date: '2026-10-21', status: 'done' }),
        task({ id: 'far', due_date: '2026-10-28' }),
        task({ id: 'edge', title: 'Через неделю', due_date: '2026-10-27' }),
        task({ id: 'none' }),
      ],
      [project],
      NOW,
    );
    expect(list.map((u) => u.id)).toEqual(['tomorrow', 'early', 'late', 'edge']);
    expect(list[0]).toMatchObject({ when: 'завтра · весь день', color: 'sky', project: 'Русский' });
    expect(list[1]!.when).toBe('чт, 22 окт · 08:00');
    expect(list[1]!.color).toBe('orange');
  });

  it('дни по-человечески', () => {
    expect(dayName('2026-10-20', NOW)).toBe('сегодня');
    expect(dayName('2026-10-21', NOW)).toBe('завтра');
    expect(dayName('2026-11-02', NOW)).toBe('пн, 2 ноя');
  });
});

describe('сводка от AI', () => {
  it('пункт ведёт к делу, мысли, ленте или статье', () => {
    expect(
      digestTarget({
        kind: 'important',
        text: 'x',
        link: { type: 'task', id: 'a', title: 'Упр. 145', url: null },
      }),
    ).toEqual({ section: 'planner', obj: 'a', label: 'дело «Упр. 145»' });
    expect(
      digestTarget({
        kind: 'question',
        text: 'x',
        link: { type: 'inbox', id: 'b', title: 'тетради' },
      }),
    ).toEqual({ section: 'inbox', label: 'мысль «тетради»' });
    expect(digestTarget({ kind: 'noticed', text: 'x', link: { type: 'action', id: 'c' } })).toEqual(
      {
        section: 'agent',
        label: 'в ленте агента',
      },
    );
    expect(
      digestTarget({ kind: 'news', text: 'x', link: { type: 'url', url: 'https://habr.com/a' } }),
    ).toEqual({ url: 'https://habr.com/a', label: 'статья' });
    // ссылка не https — не ссылка
    expect(
      digestTarget({ kind: 'news', text: 'x', link: { type: 'url', url: 'javascript:alert(1)' } }),
    ).toBeNull();
  });
});

describe('погода и курсы', () => {
  it('температура с настоящим минусом', () => {
    expect(temp(-3.4)).toBe('−3°');
    expect(temp(4.6)).toBe('+5°');
    expect(temp(-0.2)).toBe('0°');
  });

  it('курс и изменение', () => {
    expect(rateValue(81.5, 1)).toBe('81,50 ₽');
    expect(rateValue(16.8, 100)).toBe('16,80 ₽ за 100');
    expect(rateChange(0.5)).toEqual({ text: '▲ 0,50', dir: 1 });
    expect(rateChange(-0.75)).toEqual({ text: '▼ 0,75', dir: -1 });
    expect(rateChange(0)).toEqual({ text: '= 0,00', dir: 0 });
    expect(rateChange(null)).toEqual({ text: '', dir: 0 });
  });
});

describe('подписи', () => {
  it('сколько прошло', () => {
    expect(ago(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW)).toBe('5 мин назад');
    expect(ago(new Date(NOW.getTime() - 3 * 3600_000).toISOString(), NOW)).toBe('3 ч назад');
    expect(ago(new Date(NOW.getTime() - 30 * 3600_000).toISOString(), NOW)).toBe('вчера');
    expect(ago(new Date(NOW.getTime() - 5 * 86400_000).toISOString(), NOW)).toBe('5 дней назад');
    expect(ago(null, NOW)).toBe('');
  });

  it('пришло в тишину', () => {
    expect(heldLine(1)).toBe('Пока было тихо, пришло 1 сообщение');
    expect(heldLine(3)).toBe('Пока было тихо, пришло 3 сообщения');
    expect(heldLine(5)).toBe('Пока было тихо, пришло 5 сообщений');
  });
});
