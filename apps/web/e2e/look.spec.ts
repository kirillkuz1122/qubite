import { expect, test } from '@playwright/test';
import { mockAuth, OWNER } from './auth-mock';
import { mockSync } from './sync-mock';

/* DS-013: внутренние прокрутки — одна тонкая полоса из токенов, без системных стрелок (D-912). */
test('шкала Календаря прокручивается тонкой полосой, у страницы полосы нет', async ({ page }) => {
  await mockAuth(page, { me: OWNER });
  await mockSync(page);
  await page.goto('/calendar');
  const scroll = page.locator('.calendar-scroll').first();
  await expect(scroll).toBeVisible();
  const look = await scroll.evaluate((el) => {
    const css = getComputedStyle(el);
    const line = getComputedStyle(document.documentElement).getPropertyValue('--q-line-2').trim();
    return {
      width: css.scrollbarWidth,
      color: css.scrollbarColor,
      line,
      scrolls: el.scrollHeight > el.clientHeight,
    };
  });
  expect(look.scrolls).toBe(true);
  expect(look.width).toBe('thin');
  expect(look.color).not.toBe('auto');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth)).toBe(
    'none',
  );
});

/* DS-013: своя 404 по макету «Экраны → 404» (D-911). */
test('404: ноль ушёл за кофе, кнопка зовёт его обратно', async ({ page }) => {
  await page.goto('/takoy-stranitsy-net');
  await expect(page).toHaveTitle('Страницы нет · Qubite');
  await expect(page.getByRole('heading', { name: 'Такой страницы нет' })).toBeAttached();
  await expect(page.getByText('Ноль ушёл за кофе.')).toBeVisible();
  const call = page.getByRole('button', { name: 'Позвать ноль' });
  await call.click();
  await expect(page.getByText('Я отошёл на ноль минут!')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отпустить за кофе' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'На главную' }).click();
  await expect(page).toHaveURL(/\/$/);
});

/* DS-013: «Английский» — свой раздел (D-914); старые ссылки на вкладку Агента ведут туда. */
test('Английский — отдельный раздел, старая ссылка из Агента перенаправляет', async ({ page }) => {
  await mockAuth(page, { me: OWNER });
  await mockSync(page);
  await page.goto('/agent?tab=english&view=talk');
  await expect(page).toHaveURL(/\/english\?view=talk$/);
  await expect(page.getByRole('heading', { name: 'Английский' })).toBeAttached();
  await page.goto('/agent');
  await expect(page.getByRole('radio', { name: 'Английский' })).toHaveCount(0);
});
