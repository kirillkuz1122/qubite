import { parseCommand } from '@qubite/ui';
import { beforeEach, describe, expect, it } from 'vitest';
import { commandView, findEntries, loadHistory, remember, saveHistory } from './command';
import type { InboxItem } from './data';
import { buildWeek } from './planner-view';
import { initialState } from './state';

const state = {
  ...initialState(),
  week: buildWeek(
    [
      {
        id: 't3',
        title: 'Позвонить бабушке',
        status: 'todo',
        priority: 'normal',
        due_date: '2026-10-19',
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
      },
    ],
    [],
    new Date('2026-10-19T12:00:00'),
  ),
};
const inbox: InboxItem[] = [
  {
    id: 'i1',
    text: 'бот для расписания',
    src: 'Command',
    from: 'text',
    time: 'сейчас',
    hint: '',
    acts: [],
  },
];
const view = (v: string, history: string[] = []) =>
  commandView(v, v.trim() ? parseCommand(v) : null, state, inbox, history);

describe('поиск Command (CMD-002)', () => {
  it('разделы находятся по имени и по словам', () => {
    expect(findEntries('настр', state, inbox)[0]?.run).toEqual({ type: 'go', to: 'settings' });
    expect(findEntries('планер', state, inbox)[0]?.run).toEqual({ type: 'go', to: 'planner' });
    expect(findEntries('входящие', state, inbox)[0]?.run).toEqual({ type: 'go', to: 'inbox' });
  });

  it('дело, мысль и документ находятся и ведут к себе', () => {
    expect(findEntries('бабушк', state, inbox)[0]?.run).toEqual({
      type: 'go',
      to: 'today',
      obj: 't3',
    });
    expect(findEntries('расписан', state, inbox)[0]?.run).toEqual({
      type: 'go',
      to: 'inbox',
      obj: 'i1',
    });
    const doc = findEntries('фенвик', state, inbox)[0];
    expect(doc?.run).toMatchObject({ type: 'go', to: 'docs', open: true });
  });

  it('настройки и действия: тема, облегчённый режим', () => {
    expect(findEntries('светлая', state, inbox)[0]?.run).toEqual({ type: 'theme', value: 'light' });
    expect(findEntries('тормозит', state, inbox)[0]?.run).toEqual({
      type: 'go',
      to: 'settings',
      obj: 'set-lite',
    });
  });

  it('не больше шести найденных', () => {
    expect(findEntries('а', state, inbox)).toHaveLength(0);
    expect(findEntries('за', state, inbox).length).toBeLessThanOrEqual(6);
  });

  it('по Enter по умолчанию — сохранить запись', () => {
    const v = view('позвонить бабушке');
    expect(v.parsed?.kind).toBe('task');
    expect(v.active).toBe(0);
    expect(v.hits[0]?.id).toBe('task-t3'); // а найденное — ниже, стрелками
  });

  it('одно точное слово — открыть раздел или действие, а не записать мысль', () => {
    expect(view('настройки').active).toBe(1);
    expect(view('светлая тема').hits[0]?.run).toEqual({ type: 'theme', value: 'light' });
    expect(view('светлая тема').active).toBe(1);
    // мысль из нескольких слов остаётся мыслью
    expect(view('идея про настройки уведомлений').active).toBe(0);
  });

  it('«найди …» — сразу первое найденное; ничего — предложить сохранить мысль', () => {
    const v = view('найди фенвик');
    expect(v.parsed).toBeNull();
    expect(v.active).toBe(0);
    expect(v.hits[0]?.id).toBe('doc-fenwick');
    const none = view('найди квазары');
    expect(none.hits).toHaveLength(1);
    expect(none.hits[0]?.run).toEqual({ type: 'save' });
  });

  it('пустая строка — недавнее, ничего не выбрано', () => {
    const v = view('', ['алгебра', 'настройки']);
    expect(v.heading).toBe('Недавнее');
    expect(v.hits.map((h) => h.run)).toEqual([
      { type: 'fill', text: 'алгебра' },
      { type: 'fill', text: 'настройки' },
    ]);
    expect(v.active).toBe(-1);
  });
});

describe('недавнее', () => {
  beforeEach(() => localStorage.clear());

  it('новое сверху, без повторов, сохраняется на устройстве', () => {
    let h = remember([], 'алгебра', 'search');
    h = remember(h, 'бабушка', 'task');
    h = remember(h, 'алгебра', 'search');
    expect(h).toEqual(['алгебра', 'бабушка']);
    expect(loadHistory()).toEqual(['алгебра', 'бабушка']);
  });

  it('дневник не запоминается — он личный', () => {
    expect(remember(['x'], 'в дневник: грустно', 'journal')).toEqual(['x']);
    expect(loadHistory()).toEqual([]);
  });

  it('очистка и испорченное хранилище', () => {
    remember([], 'алгебра', 'search');
    saveHistory([]);
    expect(loadHistory()).toEqual([]);
    localStorage.setItem('qubite.command.history.v1', '{не json');
    expect(loadHistory()).toEqual([]);
  });
});
