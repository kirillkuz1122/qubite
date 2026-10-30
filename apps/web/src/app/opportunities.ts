/**
 * Возможности на Главной (AGT-005, D-732…D-734): запросы к `/api/v1/opportunities*`.
 * Сначала берём то, что агент отобрал (`suggested`); если отбора нет — ближайшие новые
 * (`new`) с пометкой «без отбора агента». Прошедшие не показываем.
 */
import type { components } from '@qubite/api-client';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { must } from '../auth/client';
import { useMe } from '../auth/client';
import { OPPORTUNITIES_ROOT, TIMELINE } from './agent';
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

/**
 * Ключ запроса — с id аккаунта: после выхода и входа другим человеком в той же вкладке
 * кэш прежнего («почему тебе» — личное) не показывается.
 */
export function useOpportunitiesKey() {
  const me = useMe();
  return [...OPPORTUNITIES_ROOT, 'home', me.data?.id ?? 'guest'] as const;
}
type Key = ReturnType<typeof useOpportunitiesKey>;
/** Сколько держим про запас: убрал карточку — на её место встаёт следующая. */
const KEEP = 10;
const minutes = (n: number) => n * 60_000;

async function list(status: 'suggested' | 'new', now: Date) {
  const data = await must(
    api.GET('/api/v1/opportunities', {
      params: { query: { status, upcoming: true, limit: KEEP } },
    }),
  );
  return ahead(data.items, now).slice(0, KEEP);
}

export function useOpportunities() {
  const key = useOpportunitiesKey();
  const me = useMe();
  return useQuery({
    queryKey: key,
    // пока не знаем, чей аккаунт, не спрашиваем: иначе второй запрос под другим ключом
    enabled: me.isSuccess,
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
  const key = useOpportunitiesKey();
  return useMutation({
    mutationFn: () => must(api.POST('/api/v1/opportunities/refresh')),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export interface Interested {
  /** сколько дел поставлено одним пакетом ленты; 0 — уже стояли (повторное нажатие) */
  tasks: number;
}

/** Ответ «Интересно»: запись ленты со всеми шагами; дела — созданные `planner.task`. */
export function interestedResult(body: components['schemas']['OpportunityDecision']): Interested {
  const changes = body.action?.changes ?? [];
  return { tasks: changes.filter((c) => c.created && c.object_type === 'planner.task').length };
}

/** «Интересно»: агент ставит дела (регистрация, подготовка, участие) одним пакетом с откатом. */
export function useInterested() {
  const qc = useQueryClient();
  const key = useOpportunitiesKey();
  return useMutation({
    mutationFn: async (id: string) =>
      interestedResult(
        await must(api.POST('/api/v1/opportunities/{id}/interested', { params: { path: { id } } })),
      ),
    onSuccess: (result, id) => {
      qc.setQueryData<OpportunityPick>(key, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((i) =>
                i.id === id ? { ...i, status: 'interested', tasks: result.tasks } : i,
              ),
            }
          : old,
      );
      void qc.invalidateQueries({ queryKey: TIMELINE });
    },
  });
}

/** Убрать карточку из списка; кончились все — спросить сервер заново (вдруг есть новые). */
export function forget(qc: QueryClient, key: Key, id: string) {
  let empty = false;
  qc.setQueryData<OpportunityPick>(key, (old) => {
    if (!old) return old;
    const items = old.items.filter((i) => i.id !== id);
    empty = items.length === 0;
    return { ...old, items };
  });
  if (empty) void qc.invalidateQueries({ queryKey: key });
}

/** «Не надо»: статус `dismissed`, больше не предлагается. */
export function dismiss(id: string) {
  return must(api.POST('/api/v1/opportunities/{id}/dismiss', { params: { path: { id } } }));
}

export function useDismiss() {
  const qc = useQueryClient();
  const key = useOpportunitiesKey();
  return useMutation({
    mutationFn: dismiss,
    onSuccess: (_, id) => {
      forget(qc, key, id);
      void qc.invalidateQueries({ queryKey: TIMELINE });
    },
  });
}
