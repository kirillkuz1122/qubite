/** Дела и проекты для экранов «Сегодня» и Planner (данные — в `planner.tsx`). */
import { createContext, useContext } from 'react';
import type { Day } from './data';
import type { BoardColumn, ProjectBar } from './planner-view';

export interface PlannerApi {
  /** пн…вс вокруг сегодняшнего дня, дела по дням срока */
  week: Day[];
  /** номер сегодняшнего дня в `week` */
  today: number;
  board: BoardColumn[];
  projects: ProjectBar[];
  /** хранилище открыто и прочитано (до этого — не показывать «пусто») */
  loaded: boolean;
  /** Отметить сделанным или вернуть (без сети — тоже). */
  toggle(id: string, done: boolean): Promise<void>;
  /**
   * Новое дело из строки Command или мысли: разбор CMD-003 даёт срок, повторение, важность;
   * `#проект` привязывает к проекту (нет такого — создаётся). Без дня — сегодня.
   */
  add(text: string, options?: { fromInbox?: string }): Promise<void>;
}

export const PlannerCtx = createContext<PlannerApi | null>(null);

export function usePlanner(): PlannerApi {
  const v = useContext(PlannerCtx);
  if (!v) throw new Error('usePlanner: оберни в <PlannerProvider>');
  return v;
}
