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

test('агент спросил «есть 30 минут?» — ответ кнопкой в колокольчике', async ({ page }) => {
  const server = await mockSync(page);
  server.notices.push({
    id: 'n-ask',
    kind: 'agent',
    origin: 'agent',
    title: 'Есть 30 минут?',
    body: 'Завтра алгебра — начнём ДЗ?',
    why: 'урок завтра',
    held: false,
    channel: null,
    options: [
      { id: 'yes', text: 'Да' },
      { id: 'short', text: '15 минут' },
      { id: 'later', text: 'Позже' },
      { id: 'not_today', text: 'Не сегодня' },
    ],
    answer: null,
    created_at: new Date().toISOString(),
    read_at: null,
  });
  await page.goto('/today');
  await page.getByRole('button', { name: 'Уведомления: 1 новых' }).click();
  const panel = page.getByRole('dialog', { name: 'Уведомления' });
  const answers = panel.getByRole('group', { name: 'Ответить' });
  await expect(answers.getByRole('button')).toHaveText(['Да', '15 минут', 'Позже', 'Не сегодня']);
  await answers.getByRole('button', { name: 'Позже' }).click();
  await expect(answers.getByRole('button', { name: 'Позже' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(answers.getByRole('button', { name: 'Да' })).toBeDisabled();
  expect(server.notices[0]!.answer).toBe('later');
  expect(server.notices[0]!.read_at).toBeTruthy();
});

test('колокольчик из точек: на ПК — в левой панели, список не закрывает шапку с помощником (D-421)', async ({
  page,
}) => {
  const wide = (page.viewportSize()?.width ?? 0) >= 900;
  const server = await mockSync(page);
  server.notices.push({
    id: 'n1',
    kind: 'reminder',
    origin: 'owner',
    title: 'Сходить в музей',
    body: 'в 18:00',
    why: '',
    held: false,
    channel: null,
    created_at: new Date().toISOString(),
    read_at: null,
  });
  await page.goto('/home');
  const bell = page.getByRole('button', { name: 'Уведомления: 1 новых' });
  await expect(bell.locator('circle').first()).toBeAttached();
  if (wide)
    await expect(
      page.locator('.side-foot').getByRole('button', { name: /Уведомления/ }),
    ).toBeVisible();
  await bell.click();
  const panel = page.getByRole('dialog', { name: 'Уведомления' });
  await expect(panel).toContainText('Сходить в музей');
  // список ниже шапки: заголовок раздела и помощник остаются видны
  const head = await page.locator('.head').boundingBox();
  await expect
    .poll(async () => (await panel.boundingBox())!.y)
    .toBeGreaterThanOrEqual(head!.y + head!.height - 1);
});
