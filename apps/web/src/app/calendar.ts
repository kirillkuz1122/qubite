/** Календарь через общий типизированный клиент; дела — через тот же sync, что Planner. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Fail, must, useMe } from '../auth/client';
import {
  MAX_WINDOW_MS,
  type CalendarWindow,
  type CalendarEvent,
  type EventBody,
  type EventPatch,
} from './calendar-view';

export function useCalendar(window: CalendarWindow) {
  const me = useMe();
  const accountId = me.isSuccess ? me.data?.id : undefined;
  const query = useQuery({
    queryKey: ['calendar', accountId, window.from, window.to],
    queryFn: ({ signal }) => {
      // refetch (например, от sync) может вызываться и у выключенного запроса.
      if (!accountId) return [];
      return must(
        api.GET('/api/calendar', {
          params: { query: { from: window.from, to: window.to } },
          signal,
        }),
      );
    },
    enabled: !!accountId && window.to > window.from && window.to - window.from <= MAX_WINDOW_MS,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  // При отказе в доступе React Query сохраняет прежний успешный ответ в data.
  const forbidden = query.error instanceof Fail && query.error.status === 403;
  return { ...query, data: accountId && !forbidden ? query.data : undefined };
}

/** Полные снимки с revision отделены по аккаунтам, включая поздние ответы запросов. */
export function useCalendarEvents() {
  const qc = useQueryClient();
  const me = useMe();
  const accountId = me.isSuccess ? me.data?.id : undefined;
  const [accounts, setAccounts] = useState<Record<string, Record<string, CalendarEvent>>>({});
  const known = accountId ? (accounts[accountId] ?? {}) : {};
  const refresh = () => qc.invalidateQueries({ queryKey: ['calendar'] });
  const forget = (id: string) => {
    if (!accountId) return;
    setAccounts((current) => {
      const next = { ...current[accountId] };
      delete next[id];
      return { ...current, [accountId]: next };
    });
  };
  const remember = (event: CalendarEvent) => {
    if (!accountId) throw new Fail('unauthorized', 'Войдите в аккаунт', 401);
    setAccounts((current) => ({
      ...current,
      [accountId]: { ...current[accountId], [event.id]: event },
    }));
    return event;
  };
  const requireAccount = () => {
    if (!accountId) throw new Fail('unauthorized', 'Войдите в аккаунт', 401);
  };
  return {
    known,
    forget,
    refresh,
    async read(id: string) {
      requireAccount();
      return remember(
        await must(api.GET('/api/calendar/events/{id}', { params: { path: { id } } })),
      );
    },
    async create(body: EventBody) {
      requireAccount();
      const event = remember(await must(api.POST('/api/calendar/events', { body })));
      await refresh();
      return event;
    },
    async patch(event: CalendarEvent, body: EventPatch) {
      requireAccount();
      const saved = remember(
        await must(
          api.PATCH('/api/calendar/events/{id}', {
            params: { path: { id: event.id } },
            body: { ...body, revision: event.revision },
          }),
        ),
      );
      await refresh();
      return saved;
    },
    async remove(id: string) {
      requireAccount();
      await must(api.DELETE('/api/calendar/events/{id}', { params: { path: { id } } }));
      forget(id);
      await refresh();
    },
  };
}
