import { expect, test } from '@playwright/test';

const health = (status: 'ok' | 'down') => async (page: import('@playwright/test').Page) =>
  page.route('**/api/health', (route) =>
    status === 'ok'
      ? route.fulfill({ json: { status: 'ok', version: '0.1.0' } })
      : route.fulfill({ status: 503, body: 'down' }),
  );
const server = (page: import('@playwright/test').Page) =>
  page.getByRole('status').filter({ hasText: 'Сервер' });

test('лендинг открывается: заголовок, строка Command, вход в приложение', async ({ page }) => {
  await health('ok')(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Мысль — это точка.' })).toBeAttached();
  await expect(page.getByRole('textbox', { name: 'Строка Command' })).toBeVisible();
  await page.getByRole('link', { name: 'Начать' }).first().click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('heading', { name: 'Главная', level: 1 })).toBeAttached();
});

test('в подвале лендинга видно, что сервер работает', async ({ page }) => {
  await health('ok')(page);
  await page.goto('/');
  await expect(server(page)).toHaveText('Сервер работает · версия 0.1.0');
});

test('лендинг честно пишет, если сервер недоступен', async ({ page }) => {
  await health('down')(page);
  await page.goto('/');
  await expect(server(page)).toHaveText('Сервер недоступен');
});

test('строка Command на лендинге понимает, что это дело со сроком', async ({ page }) => {
  await health('ok')(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'дело со сроком' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Дело' })).toContainText('завтра, 16:00');
});

test('неизвестный адрес показывает страницу «нет такой страницы»', async ({ page }) => {
  await health('ok')(page);
  await page.goto('/nope');
  await expect(page.getByRole('heading', { name: 'Такой страницы нет' })).toBeVisible();
});
