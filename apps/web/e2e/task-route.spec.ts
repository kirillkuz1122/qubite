import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { mockSync } from './sync-mock';

const title = 'Сходить в музей';
const place = 'Челябинск, улица Труда, 100';
const from = { lat: 55.16, lon: 61.4 };
const to = { lat: 55.17, lon: 61.42 };
type GeoWindow = Window & { routeGeoCalls: number };

async function setup(page: Page, denied = false) {
  const server = await mockSync(page);
  const now = new Date();
  const day = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const id = server.addTask(title, { due_date: day, place_text: place });
  const requests: unknown[] = [];
  const failure = { code: null as string | null };
  const external: string[] = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => {
    external.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript(
    ({ denied }) => {
      (window as unknown as GeoWindow).routeGeoCalls = 0;
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition(success: PositionCallback, fail?: PositionErrorCallback | null) {
            (window as unknown as GeoWindow).routeGeoCalls++;
            if (denied) {
              fail?.({ code: 1 } as GeolocationPositionError);
            } else {
              success({
                coords: { latitude: 55.16, longitude: 61.4 },
              } as GeolocationPosition);
            }
          },
        },
      });
    },
    { denied },
  );
  await page.route(`**/api/v1/planner/tasks/${id}/route`, async (route) => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.headers()['x-csrf-token']).toBe('e2e-csrf');
    expect(new URL(request.url()).search).toBe('');
    requests.push(request.postDataJSON());
    if (failure.code) {
      return route.fulfill({
        status:
          failure.code === 'route_unavailable' ? 503 : failure.code === 'place_missing' ? 400 : 404,
        json: { error: failure.code, message: 'Ошибка сервера' },
      });
    }
    server.patch(id, { travel_minutes: 12, place_lat: to.lat, place_lon: to.lon });
    return route.fulfill({
      json: {
        minutes: 12,
        meters: 3400,
        geometry: [from, { lat: 55.164, lon: 61.406 }, { lat: 55.168, lon: 61.411 }, to],
        place_text: (server.objects.get(id)!.fields as Record<string, unknown>).place_text,
        to,
        provider: 'osrm',
        attribution: '© OpenStreetMap',
      },
    });
  });
  return { server, id, requests, failure, external };
}

async function openTask(page: Page) {
  await page.getByRole('button', { name: `Открыть дело: ${title}` }).click();
  return page.getByRole('dialog', { name: 'Место и дорога', exact: true });
}

test('место и маршрут: пояснение до геолокации, схема, ссылка и метка после перезагрузки', async ({
  page,
}) => {
  const mock = await setup(page);
  await page.goto('/today');
  const dialog = await openTask(page);
  await expect(dialog.getByLabel('Место', { exact: true })).toHaveValue(place);
  await expect(dialog.getByText('Твои координаты не сохраняются.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as GeoWindow).routeGeoCalls)).toBe(0);
  expect(mock.requests).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Построить маршрут' }).click();
  await expect(dialog.getByText('≈ 12 мин, 3,4 км')).toBeVisible();
  await expect(
    dialog.getByRole('img', { name: 'Маршрут от точки «Вы» до точки «Место»' }),
  ).toBeVisible();
  await expect(dialog.locator('polyline')).toHaveAttribute('points', /\d+\.\d+,\d+\.\d+/);
  await expect(dialog.getByRole('link', { name: 'Открыть в Яндекс Картах' })).toHaveAttribute(
    'href',
    'https://yandex.ru/maps/?rtext=55.16,61.4~55.17,61.42&rtt=auto',
  );
  await expect(dialog.getByRole('link', { name: '© OpenStreetMap' })).toBeVisible();
  expect(mock.requests).toEqual([{ from }]);
  expect(mock.external).toEqual([]);
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.locator('.row').filter({ hasText: title })).toContainText('в пути 12 мин');
  await page.reload();
  await expect(page.locator('.row').filter({ hasText: title })).toContainText('в пути 12 мин');
  const reopened = await openTask(page);
  await expect(reopened.locator('polyline')).toHaveCount(0);
  await expect(reopened.getByText('предыдущий расчёт', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as GeoWindow).routeGeoCalls)).toBe(0);
  expect(mock.server.ops.every((op) => !JSON.stringify(op).includes('"from"'))).toBe(true);
});

test('отказ геолокации объяснён, запрос к серверу не уходит, повторить можно', async ({ page }) => {
  const mock = await setup(page, true);
  await page.goto('/today');
  const dialog = await openTask(page);
  await dialog.getByRole('button', { name: 'Построить маршрут' }).click();
  await expect(dialog.getByLabel('Откуда ехать')).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('разреши геолокацию в браузере');
  await expect(dialog.getByRole('button', { name: 'Построить маршрут' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Построить маршрут' }).click();
  expect(await page.evaluate(() => (window as unknown as GeoWindow).routeGeoCalls)).toBe(2);
  expect(mock.requests).toHaveLength(0);
  expect(mock.external).toHaveLength(0);
});

for (const [code, message] of [
  ['place_missing', 'Укажи и сохрани место'],
  ['place_not_found', 'Место не найдено'],
  ['route_unavailable', 'Сервис маршрутов сейчас недоступен'],
]) {
  test(`ошибка ${code}: человеческий текст и успешный повтор`, async ({ page }) => {
    const mock = await setup(page);
    mock.failure.code = code!;
    await page.goto('/today');
    const dialog = await openTask(page);
    await dialog.getByRole('button', { name: 'Построить маршрут' }).click();
    await expect(dialog.getByRole('alert')).toContainText(message!);
    mock.failure.code = null;
    await dialog.getByRole('button', { name: 'Построить маршрут' }).click();
    await expect(dialog.getByText('≈ 12 мин, 3,4 км')).toBeVisible();
    expect(mock.requests).toHaveLength(2);
  });
}

test('изменение и очистка места сохраняются без сети и сбрасывают прежнюю дорогу', async ({
  page,
}) => {
  const mock = await setup(page);
  mock.server.patch(mock.id, { travel_minutes: 12 });
  await page.goto('/today');
  const dialog = await openTask(page);
  mock.server.offline = true;
  await dialog.getByLabel('Место', { exact: true }).fill('Челябинск, библиотека');
  await expect(dialog.getByRole('button', { name: 'Построить маршрут' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(
    dialog.getByText('Изменения сохранены на устройстве', { exact: false }),
  ).toBeVisible();
  await page.reload();
  const reopened = await openTask(page);
  await expect(reopened.getByLabel('Место', { exact: true })).toHaveValue('Челябинск, библиотека');
  await expect(page.locator('.row').filter({ hasText: title })).not.toContainText('в пути');
  await reopened.getByLabel('Место', { exact: true }).fill('');
  await reopened.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(reopened.getByRole('button', { name: 'Построить маршрут' })).toHaveCount(0);
  await page.reload();
  const cleared = await openTask(page);
  await expect(cleared.getByLabel('Место', { exact: true })).toHaveValue('');
  mock.server.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(() => (mock.server.objects.get(mock.id)!.fields as Record<string, unknown>).place_text)
    .toBeNull();
  expect(mock.requests).toHaveLength(0);
});

test('на доске карточка открывается из меню, рассчитанная дорога видна у дела', async ({
  page,
}) => {
  const mock = await setup(page);
  mock.server.patch(mock.id, { travel_minutes: 12 });
  await page.goto('/planner');
  await page.getByRole('radio', { name: 'Доска' }).click();
  const card = page.locator('[data-card]').filter({ hasText: title });
  await expect(card).toContainText('в пути 12 мин');
  await card.getByRole('button', { name: 'Переместить в…' }).click();
  await card.getByRole('menuitem', { name: 'Место и дорога' }).click();
  await expect(page.getByRole('dialog').getByLabel('Место', { exact: true })).toHaveValue(place);
});

for (const theme of ['light', 'dark']) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 360, height: 780 },
  ]) {
    test(`маршрут: снимки ${theme}, ${viewport.width} px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((theme) => {
        localStorage.setItem('qubite.look.v1', JSON.stringify({ theme, motion: 'less' }));
      }, theme);
      await setup(page);
      await page.goto('/today');
      const dialog = await openTask(page);
      await page.evaluate(() => document.fonts.ready);
      const directory = '../../docs/design/screens/agt-006';
      await mkdir(directory, { recursive: true });
      const prefix = `${testInfo.project.name}-${theme}-${viewport.width}`;
      const editor = `${directory}/${prefix}-place.png`;
      await page.screenshot({ path: editor });
      await testInfo.attach('Место', { path: editor, contentType: 'image/png' });
      await dialog.getByRole('button', { name: 'Построить маршрут' }).click();
      await expect(dialog.getByText('≈ 12 мин, 3,4 км')).toBeVisible();
      await dialog.locator('.task-route-credit').scrollIntoViewIfNeeded();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const screenshot = `${directory}/${prefix}-route.png`;
      await page.screenshot({ path: screenshot });
      await testInfo.attach('Дорога', { path: screenshot, contentType: 'image/png' });
    });
  }
}
