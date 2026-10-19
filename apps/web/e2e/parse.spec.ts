import { expect, test, type Page } from '@playwright/test';
import { mockSync } from './sync-mock';

// Разбор без AI (CMD-003): карточка «куда ляжет» и черновик во «Входящих» — без сети и AI.
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

const card = (page: Page) => page.getByRole('status').filter({ hasText: '→' });

async function toInbox(page: Page) {
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Входящие' })
    .click();
  await expect(page).toHaveURL(/\/inbox$/);
}

test('дело со сроком, проектом и важностью: карточка понимает, дело — в Planner', async ({
  page,
}) => {
  await page.goto('/today');
  const input = await openCommand(page);
  await input.fill('завтра в 18 повторить графы #алгебра !!');
  await expect(card(page)).toContainText('Дело');
  await expect(card(page)).toContainText('Planner — дело');
  await expect(card(page)).toContainText('завтра, 18:00 · #алгебра · !!');
  await input.press('Enter');
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Planner' })
    .click();
  await expect(page.locator('.proj').filter({ hasText: 'Алгебра' })).toBeVisible();
  await page.getByRole('radio', { name: 'Доска' }).click();
  await expect(page.locator('.col').filter({ hasText: 'Надо' })).toContainText('повторить графы');
});

test('повторение и длительность', async ({ page }) => {
  await page.goto('/today');
  const input = await openCommand(page);
  await input.fill('каждый вторник в 17:00 кружок на 2 часа');
  await expect(card(page)).toContainText('каждый вт, 17:00 · 2 ч');
});

test('не уверен — «посмотри сам» в карточке и во «Входящих»', async ({ page }) => {
  await page.goto('/today');
  const input = await openCommand(page);
  await input.fill('напомни про графы');
  await expect(card(page)).toContainText('Напоминание');
  await expect(card(page)).toContainText('посмотри сам: Когда напомнить? Срок не нашёл');
  await input.press('Enter');
  await toInbox(page);
  await expect(page.getByText('посмотри сам: Когда напомнить? Срок не нашёл')).toBeVisible();
});

test('ссылка — закладка, команда словом — заметка', async ({ page }) => {
  await page.goto('/today');
  const input = await openCommand(page);
  await input.fill('https://habr.com/ru/articles/123');
  await expect(card(page)).toContainText('Закладка');
  await input.fill('заметка: дерево отрезков хранит суммы');
  await expect(card(page)).toContainText('Заметка');
  await expect(card(page)).toContainText('черновик заметки');
});

test('сервер получает пояс устройства вместе с мыслью', async ({ page }) => {
  await page.goto('/today');
  const pushed = page.waitForRequest(
    (r) => r.url().includes('/api/v1/sync/push') && r.method() === 'POST',
  );
  const input = await openCommand(page);
  await input.fill('идея: бот, который напоминает про дз');
  await input.press('Enter');
  const body = (await pushed).postDataJSON() as { ops: { fields?: { tz?: string } }[] };
  expect(body.ops[0]?.fields?.tz).toBeTruthy();
});
