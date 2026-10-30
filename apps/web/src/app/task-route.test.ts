import { afterEach, describe, expect, it, vi } from 'vitest';
import { Fail } from '../auth/client';
import {
  GEOLOCATION_HELP,
  LocationError,
  parseTaskRoute,
  routeDrawing,
  routeError,
  routeOrigin,
  routeSummary,
  yandexRoute,
} from './task-route';

const from = { lat: 55.16, lon: 61.4 };
const to = { lat: 55.17, lon: 61.42 };
const response = {
  minutes: 12,
  meters: 3400,
  geometry: [from, { lat: 55.165, lon: 61.405 }, to],
  place_text: 'Челябинск, площадь Революции',
  to,
  provider: 'osrm',
  attribution: '© OpenStreetMap',
};

afterEach(() => vi.unstubAllGlobals());

describe('ответ маршрута и схема без карт', () => {
  it('разбирает контракт AGT-006a, показывает километры и ссылку с lat,lon', () => {
    expect(parseTaskRoute(response)).toEqual(response);
    expect(routeSummary(response)).toBe('≈ 12 мин, 3,4 км');
    expect(routeSummary({ minutes: 0, meters: 0 })).toBe('≈ 0 мин, 0,0 км');
    const url = new URL(yandexRoute(from, to));
    expect(url.origin).toBe('https://yandex.ru');
    expect(url.searchParams.get('rtext')).toBe('55.16,61.4~55.17,61.42');
    expect(url.searchParams.get('rtt')).toBe('auto');
  });

  it.each([
    null,
    {},
    { ...response, minutes: -1 },
    { ...response, minutes: 1.5 },
    { ...response, minutes: 525601 },
    { ...response, meters: Infinity },
    { ...response, meters: -10 },
    { ...response, to: { lat: 91, lon: 10 } },
    { ...response, geometry: [] },
    { ...response, geometry: [from] },
    { ...response, geometry: Array.from({ length: 201 }, () => from) },
    { ...response, geometry: [from, { lat: NaN, lon: 5 }] },
    {
      ...response,
      geometry: [
        [61.4, 55.16],
        [61.42, 55.17],
      ],
    },
  ])('не рисует неверный ответ %#', (body) => {
    expect(() => parseTaskRoute(body)).toThrow(Fail);
  });

  it('укладывает весь маршрут в рамку, север сверху; совпадающие точки допустимы', () => {
    const drawing = routeDrawing(response.geometry, from, to);
    expect(drawing.to.y).toBeLessThan(drawing.from.y);
    for (const pair of drawing.line.split(' ')) {
      const [x, y] = pair.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(24);
      expect(x).toBeLessThanOrEqual(296);
      expect(y).toBeGreaterThanOrEqual(28);
      expect(y).toBeLessThanOrEqual(172);
    }
    const same = routeDrawing([from, from], from, from);
    expect(same.line).toBe('160.00,100.00 160.00,100.00');
    expect(same.from).toEqual({ x: 160, y: 100 });
  });

  it.each([
    ['place_missing', 'Укажи и сохрани место'],
    ['place_not_found', 'Место не найдено'],
    ['route_unavailable', 'Сервис маршрутов сейчас недоступен'],
    ['conflict', 'Дело изменилось'],
  ])('пишет по-человечески при %s', (code, text) => {
    expect(routeError(new Fail(code, 'технический текст', 400))).toContain(text);
  });
});

describe('геолокация только по запросу', () => {
  it('получает одну точку и передаёт браузеру ограничение по времени', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { latitude: from.lat, longitude: from.lon } } as GeolocationPosition);
    });
    expect(getCurrentPosition).not.toHaveBeenCalled();
    await expect(routeOrigin({ getCurrentPosition })).resolves.toEqual(from);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: false,
      maximumAge: 0,
      timeout: 15_000,
    });
  });

  it.each([1, 2, 3])('отказ или ошибка %s даёт подсказку, без запроса к API', async (code) => {
    const getCurrentPosition = vi.fn(
      (_success: PositionCallback, fail?: PositionErrorCallback | null) => {
        fail?.({ code } as GeolocationPositionError);
      },
    );
    await expect(routeOrigin({ getCurrentPosition })).rejects.toBeInstanceOf(LocationError);
    expect(routeError(new LocationError())).toBe(GEOLOCATION_HELP);
  });

  it('браузер без геолокации получает ту же понятную подсказку', async () => {
    vi.stubGlobal('navigator', {});
    await expect(routeOrigin()).rejects.toThrow(GEOLOCATION_HELP);
  });

  it('закрытие окна отменяет ожидание геолокации', async () => {
    const controller = new AbortController();
    let success: PositionCallback | undefined;
    const waiting = routeOrigin(
      { getCurrentPosition: (callback) => void (success = callback) },
      controller.signal,
    );
    const rejection = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    // Поздний ответ браузера не возобновляет построение маршрута.
    success?.({ coords: { latitude: from.lat, longitude: from.lon } } as GeolocationPosition);
  });
});
