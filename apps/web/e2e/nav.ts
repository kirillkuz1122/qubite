import type { Page } from '@playwright/test';

/**
 * Перейти в раздел. На ПК все разделы — в боковой панели; на телефоне в нижней панели только
 * Главная, Сегодня и Planner, остальное — в листе «Ещё» (D-866, D-945).
 */
export async function goSection(page: Page, name: string) {
  const nav = page.getByRole('navigation', { name: 'Разделы' });
  await nav.waitFor();
  const direct = nav.getByRole('button', { name });
  if (await direct.count()) {
    await direct.first().click();
    return;
  }
  await nav.getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.getByRole('dialog', { name: 'Ещё' }).getByRole('button', { name }).click();
}
