/**
 * «Сегодня» и Planner на настоящих данных (PLAN-001): проекты и дела живут в браузере
 * (`@qubite/sync-client`) и синхронизируются с сервером. Отметка в одном экране видна в
 * другом и на других устройствах; без сети всё записывается и уходит потом.
 */
import {
  createProject,
  createTask,
  findProject,
  PLANNER_TASK,
  plannerData,
  setTaskDone,
  setTaskStatus,
  tagFrom,
  toTask,
  updateProject,
  type PlannerProject,
  type PlannerTask,
  type ProjectPatch,
} from '@qubite/sync-client';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PlannerCtx, type PlannerApi, type TaskDestination } from './planner-context';
import { localNow, parse, useToast } from '@qubite/ui';
import {
  buildBoard,
  buildProjects,
  buildUndated,
  buildWeek,
  iso,
  nameFromTag,
  taskFrom,
} from './planner-view';
import { useSync } from './sync-context';
import { TaskPlaceSheet } from './TaskPlaceSheet';

/** Новый день начинается сам: «сегодня» пересчитывается раз в минуту. */
function useToday(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => {
      const next = new Date();
      setNow((prev) =>
        prev.toDateString() === next.toDateString() && next.getTime() - prev.getTime() < 6e5
          ? prev
          : next,
      );
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function PlannerProvider({ children }: { children: ReactNode }) {
  const { client, ready, version } = useSync();
  const [data, setData] = useState<{ projects: PlannerProject[]; tasks: PlannerTask[] }>({
    projects: [],
    tasks: [],
  });
  const [loaded, setLoaded] = useState(false);
  const [editingTask, setEditingTask] = useState<string | null>(() =>
    new URLSearchParams(globalThis.location?.search ?? '').get('task'),
  );
  const [taskOpening, setTaskOpening] = useState(0);
  const [placement, setPlacement] = useState<{
    id: string;
    columns?: readonly TaskDestination[];
  } | null>(null);
  const toast = useToast();
  const openTask = useCallback((id: string) => {
    setPlacement(null);
    setEditingTask(id);
    setTaskOpening((n) => n + 1);
  }, []);
  const placeTask = useCallback((id: string, columns?: readonly TaskDestination[]) => {
    setPlacement({ id, ...(columns && { columns }) });
    setEditingTask(id);
    setTaskOpening((n) => n + 1);
  }, []);
  const now = useToday();

  useEffect(() => {
    if (!client) return;
    let alive = true;
    void plannerData(client).then((d) => {
      if (!alive) return;
      setData(d);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [client, version]);

  const toggle = useCallback(
    async (id: string, done: boolean) => {
      const c = await ready();
      await setTaskDone(c, id, done);
      void c.sync();
    },
    [ready],
  );

  const add = useCallback(
    async (text: string, options: { fromInbox?: string; projectId?: string } = {}) => {
      const c = await ready();
      const now = new Date();
      const parsed = parse(text, localNow(now));
      const { title, tag, task } = parsed
        ? taskFrom(parsed, iso(now))
        : { title: '', tag: null, task: { due_date: iso(now) } };
      let projectId = options.projectId;
      if (tag && !projectId) {
        const { projects } = await plannerData(c);
        projectId =
          findProject(projects, tag)?.id ?? (await createProject(c, nameFromTag(tag), { tag })).id;
      }
      // Название — только суть: метки, срок и важность ушли в поля (D-289). Сути нет — так и
      // пишем, а не повторяем строку с метками.
      await createTask(c, title || 'Дело без названия', {
        ...task,
        ...(projectId ? { project_id: projectId } : {}),
        ...(options.fromInbox ? { from_inbox: options.fromInbox } : {}),
      });
      void c.sync();
    },
    [ready],
  );

  const move = useCallback(
    async (id: string, status: PlannerTask['status']) => {
      const c = await ready();
      await setTaskStatus(c, id, status);
      void c.sync();
    },
    [ready],
  );

  const swipeTask = useCallback(
    async (id: string, action: 'done' | 'delete') => {
      const deleting = action === 'delete';
      try {
        const c = await ready();
        const object = await c.get(id);
        if (!object || object.deleted || object.object_type !== PLANNER_TASK) return;
        const previous = toTask(object).status;
        if (!deleting && previous === 'done') return;

        if (deleting) await c.remove(id);
        else await setTaskDone(c, id, true);

        async function undo() {
          try {
            const current = await c.get(id);
            if (deleting && current?.deleted) await c.restore(id);
            if (!deleting && current && !current.deleted && toTask(current).status === 'done')
              await setTaskStatus(c, id, previous);
            void c.sync();
          } catch {
            toast.show('Не удалось отменить действие с задачей.', { tone: 'bad' });
          }
        }

        toast.show(deleting ? 'Задача удалена' : 'Задача закрыта', {
          ms: 5000,
          undo: () => void undo(),
          undoLabel: 'Отменить',
        });
        void c.sync();
      } catch {
        toast.show('Не удалось изменить задачу на устройстве.', { tone: 'bad' });
      }
    },
    [ready, toast],
  );

  const newProject = useCallback(
    async (name: string) => {
      const c = await ready();
      const tag = tagFrom(name);
      const { projects } = await plannerData(c);
      const found = findProject(projects, tag);
      if (found) return { id: found.id, tag: found.tag, created: false };
      const made = await createProject(c, name, { tag });
      void c.sync();
      return { id: made.id, tag, created: true };
    },
    [ready],
  );

  const editProject = useCallback(
    async (id: string, patch: ProjectPatch) => {
      const c = await ready();
      await updateProject(c, id, patch);
      void c.sync();
    },
    [ready],
  );

  const value = useMemo<PlannerApi>(() => {
    const week = buildWeek(data.tasks, data.projects, now);
    const date = iso(now);
    return {
      week,
      today: Math.max(
        0,
        week.findIndex((d) => d.today),
      ),
      undated: buildUndated(data.tasks, data.projects, date),
      board: buildBoard(data.tasks, data.projects, now.getTime()),
      projects: buildProjects(data.projects, data.tasks, date),
      data,
      loaded,
      toggle,
      add,
      move,
      newProject,
      editProject,
      openTask,
      placeTask,
      swipeTask,
    };
  }, [
    data,
    now,
    loaded,
    toggle,
    add,
    move,
    newProject,
    editProject,
    openTask,
    placeTask,
    swipeTask,
  ]);
  const closeTask = () => {
    setEditingTask(null);
    setPlacement(null);
  };
  return (
    <PlannerCtx.Provider value={value}>
      {children}
      <TaskPlaceSheet
        session={taskOpening}
        task={data.tasks.find((t) => t.id === editingTask)}
        onClose={closeTask}
        placement={
          placement && {
            columns:
              placement.columns ??
              value.board.map((col) => ({ status: col.status, title: col.name })),
            onEdit: () => openTask(placement.id),
            onMove: (status) => {
              closeTask();
              void move(placement.id, status).catch(() =>
                toast.show('Не удалось перенести задачу.', { tone: 'bad' }),
              );
            },
          }
        }
      />
    </PlannerCtx.Provider>
  );
}
