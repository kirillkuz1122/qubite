import { expect, test } from '@playwright/test';
import { mockAuth, OWNER } from './auth-mock';
import { mockSync } from './sync-mock';

/* Напоминания и каналы (PLAN-004): колокольчик в шапке и «Напоминания» в профиле. */

const pad = (n: number) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

test('колокольчик: напоминание о деле, прочитать, вкладка отмечается видимой', async ({ page }) => {
  const server = await mockSync(page);
  const museum = server.addTask('Сходить в музей', {
    due_date: today(),
    due_time: '18:00',
    remind_at: `${today()}T17:00`,
    remind_why: 'сходить куда-то — за час, с запасом на дорогу',
    remind_by: 'auto',
  });
  server.notices.push(
    {
      id: 'n1',
      kind: 'reminder',
      origin: 'owner',
      title: 'Сходить в музей',
      body: 'в 18:00',
      why: 'сходить куда-то — за час, с запасом на дорогу',
      object_id: museum,
      held: false,
      channel: null,
      created_at: new Date().toISOString(),
      read_at: null,
    },
    {
      id: 'n2',
      kind: 'agent',
      origin: 'agent',
      title: 'Есть 30 минут?',
      body: '',
      why: '',
      held: true,
      channel: null,
      created_at: new Date().toISOString(),
      read_at: new Date().toISOString(),
    },
  );
  await page.goto('/today');

  // У дела видно, когда напомнит сервер.
  await expect(page.locator('.row').filter({ hasText: 'Сходить в музей' })).toContainText(
    'напомню в 17:00',
  );

  const bell = page.getByRole('button', { name: 'Уведомления: 1 новых' });
  await expect(bell).toBeVisible();
  await bell.click();
  const panel = page.getByRole('dialog', { name: 'Уведомления' });
  await expect(panel).toContainText('в 18:00 · сходить куда-то — за час, с запасом на дорогу');
  await expect(panel).toContainText('пришло в тишину');
  await panel.getByRole('button', { name: /Сходить в музей/ }).click();
  await expect(page.getByRole('button', { name: 'Уведомления', exact: true })).toBeVisible();
  expect(server.notices[0]!.read_at).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  expect(server.presence).toContain(true);
});

test('открыли из push: сообщение прочитано, адрес чистый', async ({ page }) => {
  const server = await mockSync(page);
  server.notices.push({
    id: 'n-push',
    kind: 'reminder',
    origin: 'owner',
    title: 'Контрольная',
    body: 'в 10:00',
    why: 'за 15 мин до срока',
    held: false,
    channel: 'push',
    created_at: new Date().toISOString(),
    read_at: null,
  });
  await page.goto('/today?notice=n-push');
  await expect(page).toHaveURL(/\/today$/);
  await expect.poll(() => server.notices[0]!.read_at).toBeTruthy();
});

test('профиль: каналы, тишина, «само» и пробное сообщение', async ({ page }) => {
  const server = await mockAuth(page, { me: OWNER });
  await page.goto('/account');
  const section = page.locator('.acc-sec').filter({ hasText: 'Напоминания' });
  await expect(section).toContainText('Push ещё не настроен на сервере');
  await expect(section).toContainText('Привязан: напоминания придут в чат с ботом');

  await section.getByRole('radio', { name: 'Telegram' }).click();
  await expect
    .poll(() => server.calls.find((c) => c.method === 'PATCH')?.body)
    .toEqual({ first_channel: 'telegram' });

  await section.getByLabel('Тишина с').fill('22:30');
  await expect.poll(() => server.notify.quiet_from).toBe('22:30');

  const minutes = section.getByLabel('За сколько минут до выхода');
  await minutes.fill('90');
  await minutes.press('Enter');
  await expect.poll(() => server.notify.travel_minutes).toBe(90);

  await section.getByRole('button', { name: 'Прислать пробное' }).click();
  await expect(page.getByText('Пробное отправлено')).toBeVisible();
});
