import { expect, test } from '@playwright/test';

test('главная показывает, что сервер работает', async ({ page }) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { status: 'ok', version: '0.1.0' } }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Qubite' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Сервер работает · версия 0.1.0');
});

test('главная честно пишет, если сервер недоступен', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ status: 503, body: 'down' }));
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Сервер недоступен');
});

test('неизвестный адрес показывает страницу «нет такой страницы»', async ({ page }) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { status: 'ok', version: '0.1.0' } }),
  );
  await page.goto('/nope');
  await expect(page.getByRole('heading', { name: 'Такой страницы нет' })).toBeVisible();
});
