/**
 * Возможности на Главной (AGT-005, D-732…D-734): запросы к `/api/v1/opportunities*`.
 * Сначала берём то, что агент отобрал (`suggested`); если отбора нет — ближайшие новые
 * (`new`) с пометкой «без отбора агента». Прошедшие не показываем.
 */
import type { components } from '@qubite/api-client';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { must } from '../auth/client';
import { TIMELINE } from './agent';
import { ahead } from './opportunities-view';

export type OpportunityItem = components['schemas']['OpportunityItem'];

/** Карточка: возможность и, после «Интересно», сколько дел поставил агент. */
export type OpportunityCard = OpportunityItem & { tasks?: number };

export interface OpportunityPick {
  /** true — отобрал агент; false — ближайшие новые без отбора */
  picked: boolean;
  /** уже без прошедших, по ближайшему сроку; первые три — на экране, остальные — замена убранным */
  items: OpportunityCard[];
}

export const OPPORTUNITIES = ['opportunities', 'home'] as const;
/** Сколько держим про запас: убрал карточку — на её место встаёт следующая. */
const KEEP = 10;
const minutes = (n: number) => n * 60_000;

async function list(status: 'suggested' | 'new', now: Date) {
  const data = await must(api.GET('/api/v1/opportunities', { params: { query: { status } } }));
  return ahead(data.items, now).slice(0, KEEP);
}

export function useOpportunities() {
  return useQuery({
    queryKey: OPPORTUNITIES,
    queryFn: async (): Promise<OpportunityPick> => {
      const now = new Date();
      const suggested = await list('suggested', now);
      if (suggested.length > 0) return { picked: true, items: suggested };
      return { picked: false, items: await list('new', now) };
    },
    retry: false,
    // после «Интересно» карточка остаётся с итогом — не перезапрашиваем при каждом фокусе
    staleTime: minutes(10),
    refetchOnWindowFocus: false,
  });
}

/** «Обновить»: сервер собирает мероприятия из открытых источников. */
export function useRefreshOpportunities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => must(api.POST('/api/v1/opportunities/refresh')),
    onSuccess: () => qc.invalidateQueries({ queryKey: OPPORTUNITIES }),
  });
}

/*
 * «Интересно» и «Не надо» сервер получает в #133 (AGT-005b). Пока этих путей нет в
 * `schema.ts`, зовём их без проверки типа пути; после `pnpm gen:api` — обычный `api.POST`
 * и одна форма ответа в `interestedResult`.
 */
type Untyped = (
  path: string,
  init: { params: { path: { id: string } } },
) => Promise<{ data?: unknown; error?: unknown; response: Response }>;
const post = (path: string, id: string) =>
  must((api.POST as unknown as Untyped)(path, { params: { path: { id } } }));

export interface Interested {
  /** обновлённая возможность (статус `interested`), если сервер её прислал */
  item: OpportunityItem | null;
  /** сколько дел поставлено одним пакетом ленты; 0 — уже стояли (повторное нажатие) */
  tasks: number;
}

/** Ответ «Интересно»: обновлённая возможность и созданные дела (контракт #133). */
export function interestedResult(body: unknown): Interested {
  const b = (body ?? {}) as Record<string, unknown>;
  const tasks = Array.isArray(b.tasks) ? b.tasks.length : 0;
  const nested = (b.item ?? b.opportunity) as OpportunityItem | undefined;
  const item = nested ?? (typeof b.id === 'string' && 'title' in b ? (b as OpportunityItem) : null);
  return { item: item ?? null, tasks };
}

/** «Интересно»: агент ставит дела (регистрация, подготовка, участие) одним пакетом с откатом. */
export function useInterested() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      interestedResult(await post('/api/v1/opportunities/{id}/interested', id)),
    onSuccess: (result, id) => {
      qc.setQueryData<OpportunityPick>(OPPORTUNITIES, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((i) =>
                i.id === id
                  ? { ...i, ...(result.item ?? {}), status: 'interested', tasks: result.tasks }
                  : i,
              ),
            }
          : old,
      );
      void qc.invalidateQueries({ queryKey: TIMELINE });
    },
  });
}

/** Убрать карточку из списка; кончились все — спросить сервер заново (вдруг есть новые). */
export function forget(qc: QueryClient, id: string) {
  let empty = false;
  qc.setQueryData<OpportunityPick>(OPPORTUNITIES, (old) => {
    if (!old) return old;
    const items = old.items.filter((i) => i.id !== id);
    empty = items.length === 0;
    return { ...old, items };
  });
  if (empty) void qc.invalidateQueries({ queryKey: OPPORTUNITIES });
}

/** «Не надо»: статус `dismissed`, больше не предлагается. */
export function dismiss(id: string) {
  return post('/api/v1/opportunities/{id}/dismiss', id);
}

export function useDismiss() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: dismiss,
    onSuccess: (_, id) => {
      forget(qc, id);
      void qc.invalidateQueries({ queryKey: TIMELINE });
    },
  });
}
