import { expect, test, type Page } from '@playwright/test';

/* ПК — боковая панель и плавающая Command; телефон (360×780) — нижняя капля */
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 900;

async function go(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name }).click();
}

async function openCommand(page: Page) {
  if (isPhone(page)) await page.getByRole('button', { name: 'Открыть Command' }).click();
  else await page.keyboard.press('Control+k');
  const input = page.getByRole('textbox', { name: 'Строка Command' });
  await expect(input).toBeFocused();
  return input;
}

test('все пять разделов открываются, адрес и заголовок меняются', async ({ page }) => {
  await page.goto('/today');
  const sections: [string, RegExp][] = [
    ['Входящие', /\/inbox$/],
    ['Planner', /\/planner$/],
    ['Docs', /\/docs$/],
    ['Настройки', /\/settings$/],
    ['Сегодня', /\/today$/],
  ];
  for (const [name, url] of sections) {
    await go(page, name);
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('heading', { level: 1, name })).toBeAttached();
    await expect(page).toHaveTitle(`${name} · Qubite`);
  }
});

test('мысль из Command долетает во «Входящие»', async ({ page }) => {
  await page.goto('/today');
  const input = await openCommand(page);
  await input.fill('идея: бот для расписания');
  await expect(page.getByRole('status').filter({ hasText: 'Мысль' })).toContainText('Входящие');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await go(page, 'Входящие');
  await expect(page.getByText('бот для расписания', { exact: true })).toBeVisible();
});

test('«+» раскрывается в меню и подставляет команду', async ({ page }) => {
  await page.goto('/today');
  const input = await openCommand(page);
  await page.getByRole('button', { name: 'Создать' }).click();
  await page.getByRole('menuitem', { name: /Дело/ }).click();
  await expect(input).toHaveValue('/д ');
  await expect(page.getByRole('button', { name: 'Создать' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('дело отмечается кольцом — счётчик и Planner видят это', async ({ page }) => {
  await page.goto('/today');
  await expect(page.getByText('2 из 5')).toBeVisible();
  const ring = page.getByRole('checkbox', { name: 'Готово: Позвонить бабушке' });
  await ring.click();
  await expect(ring).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('3 из 5')).toBeVisible();
  await go(page, 'Planner');
  await expect(page.getByRole('checkbox', { name: 'Готово: Позвонить бабушке' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('разобранная мысль улетает из «Входящих» в Docs', async ({ page }) => {
  await page.goto('/inbox');
  const item = page.getByText('Тема для проекта по физике?');
  await expect(item).toBeVisible();
  await page
    .locator('.item')
    .filter({ hasText: 'Тема для проекта по физике?' })
    .getByRole('button', { name: 'В Docs' })
    .click();
  await expect(item).toHaveCount(0);
  await go(page, 'Docs');
  await expect(page.getByRole('button', { name: /Тема для проекта по физике\?/ })).toBeVisible();
});

test('строка Docs раскрывается в страницу и закрывается обратно', async ({ page }) => {
  await page.goto('/docs');
  await page.getByRole('button', { name: /Дерево Фенвика/ }).click();
  const doc = page.getByRole('article', { name: 'Документ' });
  await expect(doc.getByRole('heading', { name: 'Дерево Фенвика' })).toBeVisible();
  await doc.getByRole('button', { name: 'Docs' }).click();
  await expect(doc).toBeHidden();
});

test('настройки: тема и форма точки меняются и запоминаются', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'Светлая' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('slider', { name: 'Форма точки' }).fill('0');
  await expect(page.locator('html')).toHaveCSS('--q-round', '0');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('slider', { name: 'Форма точки' })).toHaveValue('0');
});

test('помощника можно спрятать из шапки', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('img', { name: 'Фоти' })).toBeAttached();
  await page.getByRole('switch', { name: 'Фоти' }).click();
  await expect(page.getByRole('img', { name: 'Помощник спрятан' })).toBeAttached();
});

test('на странице нет горизонтальной прокрутки', async ({ page }) => {
  for (const path of ['/', '/today', '/inbox', '/planner', '/docs', '/settings']) {
    await page.goto(path);
    await page.waitForTimeout(300);
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(wide, path).toBeLessThanOrEqual(0);
  }
});
