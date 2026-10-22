/**
 * Агент раскладывает Входящие (CMD-004): что он обдумывает, что разложил («разложил → Русский ·
 * дело на чт» с «Откатить») и ответ на его вопрос «посмотри сам». Откат — общий откат пакета ленты
 * (AGT-002); после него мысль возвращается во Входящие сама — по «есть новое» синхронизации.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { must } from '../auth/client';
import { TIMELINE } from './agent';
import type { AgentRevertResult } from './agent-view';

export interface Filed {
  item_id: string;
  thought: string;
  label: string;
  action_id: string;
  batch_id: string;
  at: string;
  reason?: string | null;
}

export interface Triage {
  thinking: string[];
  filed: Filed[];
}

export const TRIAGE = ['agent-triage'] as const;

/** Пока агент думает — спрашиваем чаще, иначе изредка (новое приходит и по синхронизации). */
export function useTriage(version: number) {
  return useQuery({
    queryKey: [...TRIAGE, version],
    queryFn: (): Promise<Triage> => must(api.GET('/api/v1/agent/triage')),
    placeholderData: (previous) => previous,
    refetchInterval: (q) => (q.state.data?.thinking.length ? 2500 : 20_000),
    retry: false,
  });
}

/** «Откатить» во Входящих: весь пакет «разложил» одной кнопкой. */
export function useUndoFiled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batch: string) =>
      must<AgentRevertResult>(
        api.POST('/api/v1/agent/batches/{id}/revert', {
          params: { path: { id: batch } },
          body: { force: false },
        }),
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: TRIAGE });
      void qc.invalidateQueries({ queryKey: TIMELINE });
    },
  });
}

/** Ответ на вопрос агента: он разложит мысль по ответу и запомнит. */
export function useAnswer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ item, answer }: { item: string; answer: string }) =>
      must(
        api.POST('/api/v1/agent/triage/{id}/answer', {
          params: { path: { id: item } },
          body: { answer },
        }),
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: TRIAGE }),
  });
}
