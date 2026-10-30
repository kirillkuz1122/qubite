/** Календарь через общий типизированный клиент. */
import type { components } from '@qubite/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Fail, must } from '../auth/client';
import {
  MAX_WINDOW_MS,
  type CalendarWindow,
  type CalendarEvent,
  type EventBody,
} from './calendar-view';

export function useCalendar(window: CalendarWindow) {
  return useQuery({
    queryKey: ['calendar', window.from, window.to],
    queryFn: ({ signal }) =>
      must(
        api.GET('/api/calendar', {
          params: { query: { from: window.from, to: window.to } },
          signal,
        }),
      ),
    enabled: window.to > window.from && window.to - window.from <= MAX_WINDOW_MS,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/** Полную запись возвращают только POST/PATCH; GET календаря содержит лишь проекцию.
 * Не подменяем чтение пустым PATCH: он увеличивает revision и пишет в БД.
 */
export function useCalendarEvents() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['calendar'] });
  const remember = (event: CalendarEvent) => {
    qc.setQueryDefaults(['calendar-event', event.id], { gcTime: Infinity });
    qc.setQueryData(['calendar-event', event.id], event);
    return event;
  };
  return {
    known: (id: string) => qc.getQueryData<CalendarEvent>(['calendar-event', id]),
    refresh,
    async create(body: EventBody) {
      const event = remember(await must(api.POST('/api/calendar/events', { body })));
      await refresh();
      return event;
    },
    async patch(event: CalendarEvent, body: components['schemas']['CalendarEventPatch']) {
      try {
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
      } catch (error) {
        if (error instanceof Fail && error.status === 409) {
          qc.removeQueries({ queryKey: ['calendar-event', event.id], exact: true });
          await refresh();
        }
        throw error;
      }
    },
    async remove(id: string) {
      await must(api.DELETE('/api/calendar/events/{id}', { params: { path: { id } } }));
      qc.removeQueries({ queryKey: ['calendar-event', id], exact: true });
      await refresh();
    },
  };
}
