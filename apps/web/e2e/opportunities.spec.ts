import { expect, test, type Locator, type Page } from '@playwright/test';
import { long, mockOpportunities, opportunity, suggested } from './opportunities-mock';

/* AGT-005: блок «Возможности» на Главной. Сервер поддельный, запросы — только к API приложения. */

const block = (page: Page) => page.getByRole('region', { name: 'Возможности' });
const card = (page: Page, title: string) => block(page).getByRole('article', { name: title });

test('агент предложил три возможности: вид, даты, почему, сайт организатора', async ({ page }) => {
  await mockOpportunities(page);
  await page.goto('/home');
  const opps = block(page);
  await expect(opps.getByRole('article')).toHaveCount(3);
  await expect(opps).toContainText('отобрал агент');
  // блок — сразу под сводкой от AI
  const digest = await page.getByRole('region', { name: 'Сводка от AI' }).boundingBox();
  const box = await opps.boundingBox();
  expect(box!.y).toBeGreaterThan(digest!.y + digest!.height);
  const geometry = card(page, 'Устная геометрия ВШЭ');
  await expect(geometry).toContainText('олимпиада');
  await expect(geometry).toContainText('Регистрация до 27 октября 2099');
  await expect(geometry).toContainText('8–11 класс · математика');
  await expect(geometry).toContainText('почему тебе: В «О тебе» — 9 класс и геометрия');
  const site = geometry.getByRole('link', { name: 'Сайт организатора: Устная геометрия ВШЭ' });
  await expect(site).toHaveAttribute('href', 'https://school.hse.ru/olymp-geometry/');
  await expect(site).toHaveAttribute('target', '_blank');
  await expect(site).toHaveAttribute('rel', 'noopener noreferrer');
  const hack = card(page, 'Kiroween 2099');
  await expect(hack).toContainText('хакатон');
  await expect(hack).toContainText('30 октября – 4 декабря 2099');
  await expect(hack).toContainText('Онлайн');
  await expect(card(page, 'Олимпиада СПбГУ по информатике')).toContainText(
    'олимпиада · Отборочный этап',
  );
  await expect(opps).not.toContainText('Innopolis Open');
});

test('«Интересно» ставит дела и ведёт в ленту агента', async ({ page }) => {
  const mock = await mockOpportunities(page);
  mock.interestedDown = true;
  await page.goto('/home');
  const spbu = card(page, 'Олимпиада СПбГУ по информатике');
  await spbu.getByRole('button', { name: 'Интересно' }).click();
  await expect(spbu.getByRole('alert')).toContainText('Агент сейчас занят — попробуй позже');
  mock.interestedDown = false;
  await spbu.getByRole('button', { name: 'Интересно' }).click();
  await expect(spbu.getByRole('status')).toHaveText('Дела поставлены: 3');
  await expect(spbu.getByRole('alert')).toHaveCount(0);
  const feed = spbu.getByRole('link', { name: 'Что сделал агент →' });
  await expect(feed).toHaveAttribute('href', '/agent');
  expect(mock.posts).toEqual([
    `/api/v1/opportunities/${mock.items[2]!.id}/interested`,
    `/api/v1/opportunities/${mock.items[2]!.id}/interested`,
  ]);
  await feed.click();
  await expect(page).toHaveURL(/\/agent$/);
});

test('«Не надо»: можно вернуть, иначе карточка уходит и встаёт следующая', async ({ page }) => {
  const mock = await mockOpportunities(page);
  await page.goto('/home');
  const opps = block(page);
  await card(page, 'Kiroween 2099').getByRole('button', { name: 'Не надо' }).click();
  const away = opps.getByRole('group', { name: 'Убрано: Kiroween 2099' });
  await away.getByRole('button', { name: 'Вернуть' }).click();
  await expect(card(page, 'Kiroween 2099')).toBeVisible();
  await page.waitForTimeout(500);
  expect(mock.posts).toEqual([]);

  await card(page, 'Kiroween 2099').getByRole('button', { name: 'Не надо' }).click();
  await expect(away).toBeVisible();
  await expect(card(page, 'Innopolis Open, информатика')).toBeVisible({ timeout: 10_000 });
  await expect(away).toHaveCount(0);
  await expect(opps.getByRole('article')).toHaveCount(3);
  expect(mock.posts).toEqual([`/api/v1/opportunities/${mock.items[1]!.id}/dismiss`]);
});

test('без отбора агента — ближайшие новые с пометкой; пусто — «Обновить»', async ({ page }) => {
  const mock = await mockOpportunities(page, []);
  mock.found = [opportunity({ status: 'new', title: 'DANO', subject: 'анализ данных' })];
  await page.goto('/home');
  const opps = block(page);
  await expect(opps).toContainText('Агент пока ничего не нашёл');
  await opps.getByRole('button', { name: 'Обновить' }).click();
  await expect(card(page, 'DANO')).toBeVisible();
  await expect(opps).toContainText('без отбора агента');
  expect(mock.posts).toEqual(['/api/v1/opportunities/refresh']);
});

test('сервер не ответил — блок честно пишет и даёт повторить', async ({ page }) => {
  const mock = await mockOpportunities(page);
  mock.down = true;
  await page.goto('/home');
  const opps = block(page);
  await expect(opps).toContainText('Возможности сейчас недоступны');
  mock.down = false;
  await opps.getByRole('button', { name: 'Повторить' }).click();
  await expect(opps.getByRole('article')).toHaveCount(3);
});

/** Всё внутри карточки остаётся в её границах. */
async function inside(outer: Locator, inner: Locator) {
  const o = (await outer.boundingBox())!;
  for (const b of await inner.all()) {
    const r = (await b.boundingBox())!;
    expect(r.x).toBeGreaterThanOrEqual(o.x - 0.5);
    expect(r.x + r.width).toBeLessThanOrEqual(o.x + o.width + 0.5);
  }
}

for (const theme of ['light', 'dark']) {
  test(`360 px, ${theme}: длинное название переносится, без горизонтальной прокрутки`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await mockOpportunities(page, long());
    await page.goto('/home');
    await page.evaluate((v) => document.documentElement.setAttribute('data-theme', v), theme);
    const first = block(page).getByRole('article').first();
    await expect(first).toContainText('с очным финалом');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
    const title = first.getByRole('heading', { level: 3 });
    // название целиком, в несколько строк, не шире карточки
    expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect((await title.boundingBox())!.height).toBeGreaterThan(60);
    await inside(first, first.locator('.opp-kind, .opp-title, .opp-facts li, .opp-why, a, button'));
    for (const name of ['Интересно', 'Не надо']) {
      const b = (await first.getByRole('button', { name }).boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.width).toBeGreaterThanOrEqual(44);
    }
  });
}

test('гость не видит блока', async ({ page }) => {
  await mockOpportunities(page, suggested());
  await page.route('**/api/v1/opportunities**', (route) =>
    route.fulfill({ status: 401, json: { error: 'unauthorized', message: 'Нужно войти' } }),
  );
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Дела на сегодня' })).toBeAttached();
  await expect(block(page)).toHaveCount(0);
});
