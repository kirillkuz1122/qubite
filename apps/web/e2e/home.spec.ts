import type { components } from '@qubite/api-client';
import { expect, test, type Page } from '@playwright/test';
import { mockSync } from './sync-mock';

const health = (status: 'ok' | 'down') => async (page: import('@playwright/test').Page) =>
  page.route('**/api/health', (route) =>
    status === 'ok'
      ? route.fulfill({
          json: {
            status: 'ok',
            version: '0.1.0',
            deploy: {
              commit: '0123456789ab',
              built_at: null,
              deployed_at: null,
              rollback: null,
            },
          },
        })
      : route.fulfill({ status: 503, body: 'down' }),
  );
const server = (page: import('@playwright/test').Page) =>
  page.getByRole('status').filter({ hasText: 'Сервер' });

test('лендинг открывается: заголовок, строка Command, вход в приложение', async ({ page }) => {
  await health('ok')(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Мысль — это точка.' })).toBeAttached();
  await expect(page.getByRole('textbox', { name: 'Строка Command' })).toBeVisible();
  await page.getByRole('link', { name: 'Начать' }).first().click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('heading', { name: 'Главная', level: 1 })).toBeAttached();
});

test('в подвале лендинга видно, что сервер работает', async ({ page }) => {
  await health('ok')(page);
  await page.goto('/');
  await expect(server(page)).toHaveText('Сервер работает · версия 0.1.0 · 0123456789ab');
});

test('лендинг честно пишет, если сервер недоступен', async ({ page }) => {
  await health('down')(page);
  await page.goto('/');
  await expect(server(page)).toHaveText('Сервер недоступен');
});

test('строка Command на лендинге понимает, что это дело со сроком', async ({ page }) => {
  await health('ok')(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'дело со сроком' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Дело' })).toContainText('завтра, 16:00');
});

test('неизвестный адрес показывает страницу «нет такой страницы»', async ({ page }) => {
  await health('ok')(page);
  await page.goto('/nope');
  await expect(page.getByRole('heading', { name: 'Такой страницы нет' })).toBeVisible();
});

/* HOME-002b: все источники поддельные, запросы идут только к API приложения. */
const TOPICS = [
  { id: 'ai', title: 'ИИ и технологии' },
  { id: 'code', title: 'Программирование' },
  { id: 'study', title: 'Олимпиады и учёба' },
  { id: 'contests', title: 'Соревнования по программированию' },
];
const CURRENCIES = [
  { code: 'USD', name: 'Доллар США' },
  { code: 'EUR', name: 'Евро' },
  { code: 'CNY', name: 'Китайский юань' },
  { code: 'PHP', name: 'Филиппинское песо' },
  { code: 'JPY', name: 'Японская иена' },
  { code: 'KZT', name: 'Казахстанский тенге' },
  { code: 'GBP', name: 'Фунт стерлингов' },
  { code: 'CHF', name: 'Швейцарский франк' },
  { code: 'BRL', name: 'Бразильский реал' },
];
const COINS = [
  {
    id: 'bitcoin',
    symbol: 'btc',
    name: 'Bitcoin',
    usd: 100000,
    rub: 8150000,
    change_24h: 2.5,
  },
  {
    id: 'the-open-network',
    symbol: 'ton',
    name: 'TON',
    usd: 5,
    rub: 407.5,
    change_24h: -1,
  },
  {
    id: 'ethereum',
    symbol: 'eth',
    name: 'Ethereum',
    usd: 2500,
    rub: 203750,
    change_24h: 0,
  },
  {
    id: 'tiny',
    symbol: 'tiny',
    name: 'Tiny Coin',
    usd: 0.0001,
    rub: 0.00815,
    change_24h: null,
  },
  {
    id: 'solana',
    symbol: 'sol',
    name: 'Solana',
    usd: 150,
    rub: 12225,
    change_24h: 3,
  },
  {
    id: 'litecoin',
    symbol: 'ltc',
    name: 'Litecoin',
    usd: 70,
    rub: 5705,
    change_24h: -2,
  },
  {
    id: 'dogecoin',
    symbol: 'doge',
    name: 'Dogecoin',
    usd: 0.1,
    rub: 8.15,
    change_24h: 1,
  },
];

async function mockWidgets(page: Page) {
  await mockSync(page);
  const settings: components['schemas']['HomeSettings'] = {
    place: { name: 'Челябинск', region: 'Россия', latitude: 55.154, longitude: 61.4291 },
    currencies: ['USD', 'EUR', 'CNY'],
    coins: ['bitcoin', 'the-open-network'],
    topics: ['ai'],
    available_topics: TOPICS,
  };
  const mock = {
    settings,
    patches: [] as components['schemas']['HomeSettingsChange'][],
    searches: [] as string[],
    coinsDown: false,
    searchDown: false,
    saveDown: false,
    stale: false,
  };
  const freshness = () => ({ fetched_at: '2026-10-29T12:00:00Z', stale: mock.stale });
  await page.route('**/api/v1/home**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/v1/home') {
      return route.fulfill({ json: { agent: false, filed: [], held: [], settings } });
    }
    if (path === '/api/v1/home/settings') {
      const change = route.request().postDataJSON() as components['schemas']['HomeSettingsChange'];
      mock.patches.push(change);
      if (mock.saveDown) {
        return route.fulfill({
          status: 503,
          json: { error: 'unavailable', message: 'Не удалось сохранить' },
        });
      }
      Object.assign(settings, change);
      return route.fulfill({ json: settings });
    }
    if (path === '/api/v1/home/rates') {
      return route.fulfill({
        json: {
          ...freshness(),
          date: '2026-10-29',
          available: CURRENCIES,
          items: settings.currencies.map((code) => ({
            ...CURRENCIES.find((c) => c.code === code),
            nominal: 1,
            value: code === 'PHP' ? 1.4 : 81.5,
            change: code === 'PHP' ? null : 0.5,
            source: code === 'PHP' ? 'er-api' : 'cbr',
          })),
        },
      });
    }
    if (path === '/api/v1/home/coins/search') {
      const q = url.searchParams.get('q') ?? '';
      mock.searches.push(q);
      if (mock.searchDown) {
        return route.fulfill({
          status: 502,
          json: { error: 'upstream', message: 'Поиск недоступен' },
        });
      }
      return route.fulfill({
        json: {
          ...freshness(),
          items: COINS.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())),
        },
      });
    }
    if (path === '/api/v1/home/coins') {
      if (mock.coinsDown) {
        return route.fulfill({
          status: 502,
          json: { error: 'upstream', message: 'Источник не отвечает' },
        });
      }
      return route.fulfill({
        json: {
          ...freshness(),
          items: settings.coins.map((id) => COINS.find((c) => c.id === id)),
        },
      });
    }
    if (path === '/api/v1/home/news') {
      return route.fulfill({
        json: {
          ...freshness(),
          items: settings.topics.includes('contests')
            ? [
                {
                  topic: 'contests',
                  topic_title: 'Соревнования по программированию',
                  title: 'Codeforces Round',
                  source: 'Codeforces',
                  url: 'https://codeforces.com/contest/1234',
                  published: '2026-11-05T15:35:00Z',
                },
              ]
            : [],
        },
      });
    }
    return route.fulfill({
      status: 502,
      json: { error: 'upstream', message: 'Источник не отвечает' },
    });
  });
  return mock;
}

async function closeSettings(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.mouse.move(180, 300);
}

test('Главная: песо, поиск монеты и тема соревнований сохраняются', async ({ page }) => {
  const mock = await mockWidgets(page);
  await page.goto('/home');
  await page.getByRole('button', { name: 'Настроить: Валюты' }).click();
  const currencies = page.getByRole('group', { name: 'Валюты' });
  await currencies.getByRole('textbox', { name: 'Поиск валюты' }).fill('песо');
  await currencies.getByRole('checkbox', { name: 'PHP · Филиппинское песо' }).click();
  await expect.poll(() => mock.settings.currencies).toEqual(['USD', 'EUR', 'CNY', 'PHP']);
  await expect(page.locator('.home-rates')).toContainText('не ЦБ');
  await expect(page.locator('.home-rates li').last()).toContainText('PHP');
  await closeSettings(page);

  await page.getByRole('button', { name: 'Настроить: Монеты' }).click();
  const coins = page.getByRole('group', { name: 'Монеты' });
  await coins.getByRole('textbox', { name: 'Поиск монеты' }).fill('E');
  await expect(coins.getByText('Введите хотя бы 2 знака названия')).toBeVisible();
  expect(mock.searches).toEqual([]);
  await coins.getByRole('textbox', { name: 'Поиск монеты' }).fill('Ethereum');
  await coins.getByRole('checkbox', { name: 'ETH · Ethereum' }).click();
  expect(mock.searches).toEqual(['Ethereum']);
  await expect
    .poll(() => mock.patches.at(-1))
    .toEqual({ coins: ['bitcoin', 'the-open-network', 'ethereum'] });
  await expect(page.locator('.home-coins')).toContainText('Ethereum');
  await expect(page.locator('.home-coins')).toContainText('2\u00a0500,00 $');
  await expect(page.locator('.home-coins')).toContainText('203\u00a0750,00 ₽');
  await coins.getByRole('checkbox', { name: 'BTC · Bitcoin' }).click();
  await expect.poll(() => mock.settings.coins).toEqual(['the-open-network', 'ethereum']);
  await coins.getByRole('button', { name: 'По умолчанию' }).click();
  await expect.poll(() => mock.settings.coins).toEqual(['bitcoin', 'the-open-network']);
  await closeSettings(page);

  await page.getByRole('button', { name: 'Настроить: Темы новостей' }).click();
  await page.getByRole('checkbox', { name: 'Соревнования по программированию' }).click();
  await expect.poll(() => mock.patches.at(-1)).toEqual({ topics: ['ai', 'contests'] });
  await expect(page.locator('.home-news')).toContainText('Codeforces Round');
  await expect(page.locator('.home-news')).toContainText('Старт: 5 ноября 2026');
  await closeSettings(page);
  for (const [name, href] of [
    ['Календарь олимпиад: Кодолимп', 'https://codolymp.ru/olympiads'],
    ['Олимпиады школьников', 'https://olimpiada.ru'],
  ] as const) {
    const link = page.getByRole('link', { name });
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
});

test('лимиты валют и монет объясняются, выбранное можно убрать', async ({ page }) => {
  const mock = await mockWidgets(page);
  mock.settings.currencies = CURRENCIES.slice(0, 8).map((c) => c.code);
  mock.settings.coins = COINS.slice(0, 6).map((c) => c.id);
  await page.goto('/home');
  await page.getByRole('button', { name: 'Настроить: Валюты' }).click();
  await page.getByRole('checkbox', { name: 'BRL · Бразильский реал' }).click();
  await expect(page.getByRole('alert')).toContainText('Можно выбрать до 8 валют');
  expect(mock.patches).toHaveLength(0);
  await page.getByRole('checkbox', { name: 'USD · Доллар США' }).click();
  await expect.poll(() => mock.settings.currencies.length).toBe(7);
  await page.getByRole('checkbox', { name: 'BRL · Бразильский реал' }).click();
  await expect.poll(() => mock.settings.currencies.at(-1)).toBe('BRL');
  await closeSettings(page);
  await page.getByRole('button', { name: 'Настроить: Монеты' }).click();
  await page.getByRole('textbox', { name: 'Поиск монеты' }).fill('Dogecoin');
  await page.getByRole('checkbox', { name: 'DOGE · Dogecoin' }).click();
  await expect(page.getByRole('alert')).toContainText('Можно выбрать до 6 монет');
  expect(mock.settings.coins).toHaveLength(6);
});

test('поиск монет: пустой ответ, ошибка поиска и ошибка сохранения', async ({ page }) => {
  const mock = await mockWidgets(page);
  await page.goto('/home');
  await page.getByRole('button', { name: 'Настроить: Монеты' }).click();
  const search = page.getByRole('textbox', { name: 'Поиск монеты' });
  await search.fill('несуществующая монета');
  await expect(page.getByText('Монеты не найдены. Попробуйте другое название.')).toBeVisible();
  mock.searchDown = true;
  await search.fill('Ethereum');
  await expect(page.getByRole('alert')).toContainText('Поиск недоступен');
  mock.searchDown = false;
  await search.fill('Eth');
  await expect(page.getByRole('checkbox', { name: 'ETH · Ethereum' })).toBeVisible();
  mock.saveDown = true;
  await page.getByRole('checkbox', { name: 'ETH · Ethereum' }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось сохранить');
  expect(mock.settings.coins).toEqual(['bitcoin', 'the-open-network']);
});

test('нет монет, нет источника без кэша, устаревшие данные', async ({ page }) => {
  const mock = await mockWidgets(page);
  mock.settings.coins = [];
  await page.goto('/home');
  await expect(page.getByText('Добавьте монеты шестерёнкой')).toBeVisible();
  mock.coinsDown = true;
  await page.reload();
  await expect(page.getByText('Цены монет сейчас недоступны. Попробуйте позже.')).toBeVisible();
  mock.coinsDown = false;
  mock.settings.coins = ['bitcoin'];
  mock.stale = true;
  await page.reload();
  const coins = page.locator('.home-card').filter({ hasText: 'Криптовалюта' });
  await expect(coins).toContainText('Bitcoin');
  await expect(coins).toContainText('устарело');
});

for (const theme of ['light', 'dark']) {
  test(`Главная на 360 px: ${theme}, виджеты и настройки помещаются`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await mockWidgets(page);
    await page.goto('/home');
    await page.evaluate(
      (value) => document.documentElement.setAttribute('data-theme', value),
      theme,
    );
    await expect(page.locator('.home-coins')).toContainText('Bitcoin');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
    // блок «Возможности» выше двигает остальное пружиной (useFlip): ждём, пока карточки осядут
    await expect
      .poll(
        async () => {
          const rates = await page
            .locator('.home-card')
            .filter({ hasText: 'Курсы валют' })
            .boundingBox();
          const coins = await page
            .locator('.home-card')
            .filter({ hasText: 'Криптовалюта' })
            .boundingBox();
          return coins!.y - (rates!.y + rates!.height);
        },
        { timeout: 5000 },
      )
      .toBeGreaterThanOrEqual(0);
    const gear = page.getByRole('button', { name: 'Настроить: Монеты' });
    await expect
      .poll(async () => (await gear.boundingBox())!.height, { timeout: 5000 })
      .toBeGreaterThanOrEqual(44);
    const bounds = await gear.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    await gear.click();
    const dialog = page.getByRole('dialog', { name: 'Монеты' });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    await expect(dialog.getByRole('button', { name: 'По умолчанию' })).toBeVisible();
  });
}
