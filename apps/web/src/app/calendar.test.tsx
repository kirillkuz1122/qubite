import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ME, useMe } from '../auth/client';
import { useCalendar, useCalendarEvents } from './calendar';
import type { CalendarEvent, CalendarItem } from './calendar-view';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn<typeof fetch>() }));
vi.mock('../api', async () => {
  const { createQubiteClient } = await import('@qubite/api-client');
  return { api: createQubiteClient({ baseUrl: 'http://calendar.test', fetch: fetchMock }) };
});

const window = { days: ['2026-10-30'], from: 1_793_302_000_000, to: 1_793_388_400_000 };
const event: CalendarEvent = {
  id: 'event',
  owner_id: 'first',
  title: 'Личное событие',
  notes: 'Полные заметки',
  place: 'Дом',
  project_id: 'project',
  recurrence: { freq: 'weekly', interval: 2, weekdays: [1, 5] },
  revision: 7,
  starts_at: window.from,
  ends_at: window.from + 3_600_000,
  all_day: false,
  deleted: false,
  created_at: 0,
  updated_at: 0,
};
const item: CalendarItem = {
  kind: 'event',
  source_id: event.id,
  title: event.title,
  place: event.place,
  starts_at: event.starts_at,
  ends_at: event.ends_at,
  all_day: false,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const clients: QueryClient[] = [];
function setup(account: string | null = 'first') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  client.setQueryData(ME, account ? { id: account } : null);
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, wrapper: Wrapper };
}

beforeEach(() => {
  fetchMock.mockReset();
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

describe('календарь и аккаунт', () => {
  it('ждёт определения пользователя даже при ручном refetch', async () => {
    const me = deferred<Response>();
    fetchMock.mockImplementation(async (request) => {
      return new URL((request as Request).url).pathname === '/api/auth/me'
        ? me.promise
        : json([item]);
    });
    const context = setup(null);
    context.client.removeQueries({ queryKey: ME });
    const { result } = renderHook(() => useCalendar(window), context);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(new URL((fetchMock.mock.calls[0]![0] as Request).url).pathname).toBe('/api/auth/me');
    await act(async () => {
      await result.current.refetch();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBeUndefined();

    await act(async () => me.resolve(json({ id: 'first' })));
    await waitFor(() => expect(result.current.data).toEqual([item]));
    expect(context.client.getQueryData(['calendar', 'first', window.from, window.to])).toEqual([item]);
  });

  it('не запрашивает записи для гостя', async () => {
    const context = setup(null);
    const { result } = renderHook(() => useCalendar(window), context);
    expect(result.current.isEnabled).toBe(false);
    await act(async () => {
      await result.current.refetch();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('при смене аккаунта не показывает данные прошлого, в том числе после 403', async () => {
    fetchMock.mockResolvedValueOnce(json([item]));
    const context = setup();
    const { result } = renderHook(() => useCalendar(window), context);
    await waitFor(() => expect(result.current.data).toEqual([item]));
    const denied = deferred<Response>();
    fetchMock.mockReturnValueOnce(denied.promise);
    act(() => {
      context.client.setQueryData(ME, { id: 'second' });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBeUndefined();
    await act(async () => denied.resolve(json({ error: 'forbidden' }, 403)));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(context.client.getQueryData(['calendar', 'first', window.from, window.to])).toEqual([item]);
    expect(
      context.client.getQueryState(['calendar', 'second', window.from, window.to])?.status,
    ).toBe('error');
  });

  it('скрывает сохранённый ответ при отказе в доступе во время обновления', async () => {
    fetchMock.mockResolvedValueOnce(json([item]));
    const context = setup();
    const { result } = renderHook(() => useCalendar(window), context);
    await waitFor(() => expect(result.current.data).toEqual([item]));
    fetchMock.mockResolvedValueOnce(json({ error: 'forbidden' }, 403));
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.isError).toBe(true);
    expect(result.current.data).toBeUndefined();
  });
});

describe('чтение полного события', () => {
  it('загружает все поля и revision в known через GET события', async () => {
    fetchMock.mockResolvedValueOnce(json(event));
    const { result } = renderHook(() => useCalendarEvents(), setup());
    expect(result.current.known).toEqual({});
    await act(async () => {
      expect(await result.current.read(event.id)).toEqual(event);
    });
    expect(result.current.known[event.id]).toEqual(event);
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(request.method).toBe('GET');
    expect(new URL(request.url).pathname).toBe('/api/calendar/events/event');
  });

  it('поздний ответ прошлого аккаунта не попадает в known нового', async () => {
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const context = setup();
    const { result } = renderHook(() => {
      const events = useCalendarEvents();
      const me = useMe();
      return { ...events, accountId: me.data?.id };
    }, context);
    let reading!: Promise<CalendarEvent>;
    act(() => {
      reading = result.current.read(event.id);
    });
    act(() => {
      context.client.setQueryData(ME, { id: 'second' });
    });
    await waitFor(() => expect(result.current.accountId).toBe('second'));
    await act(async () => {
      response.resolve(json(event));
      await reading;
    });
    expect(result.current.known).toEqual({});
    act(() => {
      context.client.setQueryData(ME, { id: 'first' });
    });
    await waitFor(() => expect(result.current.known[event.id]).toEqual(event));
    act(() => {
      context.client.setQueryData(ME, null);
    });
    await waitFor(() => expect(result.current.known).toEqual({}));
  });

  it('передаёт 404 без сохранения несуществующего события', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'not_found' }, 404));
    const { result } = renderHook(() => useCalendarEvents(), setup());
    await act(async () => {
      await expect(result.current.read(event.id)).rejects.toMatchObject({ status: 404 });
    });
    expect(result.current.known).toEqual({});
  });

  it('после ошибки сети разрешает повторное чтение', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(json(event));
    const { result } = renderHook(() => useCalendarEvents(), setup());
    await act(async () => {
      await expect(result.current.read(event.id)).rejects.toMatchObject({ code: 'network' });
    });
    expect(result.current.known).toEqual({});
    await act(async () => {
      await result.current.read(event.id);
    });
    expect(result.current.known[event.id]).toEqual(event);
  });
});
