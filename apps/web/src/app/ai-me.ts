import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { must } from '../auth/client';

export const MY_AI = ['my-ai'] as const;

/** Ответ «AI и бюджет»; пока идёт вход в ChatGPT — обновляется сам каждые 3 с. */
export function useMyAi(waiting = false) {
  return useQuery({
    queryKey: MY_AI,
    queryFn: () => must(api.GET('/api/ai/me')),
    retry: false,
    refetchInterval: waiting ? 3_000 : false,
  });
}
