import { expect, test } from '@playwright/test';

test('витрина дизайн-системы открывается и живёт', async ({ page }) => {
  await page.goto('/design');
  await expect(page.getByRole('heading', { name: 'Дизайн-система Qubite' })).toBeAttached();
  await expect(page.getByRole('img', { name: 'Qubite' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Прото' })).toBeVisible();
});

test('тема переключается и запоминается', async ({ page }) => {
  await page.goto('/design');
  await page.getByRole('radio', { name: 'Светлая' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('строка Command понимает, что это дело со сроком', async ({ page }) => {
  await page.goto('/design');
  await page.getByRole('textbox', { name: 'Строка Command' }).fill('завтра в 16:00 сдать проект');
  await expect(page.getByRole('status').filter({ hasText: 'Дело' })).toContainText('завтра, 16:00');
});
