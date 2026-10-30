/** CAL-001b: только чтение календаря через общий типизированный клиент. */
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { must } from '../auth/client';
import { MAX_WINDOW_MS, type CalendarWindow } from './calendar-view';

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
