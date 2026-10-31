/** Два вида одной доски проекта (PLAN-002b, D-780…D-783). */
import type { BoardView, PlannerProject, TaskStatus } from '@qubite/sync-client';
import {
  Button,
  DotIcon,
  Field,
  Note,
  Presence,
  RingCheck,
  Segmented,
  Swap,
  Switch,
  useFlip,
} from '@qubite/ui';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { say } from '../auth/client';
import { AgentTimeline } from './AgentTimeline';
import { useShell } from './context';
import { usePlanner } from './planner-context';
import { iso, toRow } from './planner-view';
import { buildProjectColumns, dueLabel, projectBoard } from './project-view';

const VIEWS: readonly BoardView[] = ['board', 'list'];
const NO_PROJECTS = new Map<string, PlannerProject>();
const COLUMN_NAMES: Record<TaskStatus, string> = {
  todo: 'Надо',
  doing: 'В работе',
  done: 'Готово',
};

export function ProjectTasks({ id }: { id: string }) {
  const planner = usePlanner();
  const shell = useShell();
  const project = planner.data.projects.find((project) => project.id === id);
  const board = projectBoard(project?.board);
  const [text, setText] = useState('');
  const [savingView, setSavingView] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tasks = useMemo(
    () =>
      planner.data.tasks
        .filter((task) => task.project_id === id)
        .sort(
          (a, b) =>
            (a.due_date ?? '9').localeCompare(b.due_date ?? '9') ||
            (a.due_time ?? '').localeCompare(b.due_time ?? ''),
        ),
    [planner.data.tasks, id],
  );
  const columns = useMemo(
    () => buildProjectColumns(tasks, project?.board),
    [tasks, project?.board],
  );

  async function add(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setError(null);
    // Очищаем только отправленный текст: если человек уже печатает следующее — не затираем.
    setText('');
    try {
      await planner.add(value, { projectId: id });
      shell.cheer('proto');
    } catch (error) {
      setText((now) => (now ? now : value));
      setError(say(error));
    }
  }

  async function pickView(view: BoardView) {
    if (!project || savingView || view === board.view) return;
    setSavingView(true);
    setError(null);
    try {
      await planner.editProject(id, { board: { ...board, view } });
    } catch (error) {
      setError(say(error));
    } finally {
      setSavingView(false);
    }
  }

  return (
    <div className="pp-tab">
      <form className="pp-add" onSubmit={(e) => void add(e)} aria-label="Новое дело в проекте">
        <Field label="Новое дело" value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" variant="fill" size="sm" disabled={!text.trim()}>
          Добавить
        </Button>
      </form>
      <p className="pp-add-hint">Можно со сроком: «сделать календарь в пятницу в 16:00».</p>
      <Segmented<BoardView>
        label="Вид дел проекта"
        value={board.view}
        onChange={(view) => void pickView(view)}
        options={[
          { value: 'board', label: 'Доска' },
          { value: 'list', label: 'Список' },
        ]}
      />
      {error && <Note tone="bad">{error}</Note>}
      {planner.loaded && tasks.length === 0 && (
        <p className="later">Дел пока нет — добавь первое выше или через Command.</p>
      )}
      <Swap view={board.view} order={VIEWS}>
        <ProjectTaskGroups columns={columns} view={board.view} color={project?.color ?? 'orange'} />
      </Swap>
    </div>
  );
}

function ProjectTaskGroups({
  columns,
  view,
  color,
}: {
  columns: ReturnType<typeof buildProjectColumns>;
  view: BoardView;
  color: PlannerProject['color'];
}) {
  const planner = usePlanner();
  const shell = useShell();
  const root = useRef<HTMLDivElement>(null);
  const cleanupDrag = useRef<(() => void) | null>(null);
  const refocus = useRef<{ id: string; status: TaskStatus } | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [trail, setTrail] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Partial<Record<TaskStatus, boolean>>>({});
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState(0);
  const today = iso(new Date());
  useFlip(root, layout);

  useEffect(() => () => cleanupDrag.current?.(), []);
  useEffect(() => {
    const want = refocus.current;
    if (!want) return;
    if (
      !columns.some((column) =>
        column.tasks.some((task) => task.id === want.id && task.status === want.status),
      )
    )
      return;
    const card = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-card]') ?? []).find(
      (card) => card.dataset.card === want.id,
    );
    if (!card) return;
    card.focus();
    refocus.current = null;
  }, [columns, collapsed]);

  async function moveTo(id: string, status: TaskStatus) {
    const task = columns.flatMap((column) => column.tasks).find((task) => task.id === id);
    if (!task || task.status === status) return;
    refocus.current = root.current?.contains(document.activeElement) ? { id, status } : null;
    setMenu(null);
    setCollapsed((current) => ({ ...current, [status]: false }));
    setError(null);
    try {
      await planner.move(id, status);
      if (status === 'done') shell.cheer('proto');
    } catch (error) {
      refocus.current = null;
      setError(say(error));
    }
  }

  function columnAt(x: number, y: number): TaskStatus | null {
    const hit = document
      .elementsFromPoint(x, y)
      .find(
        (element) => element.matches('[data-project-column]') && root.current?.contains(element),
      );
    return (hit?.getAttribute('data-project-column') as TaskStatus | null) ?? null;
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>, id: string) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    cleanupDrag.current?.();
    const card = e.currentTarget;
    const start = { x: e.clientX, y: e.clientY, pointer: e.pointerId };
    let moving = false;
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== start.pointer) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!moving && Math.hypot(dx, dy) < 6) return;
      moving = true;
      card.classList.add('dragging');
      card.style.transform = `translate(${dx}px, ${dy}px)`;
      getSelection()?.removeAllRanges();
      setOver(columnAt(event.clientX, event.clientY));
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', drop);
      card.classList.remove('dragging');
      card.style.transform = '';
      cleanupDrag.current = null;
    };
    const drop = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== start.pointer) return;
      const status = event.type === 'pointerup' ? columnAt(event.clientX, event.clientY) : null;
      cleanup();
      setOver(null);
      if (moving && status) void moveTo(id, status);
    };
    cleanupDrag.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', drop);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>, id: string, from: TaskStatus) {
    // Стрелки внутри кнопок и других вложенных элементов не перехватываем.
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
    const index = columns.findIndex((column) => column.status === from);
    const target =
      e.key === 'ArrowRight'
        ? columns[index + 1]
        : e.key === 'ArrowLeft'
          ? columns[index - 1]
          : undefined;
    if (!target) return;
    e.preventDefault();
    void moveTo(id, target.status);
  }

  return (
    <div ref={root} className={`pp-task-groups pp-task-${view}`}>
      {error && <Note tone="bad">{error}</Note>}
      {columns.map((column) => (
        <section
          key={column.status}
          className={over === column.status ? 'pp-task-column over' : 'pp-task-column'}
          data-project-column={column.status}
          data-flip={column.status}
          aria-label={`${column.title}: ${column.tasks.length}`}
        >
          <div className="pp-col-head">
            <h3>{column.title}</h3>
            <span className="sec-h-end">
              <span className="n">{column.tasks.length}</span>
              {view === 'list' && (
                <Button
                  size="sm"
                  dot={false}
                  aria-expanded={!collapsed[column.status]}
                  onClick={() =>
                    setCollapsed((current) => ({
                      ...current,
                      [column.status]: !current[column.status],
                    }))
                  }
                >
                  {collapsed[column.status] ? 'Развернуть' : 'Свернуть'}
                </Button>
              )}
            </span>
          </div>
          <Presence
            show={view === 'board' || !collapsed[column.status]}
            onLayout={() => setLayout((value) => value + 1)}
          >
            {column.tasks.length === 0 && <p className="later">Пока пусто.</p>}
            {column.tasks.map((task) => {
              const row = toRow(task, NO_PROJECTS, today);
              return (
                <div
                  key={task.id}
                  className={
                    task.status === 'done'
                      ? 'card panel pp-task-card done'
                      : 'card panel pp-task-card'
                  }
                  data-card={task.id}
                  data-obj={task.id}
                  tabIndex={0}
                  aria-label={`${task.title}. Перенести: стрелки влево и вправо`}
                  onPointerDown={(e) => onPointerDown(e, task.id)}
                  onKeyDown={(e) => onKey(e, task.id, column.status)}
                >
                  <div className="pp-task-card-top">
                    <RingCheck
                      done={task.status === 'done'}
                      label={`Готово: ${task.title}`}
                      onToggle={(done) => void moveTo(task.id, done ? 'done' : 'todo')}
                    />
                    <Button
                      className="task-open pp-task-title"
                      dot={false}
                      aria-label={`Открыть дело: ${task.title}`}
                      onClick={() => planner.openTask(task.id)}
                    >
                      {task.title}
                    </Button>
                    <Button
                      size="sm"
                      dot={false}
                      aria-label={`Действия дела: ${task.title}`}
                      aria-expanded={menu === task.id}
                      onClick={() => setMenu(menu === task.id ? null : task.id)}
                    >
                      <DotIcon name="more" size={16} />
                    </Button>
                  </div>
                  <div className="meta pp-task-meta">
                    <span className="q-dot" style={{ background: `var(--q-${color})` }} />
                    {[dueLabel(task.due_date, today), task.due_time, row.tag]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  <Presence show={task.travel_minutes != null} className="task-travel">
                    в пути {task.travel_minutes} мин
                  </Presence>
                  <Presence show={menu === task.id}>
                    <div className="pp-task-actions" role="group" aria-label="Переместить в…">
                      <p>Переместить в…</p>
                      {columns.map((target) => (
                        <Button
                          key={target.status}
                          size="sm"
                          dot={false}
                          disabled={target.status === task.status}
                          onClick={() => void moveTo(task.id, target.status)}
                        >
                          {target.title}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        dot={false}
                        onClick={() => setTrail(trail === task.id ? null : task.id)}
                      >
                        Лента дела
                      </Button>
                    </div>
                  </Presence>
                  <Presence show={trail === task.id}>
                    <AgentTimeline trail={{ object: task.id }} compact />
                  </Presence>
                </div>
              );
            })}
          </Presence>
        </section>
      ))}
    </div>
  );
}

/** Sheet открывается из меню проекта; форма монтируется заново при каждом открытии. */
export function ProjectBoardSettings({
  project,
  onClose,
}: {
  project: PlannerProject;
  onClose: () => void;
}) {
  const planner = usePlanner();
  const initial = projectBoard(project.board);
  const [columns, setColumns] = useState(initial.columns);
  const [doing, setDoing] = useState(columns.some((column) => column.status === 'doing'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visible = columns.filter((column) => doing || column.status !== 'doing');
  const valid = visible.every(
    (column) => column.title.trim() && Array.from(column.title.trim()).length <= 24,
  );

  function toggleDoing(enabled: boolean) {
    setDoing(enabled);
    if (!enabled && !columns.some((column) => column.status === 'todo')) {
      setColumns((current) => [{ status: 'todo', title: 'Надо' }, ...current]);
    }
    if (enabled && !columns.some((column) => column.status === 'doing')) {
      setColumns((current) => {
        const next = [...current];
        const done = next.findIndex((column) => column.status === 'done');
        next.splice(done < 0 ? next.length : done, 0, { status: 'doing', title: 'В работе' });
        return next;
      });
    }
  }

  async function save(reset: boolean) {
    if (busy || (!reset && !valid)) return;
    setBusy(true);
    setError(null);
    try {
      await planner.editProject(project.id, {
        board: reset
          ? null
          : {
              view: projectBoard(project.board).view,
              columns: visible.map((column) => ({ ...column, title: column.title.trim() })),
            },
      });
      onClose();
    } catch (error) {
      setError(say(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="pp-form"
      aria-label="Настройка колонок"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      <div className="pp-board-switch">
        <span>Показывать «В работе»</span>
        <Switch checked={doing} onChange={toggleDoing} label="Показывать «В работе»" />
      </div>
      {columns.map((column) => (
        <Presence key={column.status} show={doing || column.status !== 'doing'}>
          <Field
            label={`Название колонки «${COLUMN_NAMES[column.status]}»`}
            value={column.title}
            maxLength={24}
            disabled={busy}
            error={
              !column.title.trim() || Array.from(column.title.trim()).length > 24
                ? 'Нужно название от 1 до 24 символов.'
                : null
            }
            onChange={(e) =>
              setColumns((current) =>
                current.map((item) =>
                  item.status === column.status ? { ...item, title: e.target.value } : item,
                ),
              )
            }
          />
        </Presence>
      ))}
      <p className="pp-add-hint">
        «Готово» всегда остаётся. Дела из скрытой колонки видны в первой.
      </p>
      {error && <Note tone="bad">{error}</Note>}
      <div className="act-btns">
        <Button size="sm" variant="fill" type="submit" disabled={busy || !valid}>
          Сохранить
        </Button>
        <Button size="sm" dot={false} disabled={busy} onClick={() => void save(true)}>
          Сбросить
        </Button>
        <Button size="sm" dot={false} disabled={busy} onClick={onClose}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
