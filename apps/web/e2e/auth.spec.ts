import { expect, test } from '@playwright/test';
import { LEGAL_VERSION } from '../src/auth/legal';
import { mockAuth, OWNER } from './auth-mock';

/* Qubite Auth (AUTH-005): сервер подделан теми же ответами, браузер настоящий. */

test('лендинг → вход → «Главная»; неверный пароль — понятная ошибка', async ({ page }) => {
  const server = await mockAuth(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Войти' }).first().click();
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeAttached();

  await page.getByLabel('Почта').fill(OWNER.email);
  const password = page.getByLabel('Пароль', { exact: true });
  await password.fill('не-тот');
  // помощники отворачиваются, пока вводят пароль
  await expect(page.getByRole('img', { name: 'Помощники закрыли глаза' })).toBeVisible();
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByText('Неверная почта или пароль')).toBeVisible();
  await expect(password).toHaveValue('');

  await password.fill(server.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  expect(server.calls.filter((c) => c.path === '/api/auth/login')).toHaveLength(2);
});

test('после трёх неудач вход просит «я не робот» и отправляет токен', async ({ page }) => {
  const server = await mockAuth(page, { failures: 3 });
  await page.goto('/auth?return_to=/inbox');
  await page.getByLabel('Почта').fill(OWNER.email);
  await page.getByLabel('Пароль', { exact: true }).fill(server.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByText('подтвердите, что вы не робот')).toBeVisible();
  const submit = page.getByRole('button', { name: 'Войти', exact: true });
  await expect(submit).toBeDisabled();
  await page.getByRole('button', { name: 'Я не робот' }).click();
  await submit.click();
  await expect(page).toHaveURL(/\/inbox$/);
  const last = server.calls.filter((c) => c.path === '/api/auth/login').pop();
  expect(last?.body?.captcha_token).toBe('captcha-ok');
});

test('кнопки провайдеров — только включённые owner; ошибка провайдера понятна', async ({
  page,
}) => {
  const server = await mockAuth(page);
  server.platform.login_methods.vk = false;
  await page.goto('/auth?error=oauth_not_linked&provider=yandex');
  await expect(page.getByRole('alert').first()).toContainText('Яндекс ID ещё не привязан');
  const yandex = page.getByRole('link', { name: 'Войти через Яндекс ID' });
  await expect(yandex).toHaveAttribute('href', '/api/auth/oauth/yandex/login?return_to=%2Fhome');
  await expect(page.getByRole('link', { name: /через VK ID/ })).toHaveCount(0);
});

test('регистрация по приглашению: согласие, письмо, код — и можно войти', async ({ page }) => {
  const server = await mockAuth(page);
  await page.goto('/register?invite=7KQ2-M9XD-4TPR');
  await expect(page.getByLabel('Код приглашения')).toHaveValue('7KQ2-M9XD-4TPR');
  await page.getByLabel('Почта').fill('friend@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('очень-длинный-пароль');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  // без галочки согласия — не отправляем
  await expect(page.getByText('Без согласия аккаунт не создать')).toBeVisible();
  expect(server.calls.some((c) => c.path === '/api/auth/register')).toBe(false);
  await page.getByRole('checkbox', { name: /Принимаю условия/ }).check();
  // и через провайдера — с той же версией документов, иначе сервер аккаунт не создаст
  await expect(page.getByRole('link', { name: 'Продолжить через Яндекс ID' })).toHaveAttribute(
    'href',
    `/api/auth/oauth/yandex/login?return_to=%2Ftoday&invite=7KQ2-M9XD-4TPR&consent=${LEGAL_VERSION}`,
  );
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();

  await expect(page).toHaveURL(/\/verify-email\?/);
  // сервер хранит отметку согласия с версией документов (D-230)
  const sent = server.calls.find((c) => c.path === '/api/auth/register');
  expect(sent?.body).toMatchObject({ consent_version: LEGAL_VERSION });
  await expect(page.getByLabel('Почта')).toHaveValue('friend@example.com');
  await page.getByLabel('Код из письма').fill('000000');
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByText('Код не подошёл или устарел')).toBeVisible();
  await page.getByLabel('Код из письма').fill(server.mailCode);
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByText('Почта подтверждена')).toBeVisible();
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/auth\?email=friend/);
  await expect(page.getByLabel('Почта')).toHaveValue('friend@example.com');
});

test('регистрация закрыта — честно говорим; открыта без приглашения — нужна CAPTCHA', async ({
  page,
}) => {
  const server = await mockAuth(page, {
    registration: { mode: 'closed', invite_required: true, captcha: null },
  });
  await page.goto('/register');
  await expect(page.getByText('Регистрация сейчас закрыта')).toBeVisible();

  server.registration = {
    mode: 'open',
    invite_required: false,
    captcha: { provider: 'turnstile', site_key: 'k' },
  };
  await page.reload();
  await expect(page.getByRole('button', { name: 'Я не робот' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать аккаунт' })).toBeDisabled();
  await page.getByLabel('Код приглашения (если есть)').fill('7KQ2-M9XD-4TPR');
  await expect(page.getByRole('button', { name: 'Я не робот' })).toHaveCount(0);
});

test('ссылка из письма подтверждает почту сама; восстановление пароля по коду', async ({
  page,
}) => {
  const server = await mockAuth(page);
  await page.goto('/verify-email?token=good-link');
  await expect(page.getByText('Почта подтверждена')).toBeVisible();

  await page.goto('/auth');
  await page.getByLabel('Почта').fill(OWNER.email);
  await page.getByRole('link', { name: 'Забыли пароль?' }).click();
  await expect(page.getByLabel('Почта аккаунта')).toHaveValue(OWNER.email);
  await page.getByRole('button', { name: 'Прислать код' }).click();
  await expect(page).toHaveURL(/\/reset-password\?/);
  await page.getByLabel('Код из письма').fill(server.mailCode);
  await page.getByLabel('Новый пароль').fill('новый-пароль-123');
  await page.getByRole('button', { name: 'Сохранить пароль' }).click();
  await expect(page.getByText('Пароль обновлён')).toBeVisible();
  expect(server.password).toBe('новый-пароль-123');
});

test('аккаунт: сессии, закрыть чужую, привязка VK с паролем, бот Telegram', async ({ page }) => {
  await mockAuth(page, { me: OWNER });
  await page.goto('/account');
  await expect(page.getByText('Firefox на Android')).toBeVisible();
  await expect(page.getByText('это устройство')).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть: Firefox на Android' }).click();
  await expect(page.getByText('Firefox на Android')).toHaveCount(0);

  await page.getByRole('button', { name: 'Привязать Telegram' }).click();
  await page.getByLabel('Ваш пароль Qubite').fill('не-тот');
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByText('Пароль не подошёл')).toBeVisible();
  await page.getByLabel('Ваш пароль Qubite').fill('правильный-пароль');
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('link', { name: 'Открыть бота' })).toHaveAttribute(
    'href',
    'https://t.me/qubite_test_bot?start=abc',
  );
  await page.getByRole('button', { name: 'Готово' }).click();

  const vk = page.locator('.acc-row').filter({ hasText: 'VK ID' });
  await vk.getByRole('button', { name: 'Привязать' }).click();
  await page.getByLabel('Ваш пароль Qubite').fill('правильный-пароль');
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page).toHaveURL(/\/provider-page\?provider=vk/);
});

test('гость на «Аккаунте» и «Разрешить вход» попадает на вход и возвращается', async ({ page }) => {
  const server = await mockAuth(page);
  await page.goto(
    '/auth/device?client_id=qubite-android&redirect_uri=qubite://auth/callback&state=12345678901234567890&code_challenge=abc&code_challenge_method=S256&device_name=Redmi 12',
  );
  await expect(page).toHaveURL(/\/auth\?return_to=/);
  await page.getByLabel('Почта').fill(OWNER.email);
  await page.getByLabel('Пароль', { exact: true }).fill(server.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByText('Qubite для Android')).toBeVisible();
  await expect(page.getByText('«Redmi 12»')).toBeVisible();
  await page.getByRole('button', { name: 'Разрешить' }).click();
  await expect(page).toHaveURL(/\/app-callback\?code=one-time&state=12345678901234567890/);
  const call = server.calls.find((c) => c.path === '/api/auth/device/authorize');
  // длинное число из адреса не испортилось
  expect(call?.body?.state).toBe('12345678901234567890');
});

test('гость в разделах не задерживается: сразу на вход, после входа — обратно (D-229)', async ({
  page,
}) => {
  const server = await mockAuth(page);
  await page.goto('/inbox?q=молоко');
  await expect(page).toHaveURL(/\/auth\?return_to=/);
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeAttached();
  // разделов гость так и не увидел
  await expect(page.getByRole('heading', { level: 1, name: 'Входящие' })).toHaveCount(0);
  await page.getByLabel('Почта').fill(OWNER.email);
  await page.getByLabel('Пароль', { exact: true }).fill(server.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/inbox\?q=/);

  // вышел — и снова не пускает
  server.me = null;
  await page.goto('/planner');
  await expect(page).toHaveURL(/\/auth\?return_to=%2Fplanner$/);
});

test('нет связи с сервером — разделы открываются (без сети Qubite работает)', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort('connectionrefused'));
  await page.goto('/today');
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeAttached();
});

test('юридические страницы — черновики и ссылки между собой', async ({ page }) => {
  await mockAuth(page);
  await page.goto('/auth');
  await page
    .getByRole('navigation', { name: 'Документы' })
    .getByRole('link', { name: 'Приватность' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Политика конфиденциальности' }).first(),
  ).toBeAttached();
  await expect(page.getByText('Черновик.')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Другие документы' })
    .getByRole('link', { name: 'Cookies' })
    .click();
  await expect(page.getByText('qubite_session')).toBeVisible();
});
