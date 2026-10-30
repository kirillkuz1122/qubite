/**
 * Лента агента (AGT-002): запросы к `/api/v1/agent/*`. Откат и исправление меняют дела на
 * сервере; экраны Planner узнают об этом сами — по «есть новое» синхронизации.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { must } from '../auth/client';
import type { AgentPage, AgentRevertResult, AgentRevertWhy } from './agent-view';

/** Какая часть ленты: вся, у дела (мысли) или у проекта. */
export type Trail = { object: string } | { project: string } | null;

/** Корень ключей «Возможностей»: откат в ленте может вернуть мероприятие на Главную. */
export const OPPORTUNITIES_ROOT = ['opportunities'] as const;
export const TIMELINE = ['agent-timeline'] as const;

export function useTimeline(trail: Trail, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...TIMELINE, trail],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }): Promise<AgentPage> =>
      must(
        api.GET('/api/v1/agent/timeline', {
          params: { query: { ...trail, before: pageParam, limit: trail ? 20 : 30 } },
        }),
      ),
    getNextPageParam: (last) => last.next ?? null,
    retry: false,
    enabled,
  });
}

export type RevertTarget = { action: string } | { batch: string };

/** Откатить действие или пакет. `force` — «вернуть как было», даже если после меняли. */
export function useRevert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ target, force }: { target: RevertTarget; force: boolean }) =>
      must<AgentRevertResult>(
        'action' in target
          ? api.POST('/api/v1/agent/actions/{id}/revert', {
              params: { path: { id: target.action } },
              body: { force },
            })
          : api.POST('/api/v1/agent/batches/{id}/revert', {
              params: { path: { id: target.batch } },
              body: { force },
            }),
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: OPPORTUNITIES_ROOT });
      return qc.invalidateQueries({ queryKey: TIMELINE });
    },
  });
}

export interface FixInput {
  action: string;
  object: string;
  title?: string | undefined;
  fields: Record<string, unknown>;
}

/** «Исправить»: твоя поправка к результату агента. */
export function useFix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, object, title, fields }: FixInput) =>
      must(
        api.POST('/api/v1/agent/actions/{id}/fix', {
          params: { path: { id: action } },
          body: { object_id: object, title: title ?? null, fields: fields as never },
        }),
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: TIMELINE }),
  });
}

/**
 * «Почему откатил?» — ответ на пакет отката: кнопка или свои слова. «Ошибся», «не надо такого» и
 * свои слова — урок агенту, «не сейчас» — нет (D-397).
 */
export function useRevertWhy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batch, answer }: { batch: string; answer: string }) =>
      must<AgentRevertWhy>(
        api.POST('/api/v1/agent/batches/{id}/why', {
          params: { path: { id: batch } },
          body: { answer },
        }),
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: TIMELINE }),
  });
}
