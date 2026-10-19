import { expect, test, type Page } from '@playwright/test';
import { mockSync } from './sync-mock';

// Qubite Command (CMD-002): поиск и навигация из строки — на ПК по Ctrl+K, на телефоне из капли.
test.beforeEach(async ({ page }) => {
  await mockSync(page);
});

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 900;

async function openCommand(page: Page) {
  if (isPhone(page)) await page.getByRole('button', { name: 'Открыть Command' }).click();
  else await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: 'Строка Command' });
  await expect(input).toBeFocused();
  return input;
}

const list = (page: Page) => page.getByRole('listbox', { name: 'Что сделать' });

test('одно слово — раздел: «настройки» + Enter открывает Настройки', async ({ page }) => {
  await page.goto('/today');
  const input = await openCommand(page);
  await input.fill('настройки');
  await expect(list(page).getByRole('option', { selected: true })).toContainText('Настройки');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/settings$/);
});

test('Ctrl+K открывает строку и в русской раскладке (приходит «л»)', async ({ page }) => {
  test.skip(isPhone(page), 'Ctrl+K — на ПК');
  await page.goto('/today');
  // как Chrome и Firefox в русской раскладке: буква «л», физическая клавиша — KeyK
  await page.evaluate(() =>
    dispatchEvent(
      new KeyboardEvent('keydown', { key: 'л', code: 'KeyK', ctrlKey: true, bubbles: true }),
    ),
  );
  await expect(page.getByRole('combobox', { name: 'Строка Command' })).toBeFocused();
});

test('забыл раскладку: «gkfyth» находит Planner', async ({ page }) => {
  await page.goto('/today');
  const input = await openCommand(page);
  await input.fill('gkfyth');
  await expect(list(page).getByRole('option', { name: /Planner/ })).toBeVisible();
});

test('дело: стрелкой вниз к найденному — открывается «Сегодня», дело обведено', async ({
  page,
}) => {
  await page.goto('/docs');
  const input = await openCommand(page);
  await input.fill('позвонить бабушке');
  // по умолчанию — записать новое дело, найденное ниже
  await expect(list(page).getByRole('option', { selected: true })).toContainText('Дело');
  await input.press('ArrowDown');
  await expect(list(page).getByRole('option', { selected: true })).toContainText(
    'Позвонить бабушке',
  );
  await expect(input).toHaveAttribute('aria-activedescendant', /q-command-list-1/);
  await input.press('Enter');
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator('[data-obj="t3"][data-found]')).toBeAttached();
});

test('«найди фенвик» — документ сразу раскрывается', async ({ page }) => {
  await page.goto('/today');
  const input = await openCommand(page);
  await input.fill('найди фенвик');
  await expect(list(page).getByRole('option', { selected: true })).toContainText('Дерево Фенвика');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/docs$/);
  const doc = page.getByRole('article', { name: 'Документ' });
  await expect(doc.getByRole('heading', { name: 'Дерево Фенвика' })).toBeVisible();
});

test('найденное можно выбрать пальцем или мышью: светлая тема', async ({ page }) => {
  await page.goto('/today');
  const input = await openCommand(page);
  await input.fill('светлая');
  await list(page)
    .getByRole('option', { name: /Светлая тема/ })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('недавнее: пустая строка показывает прошлый поиск, выбор подставляет его', async ({
  page,
}) => {
  await page.goto('/today');
  let input = await openCommand(page);
  await input.fill('найди алгебра');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/today$/);
  await page.reload(); // недавнее живёт на устройстве и переживает перезагрузку
  input = await openCommand(page);
  const recent = list(page).getByRole('option', { name: /найди алгебра/ });
  await expect(recent).toBeVisible();
  await recent.click();
  await expect(input).toHaveValue('найди алгебра');
  await expect(input).toBeFocused();
});

test('ничего не нашлось — можно сохранить как мысль', async ({ page }) => {
  await page.goto('/today');
  const input = await openCommand(page);
  await input.fill('найди квазары');
  await expect(list(page).getByRole('option', { selected: true })).toContainText('не нашлось');
  await input.press('Enter');
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Входящие' })
    .click();
  // на экране, а не в спрятанной карточке под строкой («Недавнее»)
  await expect(page.locator('.screen').getByText('квазары', { exact: true })).toBeVisible();
});

test('Escape закрывает строку, подсказки исчезают', async ({ page }) => {
  await page.goto('/today');
  const input = await openCommand(page);
  await input.fill('настр');
  await expect(list(page).getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Escape');
  if (!isPhone(page)) await expect(input).not.toBeFocused();
  await expect(list(page).getByRole('option')).toHaveCount(0);
});
