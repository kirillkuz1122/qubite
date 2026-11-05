import { expect, test, type Page } from '@playwright/test';
import { mockSync } from './sync-mock';
import { fakeMicrophone, mockVoice } from './voice-mock';

/* Голосовой ввод (CMD-005b): микрофон и сервер подделаны, браузер настоящий. */

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 900;
const bar = (page: Page) => page.getByRole('region', { name: 'Голосовая запись' });

/** Нажать микрофон во «Входящих», «поговорить» и остановить. */
async function say(page: Page, ms = 1200) {
  await bar(page).getByRole('button', { name: 'Записать голосом' }).click();
  const stop = bar(page).getByRole('button', { name: 'Остановить и отправить' });
  await expect(stop).toBeVisible();
  await expect(bar(page)).toContainText('/ 2:00');
  await page.waitForTimeout(ms);
  await stop.click();
}

test('запись голосом: текст сервера появляется во «Входящих», звук можно послушать', async ({
  page,
}) => {
  await fakeMicrophone(page);
  const sync = await mockSync(page);
  const voice = await mockVoice(page, sync);
  await page.goto('/inbox');
  await say(page);
  const row = page.locator('.item').filter({ hasText: 'Позвонить бабушке в субботу' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('голосом');
  expect(voice.calls).toHaveLength(1);
  const sent = voice.calls[0]!;
  expect(sent).toMatchObject({ source: 'web', mime: 'audio/webm;codecs=opus' });
  expect(sent.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  expect(sent.duration_ms as number).toBeGreaterThanOrEqual(1000);
  expect(sent).not.toHaveProperty('text');
  // распознанная запись: плеер — по «Послушать»
  await row.getByRole('button', { name: 'Послушать' }).click();
  const player = row.getByRole('group', { name: /^Запись:/ });
  await expect(player).toBeVisible();
  await expect(player).toContainText('0:03');
  await expect(bar(page).getByRole('button', { name: 'Записать голосом' })).toBeEnabled();
});

test('без сети запись ждёт на устройстве и уходит потом с тем же ID', async ({ page }) => {
  await fakeMicrophone(page);
  const sync = await mockSync(page);
  const voice = await mockVoice(page, sync);
  sync.offline = true;
  await page.goto('/inbox');
  await say(page);
  const row = page.locator('.item').filter({ hasText: 'Голосовая запись' });
  await expect(row).toContainText('отправится, когда появится сеть');
  await page.reload(); // вкладку перезагрузили — запись осталась в IndexedDB
  await expect(row).toContainText('отправится, когда появится сеть');
  expect(voice.calls).toHaveLength(0);

  sync.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.item').filter({ hasText: 'Позвонить бабушке' })).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(voice.calls).toHaveLength(1);
  expect(new Set(voice.tried)).toEqual(new Set([voice.calls[0]!.id]));
});

test('без текста — плеер сразу и причина простыми словами', async ({ page }) => {
  await fakeMicrophone(page);
  const sync = await mockSync(page);
  const voice = await mockVoice(page, sync);
  voice.heard = null;
  await page.goto('/inbox');
  await say(page);
  const row = page.locator('.item').filter({ hasText: 'Голосовая запись' });
  await expect(row).toContainText('распознавание голоса не подключено — послушай запись');
  await expect(row.getByRole('group', { name: /^Голосовая запись/ })).toBeVisible();
  await row.getByRole('button', { name: 'В архив' }).click();
  await expect(row).toHaveCount(0);
  await expect.poll(() => sync.ops.some((op) => op.kind === 'patch')).toBe(true);
});

test('нет доступа к микрофону — объясняет, что сделать', async ({ page }) => {
  await fakeMicrophone(page, true);
  const sync = await mockSync(page);
  const voice = await mockVoice(page, sync);
  await page.goto('/inbox');
  await bar(page).getByRole('button', { name: 'Записать голосом' }).click();
  await expect(bar(page).getByRole('alert')).toContainText('Нет доступа к микрофону');
  expect(voice.tried).toHaveLength(0);
});

test('микрофон в строке Command: запись уходит во «Входящие»', async ({ page }) => {
  await fakeMicrophone(page);
  const sync = await mockSync(page);
  const voice = await mockVoice(page, sync);
  await page.goto('/today');
  if (isPhone(page)) await page.getByRole('button', { name: 'Открыть Command' }).click();
  else await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox', { name: 'Строка Command' })).toBeFocused();
  await page.getByRole('button', { name: 'Записать голосом' }).click();
  await expect(page.getByRole('button', { name: 'Отменить' })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Остановить и отправить' }).click();
  await expect.poll(() => voice.calls.length).toBe(1);
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('button', { name: 'Входящие' })
    .click();
  await expect(page.locator('.item').filter({ hasText: 'Позвонить бабушке' })).toBeVisible();
});
