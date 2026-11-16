import { expect, test, type Page } from '@playwright/test';
import { mockSync } from './sync-mock';

/* «Входящие» на настоящих данных (CMD-007): сервер подделан, браузер настоящий. */

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 900;

async function openCommand(page: Page) {
  if (isPhone(page)) await page.getByRole('button', { name: 'Открыть Command' }).click();
  else await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: 'Строка Command' });
  await expect(input).toBeFocused();
  return input;
}

test('мысли с сервера на экране; разобранная уходит в архив и в Docs', async ({ page }) => {
  const server = await mockSync(page);
  server.addElsewhere('Тема для проекта по физике?');
  await page.goto('/inbox');
  const row = page.locator('.item').filter({ hasText: 'Тема для проекта по физике?' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('из Telegram');
  await row.getByRole('button', { name: 'В Docs' }).click();
  await expect(row).toHaveCount(0);
  // на сервере — не удаление, а архив
  await expect.poll(() => server.ops.some((op) => op.kind === 'patch')).toBe(true);
  const patch = server.ops.find((op) => op.kind === 'patch')!;
  expect(patch.fields).toEqual({ status: 'archived' });
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Docs' })
    .click();
  await expect(page.getByRole('button', { name: /Тема для проекта по физике\?/ })).toBeVisible();
});

test('мысль без сети не теряется и уходит, когда сеть вернулась', async ({ page }) => {
  const server = await mockSync(page);
  server.offline = true;
  await page.goto('/today');
  const input = await openCommand(page);
  await input.fill('идея: бот для расписания');
  await input.press('Enter');
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Входящие' })
    .click();
  const row = page.locator('.item').filter({ hasText: 'бот для расписания' });
  await expect(row).toBeVisible();
  await page.reload(); // вкладку перезагрузили — мысль осталась в IndexedDB
  await expect(row).toBeVisible();
  await expect(row).toContainText('ждёт сети');
  expect(server.ops).toHaveLength(0);

  server.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(row).not.toContainText('ждёт сети');
  const create = server.ops.find((op) => op.kind === 'create')!;
  expect(create.object_type).toBe('inbox.item');
  // строка уходит как есть: сервер разберёт её тем же разбором, что и подсказка (CMD-003)
  expect(create.fields).toMatchObject({ body: 'идея: бот для расписания', source: 'web' });
});

test('сервер сказал «есть новое» — мысль из Telegram появляется сама', async ({ page }) => {
  const server = await mockSync(page);
  await page.goto('/inbox');
  await expect(page.getByText('Пусто — всё разобрано.')).toBeVisible();
  server.addElsewhere('Подарок маме — до 3 ноября');
  server.ping();
  await expect(page.locator('.item').filter({ hasText: 'Подарок маме' })).toBeVisible();
});

/* DS-013, шаг 1: любой текст человека переносится — длинная ссылка без пробелов
   не делает экран шире окна (раньше на телефоне появлялась прокрутка вбок). */
test('длинная ссылка без пробелов не раздвигает экран', async ({ page }) => {
  const server = await mockSync(page);
  const link =
    'https://example.com/ochen/dlinnaya/ssylka/bez-probelov/kotoraya-ne-pomeschaetsya-v-stroku-telefona?utm_source=qubite&utm_medium=test';
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const due = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  server.addElsewhere(link);
  server.addTask(`Прочитать ${link}`, { due_date: due, due_time: '18:30' });
  for (const path of ['/inbox', '/today', '/home']) {
    await page.goto(path);
    await expect(page.getByText(link, { exact: false }).first()).toBeVisible();
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over, `${path}: экран шире окна на ${over}px`).toBe(0);
  }
});
