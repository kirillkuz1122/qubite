import type { PlannerProject, PlannerTask, ProjectBoard } from '@qubite/sync-client';
import type {
  ButtonProps,
  FieldProps,
  PresenceProps,
  RingCheckProps,
  SegmentedProps,
  SwapProps,
  SwitchProps,
} from '@qubite/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Fail } from '../auth/client';
import { ShellCtx } from './context';
import { PlannerCtx, type PlannerApi } from './planner-context';
import { ProjectBoardSettings, ProjectTasks } from './ProjectTasks';

// Физику и canvas проверяет packages/ui; здесь действия человека и правки Planner.
vi.mock('@qubite/ui', async (original) => ({
  ...(await original<typeof import('@qubite/ui')>()),
  Button: (p: ButtonProps) => (
    <button
      type={p.type ?? 'button'}
      onClick={p.onClick}
      disabled={p.disabled}
      aria-label={p['aria-label']}
      aria-expanded={p['aria-expanded']}
    >
      {p.children}
    </button>
  ),
  Field: (p: FieldProps) => (
    <label>
      {p.label}
      <input value={p.value} onChange={p.onChange} maxLength={p.maxLength} disabled={p.disabled} />
      {p.error && <span role="alert">{p.error}</span>}
    </label>
  ),
  Presence: ({ show, children }: PresenceProps) => (show ? <div>{children}</div> : null),
  Swap: ({ children }: SwapProps<string>) => <div>{children}</div>,
  Segmented: (p: SegmentedProps<string>) => (
    <div role="radiogroup" aria-label={p.label}>
      {p.options.map((option) => (
        <button
          type="button"
          role="radio"
          key={option.value}
          aria-checked={p.value === option.value}
          onClick={() => p.onChange(option.value, { x: 0, y: 0 })}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
  Switch: (p: SwitchProps) => (
    <button
      type="button"
      role="switch"
      aria-label={p.label}
      aria-checked={p.checked}
      onClick={() => p.onChange(!p.checked)}
    />
  ),
  RingCheck: (p: RingCheckProps) => (
    <button
      type="button"
      role="checkbox"
      aria-label={p.label}
      aria-checked={p.done}
      onClick={() => p.onToggle(!p.done)}
    />
  ),
  useFlip: () => undefined,
}));
vi.mock('./parts', () => ({
  SecHead: ({ label, children }: { label: string; children?: ReactNode }) => (
    <header>
      <h2>{label}</h2>
      {children}
    </header>
  ),
}));
vi.mock('./AgentTimeline', () => ({ AgentTimeline: () => null }));

const TWO_COLUMNS: ProjectBoard = {
  view: 'board',
  columns: [
    { status: 'todo', title: 'Темы' },
    { status: 'done', title: 'Разобрал' },
  ],
};
const TASK: PlannerTask = {
  id: 't',
  title: 'Эссе',
  project_id: 'p',
  status: 'doing',
  priority: 'normal',
  due_date: null,
  due_time: null,
  notes: '',
  subtasks: [],
  recurrence: null,
  completed_at_ms: null,
  remind_at: null,
  remind_why: '',
  remind_by: 'auto',
  pending: false,
};

function mount(board: ProjectBoard | null = TWO_COLUMNS, settings = false) {
  const calls = {
    move: vi.fn(),
    editProject: vi.fn(),
    onClose: vi.fn(),
    openTask: vi.fn(),
  };
  function Harness() {
    const [project, setProject] = useState<PlannerProject>({
      id: 'p',
      title: 'Учёба',
      color: 'sky',
      tag: 'учёба',
      status: 'active',
      notes: '',
      board,
      pending: false,
    });
    const [tasks, setTasks] = useState([TASK]);
    const planner: PlannerApi = {
      week: [],
      today: 0,
      board: [],
      projects: [],
      data: { projects: [project], tasks },
      loaded: true,
      add: vi.fn(),
      toggle: vi.fn(),
      newProject: vi.fn(),
      openTask: calls.openTask,
      move: async (id, status) => {
        await calls.move(id, status);
        setTasks((current) => current.map((task) => (task.id === id ? { ...task, status } : task)));
      },
      editProject: async (id, patch) => {
        await calls.editProject(id, patch);
        setProject((current) => ({ ...current, ...patch }));
      },
    };
    return (
      <ShellCtx.Provider value={{ cheer: vi.fn(), fly: vi.fn(), go: vi.fn(), wide: false }}>
        <PlannerCtx.Provider value={planner}>
          {settings ? (
            <ProjectBoardSettings project={project} onClose={calls.onClose} />
          ) : (
            <ProjectTasks id="p" />
          )}
        </PlannerCtx.Provider>
      </ShellCtx.Provider>
    );
  }
  const result = render(<Harness />);
  return { ...calls, ...result };
}

function card() {
  return screen.getByLabelText('Эссе. Перенести: стрелки влево и вправо');
}

function pointer(target: Element | Window, type: string, x = 0, pointerType = 'mouse') {
  fireEvent(
    target,
    Object.assign(new Event(type, { bubbles: true }), {
      button: 0,
      pointerId: 1,
      pointerType,
      clientX: x,
      clientY: 0,
    }),
  );
}

describe('доска и список проекта (PLAN-002b)', () => {
  it.each(['board', 'list'] as const)(
    'в виде %s скрытый статус не меняется при показе; меню ставит статус колонки',
    async (view) => {
      const { move } = mount({ ...TWO_COLUMNS, view });
      const first = within(screen.getByRole('region', { name: 'Темы: 1' }));
      expect(first.getByText('Эссе')).toBeTruthy();
      expect(move).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Действия дела: Эссе' }));
      // Можно явно поставить todo, хотя doing уже показано в первой колонке.
      fireEvent.click(screen.getByRole('button', { name: 'Темы' }));
      await waitFor(() => expect(move).toHaveBeenCalledWith('t', 'todo'));
      fireEvent.click(screen.getByRole('button', { name: 'Действия дела: Эссе' }));
      fireEvent.click(screen.getByRole('button', { name: 'Разобрал' }));
      await waitFor(() => expect(move).toHaveBeenLastCalledWith('t', 'done'));
      await waitFor(() => {
        const last = within(screen.getByRole('region', { name: 'Разобрал: 1' }));
        expect(last.getByText('Эссе')).toBeTruthy();
      });
    },
  );

  it.each(['board', 'list'] as const)(
    'стрелки в виде %s пропускают скрытую колонку и сохраняют фокус',
    async (view) => {
      const { move } = mount({ ...TWO_COLUMNS, view });
      card().focus();
      fireEvent.keyDown(card(), { key: 'ArrowRight' });
      await screen.findByRole('region', { name: 'Разобрал: 1' });
      expect(move).toHaveBeenCalledWith('t', 'done');
      await waitFor(() => expect(card()).toHaveFocus());
      fireEvent.keyDown(card(), { key: 'ArrowLeft' });
      await screen.findByRole('region', { name: 'Темы: 1' });
      expect(move).toHaveBeenLastCalledWith('t', 'todo');
      await waitFor(() => expect(card()).toHaveFocus());
      const count = move.mock.calls.length;
      fireEvent.keyDown(card(), { key: 'ArrowLeft' });
      expect(move).toHaveBeenCalledTimes(count);
    },
  );

  it('вид сохраняется правкой проекта вместе с названиями и порядком колонок', async () => {
    const { editProject } = mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Список' }));
    await waitFor(() =>
      expect(editProject).toHaveBeenCalledWith('p', {
        board: { ...TWO_COLUMNS, view: 'list' },
      }),
    );
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Список' })).toHaveAttribute('aria-checked', 'true');
    });
    const first = within(screen.getByRole('region', { name: 'Темы: 1' }));
    fireEvent.click(first.getByRole('button', { name: 'Свернуть' }));
    expect(screen.queryByText('Эссе')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Готово: Эссе' }));
    await waitFor(() => {
      const check = screen.getByRole('checkbox', { name: 'Готово: Эссе' });
      expect(check).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('ошибка записи вида не переключает вид и показывает ошибку', async () => {
    const { editProject } = mount();
    editProject.mockRejectedValueOnce(new Fail('storage', 'нет места', 0));
    fireEvent.click(screen.getByRole('radio', { name: 'Список' }));
    await screen.findByText(/нет места/);
    expect(screen.getByRole('radio', { name: 'Доска' })).toHaveAttribute('aria-checked', 'true');
  });

  it('мышь переносит в статус колонки, отменённый жест и касание ничего не меняют', async () => {
    const { move } = mount();
    const descriptor = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
    const target = screen.getByRole('region', { name: 'Разобрал: 0' });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [target],
    });
    try {
      pointer(card(), 'pointerdown');
      pointer(window, 'pointermove', 50);
      pointer(window, 'pointercancel', 50);
      expect(move).not.toHaveBeenCalled();
      pointer(card(), 'pointerdown', 0, 'touch');
      pointer(window, 'pointerup', 50, 'touch');
      expect(move).not.toHaveBeenCalled();
      pointer(card(), 'pointerdown');
      pointer(window, 'pointermove', 50);
      pointer(window, 'pointerup', 50);
      await waitFor(() => expect(move).toHaveBeenCalledWith('t', 'done'));
    } finally {
      if (descriptor) Object.defineProperty(document, 'elementsFromPoint', descriptor);
      else Reflect.deleteProperty(document, 'elementsFromPoint');
    }
  });

  it('настройка убирает doing, переименовывает колонки и сохраняет вид', async () => {
    const { editProject, onClose } = mount(
      {
        view: 'list',
        columns: [
          { status: 'todo', title: 'Надо' },
          { status: 'doing', title: 'В работе' },
          { status: 'done', title: 'Готово' },
        ],
      },
      true,
    );
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByLabelText('Название колонки «Надо»'), {
      target: { value: '  Темы  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(editProject).toHaveBeenCalledWith('p', {
        board: {
          view: 'list',
          columns: [
            { status: 'todo', title: 'Темы' },
            { status: 'done', title: 'Готово' },
          ],
        },
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('«В работе» можно вернуть; пустое и слишком длинное название не сохраняются', () => {
    const { editProject } = mount(TWO_COLUMNS, true);
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByLabelText('Название колонки «В работе»')).toBeTruthy();
    const field = screen.getByLabelText('Название колонки «Надо»');
    expect(field).toHaveAttribute('maxLength', '24');
    fireEvent.change(field, { target: { value: ' ' } });
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    fireEvent.change(field, { target: { value: 'а'.repeat(25) } });
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    expect(editProject).not.toHaveBeenCalled();
  });

  it('сброс отправляет board: null; ошибка записи оставляет форму открытой', async () => {
    const { editProject, onClose } = mount(TWO_COLUMNS, true);
    editProject.mockRejectedValueOnce(new Fail('storage', 'нет места', 0));
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
    await screen.findByText(/нет места/);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(editProject).toHaveBeenLastCalledWith('p', { board: null });
  });
});
