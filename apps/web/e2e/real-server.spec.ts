import { expect, test } from '@playwright/test';

/*
 * Сквозная проверка на НАСТОЯЩЕМ сервере Qubite (не на подделке). Обычный `just e2e`
 * её пропускает: нужен запущенный `qubite serve`, сайт с прокси на него и owner.
 *
 *   QUBITE_E2E_REAL=http://localhost:4180 QUBITE_E2E_EMAIL=… QUBITE_E2E_PASSWORD=… \
 *     pnpm exec playwright test real-server --project=firefox
 *
 * Как поднять всё локально — docs/engineering/DEVELOPMENT.md («Проверка на настоящем сервере»).
 */
const BASE = process.env.QUBITE_E2E_REAL;
const EMAIL = process.env.QUBITE_E2E_EMAIL ?? '';
const PASSWORD = process.env.QUBITE_E2E_PASSWORD ?? '';

test.skip(!BASE, 'нужен настоящий сервер: QUBITE_E2E_REAL');
test.use({ baseURL: BASE ?? 'http://localhost' });

test('настоящий сервер: вход, сессия на «Аккаунте», выход', async ({ page }) => {
  await page.goto('/auth');
  await page.getByLabel('Почта').fill(EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill('точно-не-тот-пароль');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();

  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.goto('/account');
  await expect(page.getByText(EMAIL).first()).toBeVisible();
  await expect(page.getByText('это устройство')).toBeVisible();
  await page.getByRole('button', { name: 'Выйти здесь' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/auth\?return_to=/);
});

/** Войти owner в этом браузере (через экран входа). */
async function ownerLogin(page: import('@playwright/test').Page) {
  await page.goto('/auth');
  await page.getByLabel('Почта').fill(EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
}

/** Поменять тумблеры через API owner (как будет делать Owner Console). */
async function toggle(page: import('@playwright/test').Page, values: Record<string, unknown>) {
  const items = (await (await page.request.get('/api/owner/platform')).json()) as {
    key: string;
    version: number;
  }[];
  const csrf = (await page.context().cookies()).find((c) => c.name === 'qubite_csrf')?.value;
  const changes = Object.entries(values).map(([key, value]) => ({
    key,
    value,
    version: items.find((i) => i.key === key)!.version,
  }));
  const r = await page.request.patch('/api/owner/platform', {
    data: { changes },
    headers: { 'X-CSRF-Token': csrf ?? '' },
  });
  expect(r.ok()).toBe(true);
}

test('настоящий сервер: техработы и тумблеры видны в интерфейсе (ACC-004)', async ({ browser }) => {
  const owner = await (await browser.newContext({ baseURL: BASE! })).newPage();
  const guest = await (await browser.newContext({ baseURL: BASE! })).newPage();
  await ownerLogin(owner);

  try {
    // техработы: owner включает в Owner Console → гость видит экран, owner работает
    await owner.goto('/console/platform');
    await owner.locator('#maintenance').getByRole('button', { name: 'Включить техработы' }).click();
    await expect(owner.getByText('Техработы включены')).toBeVisible();
    await guest.goto('/today');
    await expect(guest.getByText('Qubite ненадолго закрылся')).toBeVisible();
    await owner.goto('/today');
    await expect(owner.getByRole('status').filter({ hasText: 'Идут техработы' })).toBeVisible();
    await owner.goto('/console/platform');
    await owner
      .locator('#maintenance')
      .getByRole('button', { name: 'Выключить техработы' })
      .click();
    await expect(owner.getByText('Qubite снова открыт')).toBeVisible();
    await guest.getByRole('button', { name: 'Проверить ещё раз' }).click();
    await expect(guest.getByText('Qubite ненадолго закрылся')).toHaveCount(0);

    // способы входа: VK выключен — кнопки нет; Яндекс включён — есть
    await toggle(owner, { 'login.methods.vk': false, 'login.methods.yandex': true });
    await guest.goto('/auth');
    await expect(guest.getByRole('link', { name: 'Войти через Яндекс ID' })).toBeVisible();
    await expect(guest.getByRole('link', { name: 'Войти через VK ID' })).toHaveCount(0);

    // вход выключен целиком
    await toggle(owner, { 'login.enabled': false });
    await guest.reload();
    await expect(guest.getByText('Вход сейчас выключен')).toBeVisible();

    // регистрация: закрыта / по приглашениям
    await toggle(owner, { 'registration.mode': 'closed' });
    await guest.goto('/register');
    await expect(guest.getByText('Регистрация сейчас закрыта')).toBeVisible();
    await toggle(owner, { 'registration.mode': 'invite_only' });
    await guest.reload();
    await expect(guest.getByLabel('Код приглашения')).toBeVisible();
  } finally {
    await toggle(owner, {
      'login.enabled': true,
      'login.methods.vk': true,
      'registration.mode': 'invite_only',
    });
  }
});

test('настоящий сервер: Owner Console — создать человека, выдать Docs, он видит только Docs, отозвать (ACC-003)', async ({
  browser,
}) => {
  const owner = await (await browser.newContext({ baseURL: BASE! })).newPage();
  const person = await (await browser.newContext({ baseURL: BASE! })).newPage();
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'пароль проверки длинный';
  await ownerLogin(owner);

  // Модули: Docs установлен (на свежей базе модули не установлены)
  await owner.goto('/console/modules');
  const docsModule = owner.getByRole('group', { name: 'Docs' });
  const installed = docsModule.getByRole('switch', { name: 'Docs установлен' });
  if ((await installed.getAttribute('aria-checked')) !== 'true') await installed.click();
  await expect(installed).toHaveAttribute('aria-checked', 'true');
  // «Готовится» — доступа ещё нет ни у кого; бета — уже можно выдавать
  await docsModule.getByRole('radio', { name: 'Бета' }).click();
  await expect(docsModule.getByRole('radio', { name: 'Бета' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // Люди: создать вручную — с паролем owner
  await owner.goto('/console/people');
  const form = owner.getByRole('form', { name: 'Создать человека' });
  await form.getByLabel('Почта').fill(email);
  await form.getByLabel('Пароль').fill(password);
  await form.getByRole('button', { name: 'Создать' }).click();
  const dialog = owner.getByRole('dialog', { name: 'Подтвердите паролем' });
  const created = owner.getByText(`Создан ${email}`);
  await expect(dialog.or(created)).toBeVisible();
  if (await dialog.isVisible()) {
    await dialog.getByLabel('Пароль').fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Подтвердить' }).click();
  }
  await expect(created).toBeVisible();

  // выдать Docs
  await owner.getByRole('list', { name: 'Люди' }).getByRole('button', { name: email }).click();
  const card = owner.getByRole('group', { name: `Карточка: ${email}` });
  const docs = card.getByRole('radiogroup', { name: 'Доступ к Docs' });
  await docs.getByRole('radio', { name: 'Читать' }).click();
  await expect(docs.getByRole('radio', { name: 'Читать' })).toHaveAttribute('aria-checked', 'true');

  // человек входит и видит только Docs
  await person.goto('/auth');
  await person.getByLabel('Почта').fill(email);
  await person.getByLabel('Пароль', { exact: true }).fill(password);
  await person.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(person).toHaveURL(/\/today$/);
  const readable = async () =>
    (
      (await (await person.request.get('/api/modules')).json()) as {
        id: string;
        flags: { read: boolean };
      }[]
    )
      .filter((m) => m.flags.read)
      .map((m) => m.id);
  expect(await readable()).toEqual(['docs']);
  await person.goto('/console');
  await expect(person.getByRole('heading', { name: 'Такой страницы нет' })).toBeVisible();

  // отозвать — доступ пропал сразу
  await docs.getByRole('radio', { name: 'Нет' }).click();
  await expect(docs.getByRole('radio', { name: 'Нет' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(readable).toEqual([]);

  // убрать за собой: заблокировать проверочного человека
  await card.getByRole('button', { name: 'Заблокировать' }).click();
  await expect(card.getByText('Заблокирован')).toBeVisible();
});
