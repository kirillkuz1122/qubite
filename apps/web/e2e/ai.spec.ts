import { expect, test, type Page } from '@playwright/test';
import { mockAi } from './ai-mock';
import { mockAuth, OWNER, USER } from './auth-mock';
import { mockConsole } from './console-mock';

/*
 * AI-003: AI и бюджеты кнопками — Console → AI (безлимит owner, лимиты, защита, расход, ключи,
 * журнал) и «Настройки → AI и бюджет» у каждого. Сервер подделан теми же ответами.
 */

const SHOTS = process.env.AI003_SHOTS === '1';
// снимки для docs/design/screens: AI003_SHOTS=1 AI003_W=1440 AI003_H=900 (и 360×780)
if (SHOTS)
  test.use({
    viewport: {
      width: Number(process.env.AI003_W ?? 1440),
      height: Number(process.env.AI003_H ?? 900),
    },
  });

async function owner(page: Page, { confirmed = false } = {}) {
  const auth = await mockAuth(page, { me: OWNER });
  const console = await mockConsole(page, auth);
  console.confirmed = confirmed;
  const ai = await mockAi(page, auth, console);
  return { auth, console, ai };
}

const chip = (page: Page, name: string) =>
  page.getByRole('radiogroup', { name: 'Что настроить в AI' }).getByRole('radio', { name });

async function noSideScroll(page: Page, what: string) {
  await page.waitForTimeout(150);
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(wide, `${what}: без горизонтальной прокрутки`).toBeLessThanOrEqual(0);
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  const w = page.viewportSize()?.width ?? 0;
  await page.screenshot({
    path: `../../docs/design/screens/ai-003-${name}-${w <= 400 ? 'phone' : 'pc'}.png`,
    fullPage: true,
  });
}

test('owner: «Сделать мне безлимит» — пароль, личный лимит снят, потолок платформы поставлен', async ({
  page,
}) => {
  const { auth } = await owner(page);
  await page.goto('/settings');
  await page.getByRole('link', { name: /AI и бюджет/ }).click();
  await expect(page).toHaveURL(/\/settings\/ai$/);
  await page.getByRole('link', { name: /Открыть настройки лимитов/ }).click();
  await expect(page).toHaveURL(/\/console\/ai$/);

  const panel = page.getByLabel('Безлимит для owner');
  await expect(panel).toContainText('Сейчас не работает');
  const checks = panel.getByRole('list', { name: 'Что нужно для режима' });
  await expect(checks.getByRole('listitem').nth(1)).toContainText('$0.500 в день');
  await expect(checks.getByRole('listitem').nth(2)).toContainText('без него режим не работает');
  await shot(page, 'console-budget');

  await panel.getByRole('button', { name: 'Сделать мне безлимит' }).click();
  const confirm = page.getByRole('dialog', { name: 'Подтвердите паролем' });
  await confirm.getByLabel('Пароль').fill(auth.password);
  await confirm.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(panel).toContainText('Работает');
  await expect(panel).toContainText('$5.00 в день');
  await expect(panel.getByRole('button', { name: 'Сделать мне безлимит' })).toHaveCount(0);
  const limits = page.getByRole('list', { name: 'Список лимитов' });
  await expect(limits).toContainText('Вся платформа');
  await expect(limits).not.toContainText(OWNER.email);
  await expect(limits).toContainText(USER.email);
  expect(auth.calls.filter((c) => c.path === '/api/owner/ai/unlimited')).toHaveLength(2);
  await noSideScroll(page, 'бюджет');
});

test('лимиты: новый «на каждого», изменить, снять; ошибки словами', async ({ page }) => {
  const { auth } = await owner(page, { confirmed: true });
  await page.goto('/console/ai');
  await page.getByRole('button', { name: '+ Лимит' }).click();
  const sheet = page.getByRole('dialog', { name: 'Новый лимит' });
  await sheet.getByLabel('На что').selectOption('each_user');
  await sheet
    .getByRole('radiogroup', { name: 'В чём' })
    .getByRole('radio', { name: 'запросов' })
    .click();
  await sheet.getByLabel(/Сколько/).fill('много');
  await sheet.getByRole('button', { name: 'Сохранить' }).click();
  await expect(sheet).toContainText('Целое число');
  await sheet.getByLabel(/Сколько/).fill('100');
  await sheet.getByRole('button', { name: 'Сохранить' }).click();
  await expect(sheet).toBeHidden();
  const limits = page.getByRole('list', { name: 'Список лимитов' });
  const each = limits.getByRole('listitem').filter({ hasText: 'Каждый человек' });
  await expect(each).toContainText('100 запросов в день');
  const sent = auth.calls.find((c) => c.method === 'POST' && c.path === '/api/owner/ai/limits');
  expect(sent?.body).toMatchObject({
    scope: 'each_user',
    metric: 'requests',
    period: 'day',
    value: 100,
  });

  await each.getByRole('button', { name: 'Изменить' }).click();
  const edit = page.getByRole('dialog', { name: 'Изменить лимит' });
  await edit.getByLabel(/Сколько/).fill('7');
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(each).toContainText('7 запросов в день');

  const friend = limits.getByRole('listitem').filter({ hasText: USER.email });
  await friend.getByRole('button', { name: 'Снять' }).click();
  await expect(limits).not.toContainText(USER.email);
  await shot(page, 'console-limits');

  // В журнале изменений — оба действия.
  await chip(page, 'Журнал').click();
  await page.getByRole('radio', { name: 'Изменения' }).click();
  const changes = page.getByRole('list', { name: 'Изменения AI' });
  await expect(changes).toContainText('лимит задан');
  await expect(changes).toContainText('лимит снят');
  await page.getByRole('radio', { name: 'Вызовы' }).click();
  await expect(page.getByRole('list', { name: 'AI-вызовы' })).toContainText('budget_exhausted');
});

test('защита от зацикливания и расход; ключ OpenRouter — только последние символы', async ({
  page,
}) => {
  await owner(page, { confirmed: true });
  await page.goto('/console/ai');
  await chip(page, 'Защита').click();
  const guard = page.getByRole('form', { name: 'Защита от зацикливания' });
  await guard.getByLabel('Запросов в минуту на человека').fill('0');
  await guard.getByLabel('…за столько секунд').fill('0');
  await guard.getByRole('button', { name: 'Сохранить' }).click();
  await expect(guard).toContainText('от 1 до 86 400');
  await guard.getByLabel('…за столько секунд').fill('3600');
  await guard.getByRole('button', { name: 'Сохранить' }).click();
  await expect(guard).toContainText('задано здесь');
  await shot(page, 'console-guard');
  await guard.getByRole('button', { name: 'Как в настройках сервера' }).click();
  await expect(guard).toContainText('как в настройках сервера');
  await expect(guard.getByLabel('Запросов в минуту на человека')).toHaveValue('20');

  await chip(page, 'Расход').click();
  const spend = page.getByLabel('Расход', { exact: true });
  await expect(spend.getByRole('listitem')).toHaveCount(30);
  await expect(spend.getByRole('table')).toHaveCount(4);
  await expect(spend).toContainText(OWNER.email);
  await shot(page, 'console-spend');
  await spend.getByRole('radio', { name: '7 дн.' }).click();
  await expect(spend.getByRole('listitem')).toHaveCount(7);
  await noSideScroll(page, 'расход');

  await chip(page, 'Модели и ключи').click();
  const keys = page.getByLabel('Ключи провайдеров');
  await expect(keys).toContainText('из настроек сервера');
  await keys.getByLabel('Новый ключ OpenRouter').fill('sk-or-v1-0123456789abcd');
  await keys.getByRole('button', { name: 'Сохранить ключ' }).click();
  await expect(keys).toContainText('сохранён здесь (…abcd)');
  await expect(keys.getByLabel('Новый ключ OpenRouter')).toHaveValue('');
  await expect(
    page.getByRole('switch', { name: 'Модель google/gemini-2.5-flash-lite' }),
  ).toBeVisible();
  await shot(page, 'console-models');
  await noSideScroll(page, 'модели и ключи');
});

test('человек: свой расход и лимиты, «Войти через ChatGPT», свой ключ; «Экспорт» — честное «скоро»', async ({
  page,
}) => {
  const auth = await mockAuth(page, { me: USER });
  const ai = await mockAi(page, auth, null);
  await page.goto('/settings');
  const backup = page.locator('[data-obj="set-backup"]');
  await expect(backup).toContainText('скоро');
  await expect(backup).not.toHaveAttribute('href');
  await page.getByRole('link', { name: /AI и бюджет/ }).click();
  await expect(page).toHaveURL(/\/settings\/ai$/);

  const connect = page.getByLabel('Подключить AI');
  await expect(connect).toContainText('деньги owner по твоему лимиту');
  await expect(connect).toContainText('Owner разрешил тебе свой OpenRouter: $1.00 в день');
  await expect(page.getByRole('list', { name: 'Список лимитов' })).toContainText('$0.120');
  await expect(page.getByLabel('Мой расход').getByRole('listitem')).toHaveCount(30);
  await shot(page, 'settings-ai');

  await connect.getByRole('radio', { name: 'ChatGPT' }).click();
  const popup = page.waitForEvent('popup');
  await connect.getByRole('button', { name: 'Войти через ChatGPT' }).click();
  await (await popup).close();
  expect(ai.started).toBe(1);
  const finish = connect.getByRole('form', { name: 'Закончить вход' });
  await finish
    .getByLabel('Адрес после входа')
    .fill('http://127.0.0.1:41234/auth/callback?code=abc&state=xyz');
  await finish.getByRole('button', { name: 'Закончить вход' }).click();
  await expect(connect).toContainText('Подписка подключена: me@chatgpt.example');
  await expect(connect).toContainText('своя подписка ChatGPT');
  await shot(page, 'settings-chatgpt');

  await connect.getByRole('radio', { name: 'Свой ключ' }).click();
  await connect.getByLabel('Ключ OpenRouter').fill('sk-or-v1-mine-00001234');
  await connect.getByRole('button', { name: 'Сохранить ключ' }).click();
  await expect(connect).toContainText('свой ключ OpenRouter (…1234)');
  await connect.getByRole('button', { name: 'Убрать ключ' }).click();
  await expect(connect).not.toContainText('свой ключ OpenRouter (…1234)');
  await noSideScroll(page, 'AI и бюджет');
});
