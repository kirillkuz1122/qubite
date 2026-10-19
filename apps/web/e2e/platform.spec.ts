import { expect, test } from '@playwright/test';
import { mockAuth, OWNER, USER } from './auth-mock';

/* Техработы и тумблеры платформы в интерфейсе (ACC-004): каждый тумблер виден на экране. */

const SCREEN = 'Qubite ненадолго закрылся на обновление';

test('owner включает техработы → остальные видят экран, owner работает и выключает', async ({
  page,
}) => {
  const server = await mockAuth(page, { me: OWNER });
  await page.goto('/account');
  const panel = page.locator('#maintenance');
  await panel.getByLabel('Вернёмся к (необязательно)').fill('10:00');
  await panel.getByRole('button', { name: 'Включить техработы' }).click();
  await expect(panel.getByText('Техработы включены до')).toBeVisible();
  const call = server.calls.find((c) => c.path === '/api/owner/maintenance');
  expect(call?.body).toMatchObject({ enabled: true, until: '10:00' });

  // owner работает как обычно — с полоской «идут техработы»
  await page.goto('/today');
  await expect(page.getByRole('status').filter({ hasText: 'Идут техработы' })).toBeVisible();
  await expect(page.getByText(SCREEN)).toHaveCount(0);

  // кто-то другой (owner вышел) — видит добрый экран и «вернёмся к …»
  server.me = USER;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Техработы' })).toBeAttached();
  await expect(page.getByText(SCREEN)).toBeVisible();
  await expect(page.getByText('Вернёмся к')).toBeVisible();
  // документы и вход открыты и во время техработ
  await page.getByRole('link', { name: 'Я владелец — войти' }).click();
  await expect(page.getByText('Войти сейчас может только владелец')).toBeVisible();

  server.me = OWNER;
  await page.goto('/account');
  await page.locator('#maintenance').getByRole('button', { name: 'Выключить техработы' }).click();
  await expect(page.getByText('Qubite снова открыт для всех')).toBeVisible();
  server.me = USER;
  await page.goto('/today');
  await expect(page.getByText(SCREEN)).toHaveCount(0);
});

test('экран техработ без времени не обещает «вернёмся к»; «Проверить ещё раз» пускает обратно', async ({
  page,
}) => {
  const server = await mockAuth(page, { me: USER });
  server.platform.maintenance = true;
  server.platform.maintenance_message = 'Переезжаем на новый сервер';
  await page.goto('/inbox');
  await expect(page.getByText('Переезжаем на новый сервер')).toBeVisible();
  await expect(page.getByText('Вернёмся к')).toHaveCount(0);
  server.platform.maintenance = false;
  await page.getByRole('button', { name: 'Проверить ещё раз' }).click();
  await expect(page.getByText('Переезжаем на новый сервер')).toHaveCount(0);
  await expect(page).toHaveURL(/\/inbox$/);
});

test('ответ сервера «техработы» сразу показывает экран, не дожидаясь проверки', async ({
  page,
}) => {
  const server = await mockAuth(page);
  await page.goto('/register?invite=7KQ2-M9XD-4TPR');
  await page.getByLabel('Почта').fill('friend@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('очень-длинный-пароль');
  await page.getByRole('checkbox', { name: /Принимаю условия/ }).check();
  server.platform.maintenance = true;
  server.platform.maintenance_message = 'Чиним почту';
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByText('Чиним почту')).toBeVisible();
});

test('тумблеры входа: вход выключен, пароль выключен, Google и Telegram включены', async ({
  page,
}) => {
  const server = await mockAuth(page);
  server.platform.login_methods = {
    password: false,
    yandex: false,
    vk: false,
    google: true,
    telegram: true,
  };
  server.providers = [
    { id: 'google', kind: 'redirect' },
    { id: 'telegram', kind: 'telegram_widget', bot_name: 'qubite_test_bot' },
  ];
  await page.goto('/auth');
  await expect(page.getByText('Вход паролем выключен владельцем')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Войти через Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти через Telegram' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Яндекс|VK/ })).toHaveCount(0);

  server.platform.login_enabled = false;
  await page.reload();
  await expect(page.getByText('Вход сейчас выключен')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Войти через Google' })).toHaveCount(0);
});

test('тумблеры регистрации: CAPTCHA выключена — без проверки; почта выключена — честная ошибка', async ({
  page,
}) => {
  const server = await mockAuth(page, {
    registration: { mode: 'open', invite_required: false, captcha: null },
    emailOff: true,
  });
  server.platform.registration_mode = 'open';
  await page.goto('/register');
  await expect(page.getByRole('button', { name: 'Я не робот' })).toHaveCount(0);
  await page.getByLabel('Почта').fill('friend@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('очень-длинный-пароль');
  await page.getByRole('checkbox', { name: /Принимаю условия/ }).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByText('Почта сейчас выключена')).toBeVisible();
  // при закрытой регистрации ссылки «Создать аккаунт» на входе нет
  server.platform.registration_mode = 'closed';
  await page.goto('/auth');
  await expect(page.getByRole('link', { name: 'Забыли пароль?' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Создать аккаунт' })).toHaveCount(0);
});
