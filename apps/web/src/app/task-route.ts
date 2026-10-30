/** Дорога до дела: только сервер Qubite, исходная точка живёт в памяти вызова. */
import type { RoutePoint, TaskRouteResponse } from '@qubite/api-client';
import { toTask, type SyncClient } from '@qubite/sync-client';
import { api } from '../api';
import { Fail, must, say } from '../auth/client';

export const GEOLOCATION_HELP =
  'Выбрать на карте не получилось — разреши геолокацию в браузере';

export class LocationError extends Error {
  constructor() {
    super(GEOLOCATION_HELP);
  }
}

type RouteGeolocation = Pick<Geolocation, 'getCurrentPosition'>;

/** Разовый запрос после пояснения пользователю; без watchPosition и записи координат. */
export function routeOrigin(
  geolocation: RouteGeolocation | undefined = globalThis.navigator?.geolocation,
  signal?: AbortSignal,
): Promise<RoutePoint> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Запрос отменён', 'AbortError'));
      return;
    }
    if (!geolocation) {
      reject(new LocationError());
      return;
    }
    const abort = () => reject(new DOMException('Запрос отменён', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    const finish = () => signal?.removeEventListener('abort', abort);
    try {
      geolocation.getCurrentPosition(
        ({ coords }) => {
          finish();
          if (signal?.aborted) return;
          const point = { lat: coords.latitude, lon: coords.longitude };
          if (isPoint(point)) resolve(point);
          else reject(new LocationError());
        },
        () => {
          finish();
          reject(new LocationError());
        },
        { enableHighAccuracy: false, maximumAge: 0, timeout: 15_000 },
      );
    } catch {
      finish();
      reject(new LocationError());
    }
  });
}

function isPoint(value: unknown): value is RoutePoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<RoutePoint>;
  return (
    typeof point.lat === 'number' &&
    Number.isFinite(point.lat) &&
    Math.abs(point.lat) <= 90 &&
    typeof point.lon === 'number' &&
    Number.isFinite(point.lon) &&
    Math.abs(point.lon) <= 180
  );
}

/** Не отдаём SVG битую или неограниченную геометрию даже при неверном ответе сервера. */
export function parseTaskRoute(value: unknown): TaskRouteResponse {
  const bad = () => new Fail('route_unavailable', 'Не получилось прочитать маршрут', 503);
  if (!value || typeof value !== 'object') throw bad();
  const r = value as Partial<TaskRouteResponse>;
  if (
    typeof r.minutes !== 'number' ||
    !Number.isInteger(r.minutes) ||
    r.minutes < 0 ||
    r.minutes > 525600 ||
    typeof r.meters !== 'number' ||
    !Number.isFinite(r.meters) ||
    r.meters < 0 ||
    !isPoint(r.to) ||
    !Array.isArray(r.geometry) ||
    r.geometry.length < 2 ||
    r.geometry.length > 200 ||
    !r.geometry.every(isPoint) ||
    (r.place_text !== null && typeof r.place_text !== 'string') ||
    typeof r.provider !== 'string' ||
    typeof r.attribution !== 'string'
  )
    throw bad();
  return {
    minutes: r.minutes,
    meters: r.meters,
    geometry: r.geometry,
    place_text: r.place_text,
    to: r.to,
    provider: r.provider,
    attribution: r.attribution,
  };
}

export function routeError(error: unknown): string {
  if (error instanceof LocationError) return GEOLOCATION_HELP;
  if (error instanceof Fail) {
    switch (error.code) {
      case 'place_missing':
        return 'Укажи и сохрани место дела, затем построй маршрут.';
      case 'place_not_found':
        return 'Место не найдено. Уточни адрес и попробуй ещё раз.';
      case 'route_unavailable':
        return 'Сервис маршрутов сейчас недоступен. Попробуй ещё раз позже.';
      case 'conflict':
        return 'Дело изменилось. Проверь место и повтори расчёт.';
      case 'not_found':
        return 'Дело не найдено — возможно, его удалили.';
      case 'forbidden':
        return 'Нет права строить маршрут для этого дела.';
    }
  }
  return say(error);
}

export function routeSummary(route: Pick<TaskRouteResponse, 'minutes' | 'meters'>): string {
  const km = (route.meters / 1000).toLocaleString('ru-RU', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `≈ ${route.minutes} мин, ${km} км`;
}

export function yandexRoute(from: RoutePoint, to: RoutePoint): string {
  return `https://yandex.ru/maps/?rtext=${from.lat},${from.lon}~${to.lat},${to.lon}&rtt=auto`;
}

/** Одинаковый масштаб по обеим осям; север сверху, рамка с запасом для подписей. */
export function routeDrawing(geometry: RoutePoint[], from: RoutePoint, to: RoutePoint) {
  const points = [...geometry, from, to];
  const midLatitude =
    (Math.min(...points.map((p) => p.lat)) + Math.max(...points.map((p) => p.lat))) / 2;
  const longitudeScale = Math.max(0.001, Math.cos((midLatitude * Math.PI) / 180));
  const xs = points.map((p) => p.lon * longitudeScale);
  const ys = points.map((p) => -p.lat);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(272 / (maxX - minX || 1e-9), 144 / (maxY - minY || 1e-9));
  const project = (p: RoutePoint) => ({
    x: 160 + (p.lon * longitudeScale - (minX + maxX) / 2) * scale,
    y: 100 + (-p.lat - (minY + maxY) / 2) * scale,
  });
  return {
    line: geometry
      .map(project)
      .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(' '),
    from: project(from),
    to: project(to),
  };
}

/** Сначала доставка адреса на сервер; полученные минуты забираем обычной синхронизацией. */
export async function calculateTaskRoute(
  client: Pick<SyncClient, 'sync' | 'get' | 'problems'>,
  id: string,
  place: string,
  from: RoutePoint,
  signal: AbortSignal,
): Promise<TaskRouteResponse> {
  const state = await client.sync();
  if (signal.aborted) throw new DOMException('Запрос отменён', 'AbortError');
  if (state.status === 'error') throw new Fail('network', 'Нет связи с сервером', 0);
  const object = await client.get(id);
  if (!object || object.deleted) throw new Fail('not_found', 'Дело не найдено', 404);
  if (
    object.pending ||
    toTask(object).place_text !== place ||
    (await client.problems()).some((p) => p.op.object_id === id)
  )
    throw new Fail('conflict', 'Место ещё не подтверждено сервером', 409);
  try {
    return parseTaskRoute(
      await must(
        api.POST('/api/v1/planner/tasks/{id}/route', {
          params: { path: { id } },
          body: { from },
          cache: 'no-store',
          signal,
        }),
      ),
    );
  } finally {
    // Геокодированное место могло сохраниться и при отказе сервиса маршрутов.
    if (!signal.aborted) await client.sync();
  }
}
