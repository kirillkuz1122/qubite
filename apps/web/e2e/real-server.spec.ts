import { expect, test } from '@playwright/test';

/*
 * Сквозная проверка на НАСТОЯЩЕМ сервере Qubite (не на подделке). Обычный `just e2e`
 * её пропускает: нужен запущенный `qubite serve`, сайт с прокси на него и owner.
 *
 *   QUBITE_E2E_REAL=http://localhost:4180 QUBITE_E2E_EMAIL=… QUBITE_E2E_PASSWORD=… \
 *     pnpm exec playwright test real-server --project=firefox
 *
 * Как поднять всё локально — docs/engineering/DEVELOPMENT.md («Проверка на настоящем сервере»).
 */
const BASE = process.env.QUBITE_E2E_REAL;
const EMAIL = process.env.QUBITE_E2E_EMAIL ?? '';
const PASSWORD = process.env.QUBITE_E2E_PASSWORD ?? '';

test.skip(!BASE, 'нужен настоящий сервер: QUBITE_E2E_REAL');
test.use({ baseURL: BASE ?? 'http://localhost' });

test('настоящий сервер: вход, сессия на «Аккаунте», выход', async ({ page }) => {
  await page.goto('/auth');
  await page.getByLabel('Почта').fill(EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill('точно-не-тот-пароль');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();

  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.goto('/account');
  await expect(page.getByText(EMAIL).first()).toBeVisible();
  await expect(page.getByText('это устройство')).toBeVisible();
  await page.getByRole('button', { name: 'Выйти здесь' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/auth\?return_to=/);
});
