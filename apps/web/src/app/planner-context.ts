/** Дела и проекты для экранов «Сегодня» и Planner (данные — в `planner.tsx`). */
import { createContext, useContext } from 'react';
import type { Day } from './data';
import type { PlannerProject, PlannerTask, ProjectPatch, TaskStatus } from '@qubite/sync-client';
import type { BoardColumn, ProjectBar } from './planner-view';

export interface PlannerApi {
  /** пн…вс вокруг сегодняшнего дня, дела по дням срока */
  week: Day[];
  /** номер сегодняшнего дня в `week` */
  today: number;
  board: BoardColumn[];
  projects: ProjectBar[];
  /** все живые проекты и дела на устройстве (страница проекта, PROJ-001) */
  data: { projects: PlannerProject[]; tasks: PlannerTask[] };
  /** хранилище открыто и прочитано (до этого — не показывать «пусто») */
  loaded: boolean;
  /** Отметить сделанным или вернуть (без сети — тоже). */
  toggle(id: string, done: boolean): Promise<void>;
  /**
   * Новое дело из строки Command или мысли: разбор CMD-003 даёт срок, повторение, важность;
   * `#проект` привязывает к проекту (нет такого — создаётся). Без дня — сегодня.
   * `projectId` — сразу в этот проект (страница проекта).
   */
  add(text: string, options?: { fromInbox?: string; projectId?: string }): Promise<void>;
  /** Перенести дело в колонку доски (без сети — тоже). */
  move(id: string, status: TaskStatus): Promise<void>;
  /**
   * Новый проект по названию; такой (по тегу) уже есть — вернуть его. `created` — создан ли
   * сейчас (для подписи «создан проект…»).
   */
  newProject(name: string): Promise<{ id: string; tag: string; created: boolean }>;
  /** Поменять название, цвет, описание или статус проекта (без сети — тоже). */
  editProject(id: string, patch: ProjectPatch): Promise<void>;
}

export const PlannerCtx = createContext<PlannerApi | null>(null);

export function usePlanner(): PlannerApi {
  const v = useContext(PlannerCtx);
  if (!v) throw new Error('usePlanner: оберни в <PlannerProvider>');
  return v;
}
