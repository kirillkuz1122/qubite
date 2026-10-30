import type { LocalObject, SyncClient } from '@qubite/sync-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Fail } from '../auth/client';
import { calculateTaskRoute } from './task-route';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../api', () => ({ api: { POST: post } }));

const from = { lat: 55.16, lon: 61.4 };
const to = { lat: 55.17, lon: 61.42 };
const place = 'Музей';
const result = {
  minutes: 12,
  meters: 3400,
  geometry: [from, to],
  place_text: place,
  to,
  provider: 'osrm',
  attribution: '© OpenStreetMap',
};

function client() {
  const object: LocalObject = {
    id: 'task-1',
    object_type: 'planner.task',
    title: 'Сходить в музей',
    revision: 1,
    deleted: false,
    updated_at_ms: 0,
    pending: false,
    fields: { place_text: place },
  };
  return {
    sync: vi.fn<SyncClient['sync']>().mockResolvedValue({ status: 'synced', pending: 0, problems: 0 }),
    get: vi.fn<SyncClient['get']>().mockResolvedValue(object),
    problems: vi.fn<SyncClient['problems']>().mockResolvedValue([]),
  };
}

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ data: result, response: new Response() });
});

describe('дорога и синхронизация', () => {
  it('сначала отправляет сохранённое место, потом считает маршрут и забирает минуты', async () => {
    const c = client();
    const signal = new AbortController().signal;
    post.mockImplementation(async () => {
      expect(c.sync).toHaveBeenCalledTimes(1);
      return { data: result, response: new Response() };
    });
    await expect(calculateTaskRoute(c, 'task-1', place, from, signal)).resolves.toEqual(result);
    expect(c.sync).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledWith('/api/v1/planner/tasks/{id}/route', {
      params: { path: { id: 'task-1' } },
      body: { from },
      cache: 'no-store',
      signal,
    });
  });

  it('не обращается к маршрутам, если синхронизация недоступна', async () => {
    const c = client();
    c.sync.mockResolvedValue({ status: 'error', pending: 0, problems: 0 });
    await expect(
      calculateTaskRoute(c, 'task-1', place, from, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'network' });
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    { pending: true, fields: { place_text: place } },
    { pending: false, fields: { place_text: 'Другой адрес' } },
  ])('не строит маршрут по неподтверждённому или изменённому месту %#', async (fields) => {
    const c = client();
    c.get.mockResolvedValue({ ...(await c.get('task-1'))!, ...fields });
    await expect(
      calculateTaskRoute(c, 'task-1', place, from, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(post).not.toHaveBeenCalled();
  });

  it('после ошибки забирает найденную сервером точку и разрешает повторить расчёт', async () => {
    const c = client();
    post.mockResolvedValueOnce({
      error: { error: 'route_unavailable', message: 'Сервис временно недоступен' },
      response: new Response(null, { status: 503 }),
    });
    await expect(
      calculateTaskRoute(c, 'task-1', place, from, new AbortController().signal),
    ).rejects.toBeInstanceOf(Fail);
    expect(c.sync).toHaveBeenCalledTimes(2);
    await expect(
      calculateTaskRoute(c, 'task-1', place, from, new AbortController().signal),
    ).resolves.toEqual(result);
  });

  it('после закрытия окна не отправляет координаты', async () => {
    const c = client();
    const controller = new AbortController();
    c.sync.mockImplementation(async () => {
      controller.abort();
      return { status: 'synced', pending: 0, problems: 0 };
    });
    await expect(
      calculateTaskRoute(c, 'task-1', place, from, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(post).not.toHaveBeenCalled();
  });
});
