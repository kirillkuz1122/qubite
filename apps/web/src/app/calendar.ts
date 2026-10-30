/** Календарь через общий типизированный клиент; дела — через тот же sync, что Planner. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { must } from '../auth/client';
import {
  MAX_WINDOW_MS,
  type CalendarWindow,
  type CalendarEvent,
  type EventBody,
  type EventPatch,
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

/**
 * В текущем API нет GET полного события. Сохраняем полные ответы POST/PATCH только
 * на время экрана; CalendarItem нельзя выдавать за полное событие с revision.
 * После 409 снимок забывается: повторять PATCH с выдуманной версией нельзя.
 */
export function useCalendarEvents() {
  const qc = useQueryClient();
  const [known, setKnown] = useState<Record<string, CalendarEvent>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ['calendar'] });
  const forget = (id: string) =>
    setKnown((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  const remember = (event: CalendarEvent) => {
    setKnown((current) => ({ ...current, [event.id]: event }));
    return event;
  };
  return {
    known,
    forget,
    refresh,
    async create(body: EventBody) {
      const event = remember(await must(api.POST('/api/calendar/events', { body })));
      await refresh();
      return event;
    },
    async patch(event: CalendarEvent, body: EventPatch) {
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
      await must(api.DELETE('/api/calendar/events/{id}', { params: { path: { id } } }));
      forget(id);
      await refresh();
    },
  };
}

export const EVENT_READ_UNAVAILABLE =
  'Правка недоступна: сервер пока не отдаёт полное событие. Нужен запрос чтения события с версией, заметками, проектом и повтором.';
