import { expect, test, type Page } from '@playwright/test';
import { mockAuth, OWNER, USER } from './auth-mock';
import { mockSync } from './sync-mock';

/*
 * Граница аккаунтов в одном браузере (SYNC-008). Сценарии — воспроизведения из ревью
 * 12.11.2026 (замечания 1, 4, 11), перевёрнутые: теперь они проверяют правильное поведение.
 * Сервер подделан, клиент синхронизации и интерфейс — настоящие.
 */

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 900;

async function capture(page: Page, text: string) {
  // Приложение загрузилось: горячая клавиша и кнопка Command уже работают.
  await expect(page.getByRole('navigation', { name: 'Разделы' })).toBeVisible();
  if (isPhone(page)) await page.getByRole('button', { name: 'Открыть Command' }).click();
  else await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: 'Строка Command' });
  await expect(input).toBeFocused();
  await input.fill(text);
  await input.press('Enter');
}

/** Мысль аккаунта A записана без сети и ждёт отправки. */
async function queuedThought(page: Page) {
  const sync = await mockSync(page);
  sync.offline = true;
  await page.goto('/inbox');
  await capture(page, 'PRIVATE-A-REVIEW');
  const row = page.locator('.item').filter({ hasText: 'PRIVATE-A-REVIEW' });
  await expect(row).toContainText('ждёт сети');
  return { sync, row };
}

test('очередь прежнего аккаунта не уходит от имени нового', async ({ page }) => {
  const { sync, row } = await queuedThought(page);

  // В соседней вкладке вошёл другой человек: cookie в браузере теперь его,
  // а эта вкладка об этом ещё не знает. Сеть вернулась — очередь пошла на сервер.
  sync.account = OWNER;
  sync.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  // Сервер отказал целиком: в аккаунт B не попало ничего.
  await expect.poll(() => sync.mismatches).toBeGreaterThan(0);
  expect(sync.ops).toEqual([]);
  // Вкладка перепроверила, кто вошёл, и открыла хранилище B: чужой мысли там нет.
  await expect(row).toHaveCount(0);
  await expect(page.getByText('Пусто — всё разобрано.')).toBeVisible();
  expect(sync.ops).toEqual([]);

  // Мысль не потеряна: A вошёл снова — она дошла до его аккаунта.
  sync.account = USER;
  await page.reload();
  await expect(row).toBeVisible();
  await expect(row).not.toContainText('ждёт сети');
  expect(sync.ops).toHaveLength(1);
  expect(sync.ops[0]).toMatchObject({ kind: 'create', title: 'PRIVATE-A-REVIEW' });
});

test('в соседней вкладке вошёл другой — эта вкладка сразу переключается', async ({ page }) => {
  const { sync, row } = await queuedThought(page);

  // Соседняя вкладка сообщает о смене аккаунта; сети у этой вкладки всё ещё нет для очереди.
  sync.account = OWNER;
  await page.evaluate(() => {
    const channel = new BroadcastChannel('qubite.account');
    channel.postMessage({ account: 'кто-то другой' });
    channel.close();
  });
  await expect(row).toHaveCount(0);

  // Сеть вернулась: клиент аккаунта A уже остановлен, его очередь никуда не идёт.
  sync.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('Пусто — всё разобрано.')).toBeVisible();
  expect(sync.ops).toEqual([]);
  expect(sync.mismatches).toBe(0);
});

test('выход не удался — честно говорим и остаёмся в аккаунте', async ({ page }) => {
  const auth = await mockAuth(page, { me: USER });
  await mockSync(page);
  let logout: 'abort' | 500 | 401 = 'abort';
  await page.route('**/api/auth/logout', (route) => {
    if (logout === 'abort') return route.abort('failed');
    if (logout === 500)
      return route.fulfill({ status: 500, json: { error: 'internal', message: 'Сбой сервера' } });
    return route.fulfill({
      status: 401,
      json: { error: 'unauthenticated', message: 'Нужно войти' },
    });
  });
  await page.goto('/account');
  const button = page.getByRole('button', { name: 'Выйти здесь', exact: true });

  // Сеть оборвалась: сессия на сервере жива — «вы вышли» показывать нельзя.
  await button.click();
  await expect(page.getByText(/Выйти не получилось — вы всё ещё в аккаунте/)).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
  await expect(button).toBeVisible();
  expect(auth.me?.id).toBe(USER.id);

  // Сервер ответил ошибкой — то же самое.
  logout = 500;
  await button.click();
  await expect(page.getByText(/Выйти не получилось.*Сбой сервера/)).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);

  // А вот «сессии уже нет» — это и есть выход.
  logout = 401;
  await button.click();
  await expect(page).toHaveURL(/\/$/);
});

test('после выхода и входа другого человека данные прежнего не видны', async ({ page }) => {
  const auth = await mockAuth(page, { me: USER });
  const sync = await mockSync(page);
  // Кто вошёл — по состоянию поддельного сервера входа.
  await page.route('**/api/auth/me', (route) =>
    auth.me
      ? route.fulfill({ json: auth.me })
      : route.fulfill({ status: 401, json: { error: 'unauthenticated', message: 'Нужно войти' } }),
  );
  auth.sessions[0]!.ip = '192.0.2.99';
  let isB = false;
  await page.route('**/api/auth/sessions', async (route) => {
    if (isB)
      await route.fulfill({
        status: 503,
        json: { error: 'unavailable', message: 'mock unavailable' },
      });
    else await route.fallback();
  });
  await page.goto('/account');
  await expect(page.getByText(/192\.0\.2\.99/)).toBeVisible();
  await page.getByRole('button', { name: 'Выйти здесь', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(auth.me).toBeNull();

  // Входит B; список его сессий сервер сейчас отдать не может.
  isB = true;
  auth.sessions = [];
  sync.account = OWNER;
  await page.getByRole('link', { name: 'Войти', exact: true }).first().click();
  await page.getByLabel('Почта').fill(OWNER.email);
  await page.getByLabel('Пароль', { exact: true }).fill(auth.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  expect(auth.me?.id).toBe(OWNER.id);
  // Экран входа переходит дальше с задержкой (анимация) — даём ей закончиться.
  await page.waitForTimeout(600);
  // Переход внутри приложения, без перезагрузки страницы: память вкладки та же.
  if (isPhone(page))
    await page.evaluate(() => {
      history.pushState({}, '', '/account');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
  else await page.getByRole('link', { name: /Аккаунт:/ }).click();
  await expect(page).toHaveURL(/\/account$/);

  // B видит не адреса и устройства A, а (после повторных попыток) ошибку загрузки.
  await expect(page.getByRole('heading', { name: 'Где вы вошли' })).toBeVisible();
  await expect(page.getByText(/192\.0\.2\.99/)).toHaveCount(0);
  await expect(page.getByText('mock unavailable')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/192\.0\.2\.99/)).toHaveCount(0);
});
