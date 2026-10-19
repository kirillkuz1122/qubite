/**
 * «Сегодня» и Planner на настоящих данных (PLAN-001): проекты и дела живут в браузере
 * (`@qubite/sync-client`) и синхронизируются с сервером. Отметка в одном экране видна в
 * другом и на других устройствах; без сети всё записывается и уходит потом.
 */
import {
  createProject,
  createTask,
  findProject,
  plannerData,
  setTaskDone,
  type PlannerProject,
  type PlannerTask,
} from '@qubite/sync-client';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PlannerCtx, type PlannerApi } from './planner-context';
import { localNow, parse } from '@qubite/ui';
import { buildBoard, buildProjects, buildWeek, iso, nameFromTag, taskFrom } from './planner-view';
import { useSync } from './sync-context';

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
    async (text: string, options: { fromInbox?: string } = {}) => {
      const c = await ready();
      const now = new Date();
      const parsed = parse(text, localNow(now));
      const { title, tag, task } = parsed
        ? taskFrom(parsed, iso(now))
        : { title: '', tag: null, task: { due_date: iso(now) } };
      let projectId: string | undefined;
      if (tag) {
        const { projects } = await plannerData(c);
        projectId =
          findProject(projects, tag)?.id ?? (await createProject(c, nameFromTag(tag), { tag })).id;
      }
      await createTask(c, title || text.trim() || 'Новое дело', {
        ...task,
        ...(projectId ? { project_id: projectId } : {}),
        ...(options.fromInbox ? { from_inbox: options.fromInbox } : {}),
      });
      void c.sync();
    },
    [ready],
  );

  const value = useMemo<PlannerApi>(() => {
    const week = buildWeek(data.tasks, data.projects, now);
    return {
      week,
      today: Math.max(
        0,
        week.findIndex((d) => d.today),
      ),
      board: buildBoard(data.tasks, data.projects, now.getTime()),
      projects: buildProjects(data.projects, data.tasks),
      loaded,
      toggle,
      add,
    };
  }, [data, now, loaded, toggle, add]);
  return <PlannerCtx.Provider value={value}>{children}</PlannerCtx.Provider>;
}
