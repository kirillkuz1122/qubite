import { expect, test, type Page } from '@playwright/test';
import { mockAuth, OWNER, USER } from './auth-mock';
import { mockAi } from './ai-mock';
import { mockConsole } from './console-mock';

/* Owner Console (ACC-003): сервер подделан теми же ответами, браузер настоящий. */

/** Owner в Console; `confirmed` — пароль уже подтверждён в этой сессии (D-285). */
async function owner(page: Page, { confirmed = true } = {}) {
  const auth = await mockAuth(page, { me: OWNER });
  const console = await mockConsole(page, auth);
  console.confirmed = confirmed;
  await mockAi(page, auth, console);
  return { auth, console };
}

const tab = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Разделы Console' }).getByRole('radio', { name });

test.describe('Выкладка сервера', () => {
  test.use({ timezoneId: 'Asia/Yekaterinburg' });

  test('видны версия, время выкладки и причина отката', async ({ page }) => {
    const { console } = await owner(page);
    await page.goto('/console/server');
    const version = page.getByRole('region', { name: 'Версия', exact: true });
    await expect(version).toContainText('0.1.0 · 0123456789ab');
    await expect(version).toContainText('29.10 в 10:00');
    await expect(version).toContainText('29.10 в 11:00');
    await expect(version.getByRole('alert')).toHaveCount(0);

    console.deploy.rollback = {
      from: 'fedcba987654',
      to: '0123456789ab',
      at: '2026-10-29T06:00:00Z',
      reason: 'миграции упали',
    };
    await page.reload();
    await expect(version.getByRole('alert')).toHaveText(
      'Откат с fedcba987654 на 0123456789ab · 29.10 в 11:00 · миграции упали',
    );
  });
});

test('Настройки: публичная версия и откат помещаются на 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const auth = await mockAuth(page);
  const commit = '0123456789ab'.repeat(6);
  auth.health.deploy.commit = commit;
  auth.health.deploy.rollback = {
    from: 'fedcba987654'.repeat(6),
    to: commit,
    at: '2026-10-29T06:00:00Z',
    reason: 'миграции упали',
  };
  await page.goto('/settings');
  const row = page.locator('[data-obj="set-version"]');
  await row.scrollIntoViewIfNeeded();
  await expect(row).toContainText(`Версия 0.1.0 · ${commit}`);
  await expect(row).toContainText('обновлено');
  await expect(row).toContainText('собрано');
  const rollback = page.getByRole('alert').filter({ hasText: 'Откат с' });
  await expect(rollback).toContainText('миграции упали');
  for (const text of [row.locator('.lbl'), rollback.locator('div')]) {
    expect(await text.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const box = await text.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
});

test('Настройки: неизвестные данные и недоступный сервер', async ({ page }) => {
  const auth = await mockAuth(page);
  auth.health.deploy = { commit: null, built_at: null, deployed_at: null, rollback: null };
  await page.goto('/settings');
  const row = page.locator('[data-obj="set-version"]');
  await expect(row).toHaveText('Версия 0.1.0');
  await expect(row.locator('small')).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Откат с' })).toHaveCount(0);

  await page.route('**/api/health', (route) => route.fulfill({ status: 503, body: 'down' }));
  await page.reload();
  await expect(row).toHaveText('Версия недоступна');
});

test('Console есть только у owner: гостю — вход, остальным — «Такой страницы нет»', async ({
  page,
}) => {
  const auth = await mockAuth(page);
  await mockConsole(page, auth);
  await page.goto('/console/people');
  await expect(page).toHaveURL(/\/auth\?return_to=%2Fconsole%2Fpeople$/);
  auth.me = USER;
  await page.goto('/console');
  await expect(page.getByRole('heading', { name: 'Такой страницы нет' })).toBeVisible();
  // и в «Настройках» строки «Управление Qubite» у него нет
  await page.goto('/settings');
  await expect(page.getByText('Управление Qubite')).toHaveCount(0);
});

test('платформа: черновик → список изменений → одно сохранение; черновик переживает перезагрузку', async ({
  page,
}) => {
  const { auth, console } = await owner(page);
  await page.goto('/settings');
  await page.getByRole('link', { name: /Управление Qubite/ }).click();
  await expect(page).toHaveURL(/\/console\/platform$/);
  await expect(page.getByRole('heading', { name: 'Платформа' })).toBeAttached();

  await page.getByRole('switch', { name: 'Вход через VK ID' }).click();
  await page.getByRole('radio', { name: 'Открыта' }).click();
  // ничего не ушло на сервер, пока не нажали «Сохранить»
  expect(auth.calls.some((c) => c.method === 'PATCH')).toBe(false);
  const bar = page.getByRole('region', { name: 'Несохранённые изменения' });
  await expect(bar.getByRole('button', { name: 'Изменено: 2' })).toBeVisible();

  await page.reload();
  await expect(page.getByText('Восстановлен несохранённый черновик')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Вход через VK ID' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await bar.getByRole('button', { name: 'Изменено: 2' }).click();
  const diff = page.getByRole('list', { name: 'Список изменений' });
  await expect(diff).toContainText('Регистрация: по приглашениям → открыта');
  await expect(diff).toContainText('Вход через VK ID: включён → выключен');
  await bar.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Сохранено: 2')).toBeVisible();
  await expect(bar).toHaveCount(0);
  const patch = auth.calls.filter((c) => c.method === 'PATCH' && c.path === '/api/owner/platform');
  expect(patch).toHaveLength(1);
  expect(patch[0]!.body).toEqual({
    changes: [
      { key: 'registration.mode', value: 'open', version: 1 },
      { key: 'login.methods.vk', value: false, version: 1 },
    ],
  });
  expect(console.items.get('login.methods.vk')?.value).toBe(false);
  // экран входа уже без VK
  await page.goto('/auth');
  await expect(page.getByRole('link', { name: 'Войти через VK ID' })).toHaveCount(0);
});

test('режим подтверждения: тумблер просит пароль один раз, отмена ничего не меняет (Q-42)', async ({
  page,
}) => {
  const { auth, console } = await owner(page, { confirmed: false });
  await page.goto('/console/platform');
  await page.getByRole('switch', { name: 'Вход через VK ID' }).click();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  const dialog = page.getByRole('dialog', { name: 'Подтвердите паролем' });
  await expect(dialog).toContainText('Следующие 10 минут');
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(dialog).toHaveCount(0);
  expect(console.items.get('login.methods.vk')?.value).toBe(true);

  await page.getByRole('button', { name: 'Сохранить' }).click();
  await dialog.getByLabel('Пароль').fill(auth.password);
  await dialog.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByText('Сохранено: 1')).toBeVisible();
  expect(console.items.get('login.methods.vk')?.value).toBe(false);

  // дальше — без пароля: модуль меняется сразу
  await tab(page, 'Модули').click();
  await page.getByRole('switch').first().click();
  await expect
    .poll(() => auth.calls.filter((c) => c.path.startsWith('/api/owner/modules/')).length)
    .toBe(1);
  await expect(dialog).toHaveCount(0);
});

test('платформа: другая вкладка изменила то же — три значения, owner выбирает', async ({
  page,
}) => {
  const { auth, console } = await owner(page);
  await page.goto('/console/platform');
  await page.getByRole('radio', { name: 'Открыта' }).click();
  console.changeElsewhere('registration.mode', 'closed');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  const conflict = page.getByRole('group', { name: 'Регистрация' });
  await expect(conflict).toContainText('Было, когда вы началипо приглашениям');
  await expect(conflict).toContainText('Сейчас на серверезакрыта');
  await expect(conflict).toContainText('Вашеоткрыта');
  await conflict.getByRole('button', { name: 'Оставить моё' }).click();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Сохранено: 1')).toBeVisible();
  const last = auth.calls.filter((c) => c.method === 'PATCH').at(-1)!;
  expect(last.body).toEqual({ changes: [{ key: 'registration.mode', value: 'open', version: 2 }] });
});

test('люди: создать вручную с паролем, выдать Docs, заблокировать — всё в журнале', async ({
  page,
}) => {
  const { auth, console } = await owner(page, { confirmed: false });
  await page.goto('/console/people');
  const form = page.getByRole('form', { name: 'Создать человека' });
  await form.getByLabel('Почта').fill('new@example.com');
  await form.getByLabel('Имя').fill('Новичок');
  await form.getByLabel('Пароль').fill('пароль новичка длинный');
  await form.getByRole('button', { name: 'Создать' }).click();

  // опасное действие — пароль; неверный не подходит
  const dialog = page.getByRole('dialog', { name: 'Подтвердите паролем' });
  await dialog.getByLabel('Пароль').fill('не-тот');
  await dialog.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(dialog.getByText('Неверная почта или пароль')).toBeVisible();
  await dialog.getByLabel('Пароль').fill(auth.password);
  await dialog.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByText('Создан new@example.com')).toBeVisible();

  const people = page.getByRole('list', { name: 'Люди' });
  await people.getByRole('button', { name: /Новичок/ }).click();
  const card = page.getByRole('group', { name: 'Карточка: new@example.com' });
  await card
    .getByRole('radiogroup', { name: 'Доступ к Docs' })
    .getByRole('radio', { name: 'Читать' })
    .click();
  await expect.poll(() => console.grants.get(console.accounts[0]!.id as string)?.length).toBe(1);
  await expect(card.getByRole('switch', { name: 'AI в Docs' })).toBeVisible();

  // пароль уже подтверждён — второй раз не спрашиваем
  await card.getByRole('button', { name: 'Заблокировать' }).click();
  await expect(card.getByText('Заблокирован: все его сессии закрыты')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(people.getByRole('button', { name: /Новичок/ })).toContainText('заблокирован');

  // поиск и фильтр
  await page.getByRole('radio', { name: 'Заблокированы' }).click();
  await expect(people.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('radio', { name: 'Все' }).click();
  await page.getByLabel('Поиск').fill('друг');
  await expect(people.getByRole('listitem')).toHaveCount(1);
  await expect(people).toContainText(USER.email);

  // журнал
  await tab(page, 'Журнал').click();
  await expect(page).toHaveURL(/\/console\/log$/);
  const log = page.getByRole('list', { name: 'Журнал' });
  await expect(log).toContainText('заблокирован');
  await expect(log).toContainText('выдан доступ');
  await page
    .getByRole('radiogroup', { name: 'Что показать' })
    .getByRole('radio', { name: 'Люди' })
    .click();
  await expect(log).not.toContainText('выдан доступ');
  await expect(log).toContainText('создан аккаунт');
});

test('модули, AI и сервер; на телефоне нет горизонтальной прокрутки', async ({ page }) => {
  const { auth } = await owner(page);
  await page.goto('/console/modules');
  const docs = page.getByRole('group', { name: 'Docs' });
  await docs.getByRole('radio', { name: 'Техработы' }).click();
  await expect(docs.getByRole('radio', { name: 'Техработы' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const call = auth.calls.find((c) => c.method === 'PATCH' && c.path === '/api/owner/modules/docs');
  expect(call?.body).toEqual({ state: 'maintenance', expected_version: 1 });

  await tab(page, 'AI').click();
  await expect(page.getByRole('heading', { name: 'Мне без лимита' })).toBeVisible();
  await page.getByRole('radio', { name: 'Модели и ключи' }).click();
  await expect(
    page.getByRole('switch', { name: 'Модель google/gemini-2.5-flash-lite' }),
  ).toBeVisible();
  await expect(page.getByText('qubite ai limit')).toHaveCount(0);

  await tab(page, 'Сервер').click();
  await expect(page.getByText('миграция 22')).toBeVisible();
  await expect(page.getByText('2 ч 5 мин')).toBeVisible();

  await tab(page, 'Агенты').click();
  const question = page.getByRole('form', { name: 'Куда класть бэкапы?' });
  await expect(question.getByText('На Pi мало места.')).toBeVisible();
  await question.getByRole('button', { name: 'Облако' }).click();
  await expect(page.getByText('Вопросов нет — агенты справляются сами.')).toBeVisible();
  const answer = auth.calls.find((c) => c.path === '/api/owner/work/questions/81/answer');
  expect(answer?.body).toEqual({ answer: 'Облако' });
  await expect(page.getByRole('link', { name: 'PR #99 →' })).toBeVisible();

  for (const t of ['platform', 'people', 'modules', 'ai', 'log', 'server', 'work']) {
    await page.goto(`/console/${t}`);
    await page.waitForTimeout(200);
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(wide, t).toBeLessThanOrEqual(0);
  }
});
