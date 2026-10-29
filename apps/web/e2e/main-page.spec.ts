import { expect, test, type Page } from '@playwright/test';
import { mockSync, type SyncMock } from './sync-mock';

/* Главная (HOME-001): первый экран, сводка от AI, дела, Входящие, сроки, погода, курсы, новости. */

const pad = (n: number) => String(n).padStart(2, '0');
const day = (plus = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + plus);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

interface HomeMock {
  overview: Record<string, unknown>;
  settings: Record<string, unknown>;
  patches: Record<string, unknown>[];
  located: Record<string, unknown>[];
  weatherDown: boolean;
}

const CHELYABINSK = {
  name: 'Челябинск',
  region: 'Челябинская область, Россия',
  latitude: 55.154,
  longitude: 61.4291,
};
const EKB = {
  name: 'Екатеринбург',
  region: 'Свердловская область, Россия',
  latitude: 56.8519,
  longitude: 60.6122,
};

async function mockHome(page: Page, sync: SyncMock, agent = true): Promise<HomeMock> {
  const m: HomeMock = {
    settings: { place: CHELYABINSK, currencies: ['USD', 'EUR', 'CNY'], topics: ['ai', 'code'] },
    overview: {},
    patches: [],
    located: [],
    weatherDown: false,
  };
  const task = [...sync.objects.values()].find((o) => o.object_type === 'planner.task');
  m.overview = {
    agent,
    digest: agent
      ? {
          id: 'd1',
          action_id: 'a1',
          created_at: new Date().toISOString(),
          items: [
            {
              kind: 'important',
              text: 'Сегодня сдать упр. 145',
              link: { type: 'task', id: task?.id, title: task?.title },
            },
            {
              kind: 'news',
              text: 'Вышла открытая модель',
              link: { type: 'url', url: 'https://habr.com/ru/articles/1/' },
            },
          ],
        }
      : null,
    filed: agent
      ? [
          {
            action_id: 'a2',
            summary: 'Разложил мысль «купить тетради» → дело «Купить тетради»',
            reason: null,
            object_id: null,
            at: new Date().toISOString(),
          },
        ]
      : [],
    held: agent
      ? [
          {
            id: 'n-held',
            kind: 'agent',
            origin: 'agent',
            title: 'Есть 30 минут на упр. 145?',
            body: '',
            why: '',
            held: true,
            created_at: new Date().toISOString(),
          },
        ]
      : [],
  };
  const json = (route: import('@playwright/test').Route, body: unknown, status = 200) =>
    route.fulfill({ status, json: body });
  await page.route('**/api/v1/home**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const at = `${req.method()} ${url.pathname}`;
    switch (at) {
      case 'GET /api/v1/home':
        return json(route, { ...m.overview, settings: m.settings });
      case 'PATCH /api/v1/home/settings': {
        const body = req.postDataJSON() as Record<string, unknown>;
        m.patches.push(body);
        Object.assign(m.settings, body);
        return json(route, m.settings);
      }
      case 'GET /api/v1/home/places':
        return json(route, { items: url.searchParams.get('q')?.startsWith('Ек') ? [EKB] : [] });
      case 'POST /api/v1/home/locate':
        m.located.push(req.postDataJSON() as Record<string, unknown>);
        m.settings.place = EKB;
        return json(route, m.settings);
      case 'GET /api/v1/home/weather': {
        if (m.weatherDown)
          return json(route, { error: 'upstream', message: 'Источник не отвечает' }, 502);
        const place = m.settings.place as typeof CHELYABINSK;
        return json(route, {
          place: place.name,
          now: {
            temperature: -3.2,
            feels_like: -7.9,
            code: 71,
            text: 'небольшой снег',
            wind: 5.1,
            is_day: true,
          },
          days: [
            { date: day(), code: 71, text: 'небольшой снег', max: -1, min: -6, precipitation: 70 },
            { date: day(1), code: 3, text: 'пасмурно', max: 2, min: -4, precipitation: 20 },
            { date: day(2), code: 0, text: 'ясно', max: 4.5, min: -2, precipitation: 0 },
          ],
          fetched_at: new Date().toISOString(),
          stale: false,
        });
      }
      case 'GET /api/v1/home/rates': {
        const all = [
          { code: 'USD', name: 'Доллар США', nominal: 1, value: 81.5, change: 0.5 },
          { code: 'EUR', name: 'Евро', nominal: 1, value: 94.25, change: -0.75 },
          { code: 'CNY', name: 'Китайский юань', nominal: 1, value: 11.3, change: null },
          { code: 'KZT', name: 'Казахстанский тенге', nominal: 100, value: 16.8, change: null },
        ];
        const codes = m.settings.currencies as string[];
        return json(route, {
          date: day(),
          items: codes.map((c) => all.find((x) => x.code === c)).filter(Boolean),
          available: all.map(({ code, name }) => ({ code, name })),
          fetched_at: new Date().toISOString(),
          stale: false,
        });
      }
      case 'GET /api/v1/home/news': {
        const topics = m.settings.topics as string[];
        const items = [
          {
            topic: 'ai',
            topic_title: 'ИИ и технологии',
            title: 'Новая модель умеет всё',
            url: 'https://habr.com/ru/articles/1/',
          },
          {
            topic: 'code',
            topic_title: 'Программирование',
            title: 'Rust 2.0 вышел',
            url: 'https://habr.com/ru/articles/2/',
          },
          {
            topic: 'study',
            topic_title: 'Олимпиады и учёба',
            title: 'Итоги олимпиады',
            url: 'https://habr.com/ru/articles/3/',
          },
        ].filter((n) => topics.includes(n.topic));
        return json(route, {
          items: items.map((n) => ({ ...n, source: 'Хабр', published: new Date().toISOString() })),
          fetched_at: new Date().toISOString(),
          stale: false,
        });
      }
    }
    return json(route, { error: 'not_found', message: '' }, 404);
  });
  return m;
}

test('Главная: сводка от AI, дела, Входящие, сроки, погода, курсы, новости', async ({ page }) => {
  const sync = await mockSync(page);
  sync.addTask('Упр. 145 по русскому', { due_date: day() });
  sync.addTask('Контрольная по алгебре', { due_date: day(2), due_time: '10:00' });
  sync.addTask('Далёкое дело', { due_date: day(20) });
  sync.addElsewhere('купить тетради');
  await mockHome(page, sync);
  await page.goto('/home');

  await expect(page.getByRole('heading', { level: 1, name: 'Главная' })).toBeAttached();
  await expect(page).toHaveTitle('Главная · Qubite');

  // Сводка — помечена «от AI», пункты ведут к делу и к статье.
  const digest = page.getByRole('region', { name: 'Сводка от AI' });
  await expect(digest).toContainText('от AI');
  await expect(digest).toContainText('Сегодня сдать упр. 145');
  const article = digest.getByRole('link', { name: /статья/ });
  await expect(article).toHaveAttribute('href', 'https://habr.com/ru/articles/1/');
  await expect(article).toHaveAttribute('rel', 'noopener noreferrer');

  // Пришло в тишину.
  await expect(page.getByText('Пока было тихо, пришло 1 сообщение')).toBeVisible();
  await expect(page.getByText('Есть 30 минут на упр. 145?')).toBeVisible();

  // Дела на сегодня — настоящие, из синхронизации.
  await expect(page.locator('.row').filter({ hasText: 'Упр. 145 по русскому' })).toBeVisible();
  // Входящие и что агент разложил.
  await expect(page.locator('.spark').filter({ hasText: 'купить тетради' }).first()).toBeVisible();
  await expect(page.getByLabel('Агент разложил')).toContainText('Разложил мысль «купить тетради»');
  // Сроки — неделя вперёд, далёкого нет.
  const due = page.locator('.home-due');
  await expect(due).toContainText('Контрольная по алгебре');
  await expect(due).toContainText('10:00');
  await expect(due).not.toContainText('Далёкое дело');

  // Погода и курсы.
  await expect(page.locator('.home-card').first()).toContainText('Челябинск');
  await expect(page.locator('.home-now')).toContainText('−3°');
  await expect(page.locator('.home-now')).toContainText('небольшой снег');
  const rates = page.locator('.home-rates');
  await expect(rates).toContainText('USD');
  await expect(rates).toContainText('81,50 ₽');
  await expect(rates).toContainText('▲ 0,50');
  await expect(rates).toContainText('▼ 0,75');

  // Новости по темам из настройки.
  const news = page.locator('.home-news');
  await expect(news).toContainText('Новая модель умеет всё');
  await expect(news).toContainText('Rust 2.0 вышел');
  await expect(news).not.toContainText('Итоги олимпиады');

  // Пункт сводки ведёт к делу в Planner.
  await digest.getByRole('button', { name: /дело «Упр. 145 по русскому»/ }).click();
  await expect(page).toHaveURL(/\/planner$/);
});

test('настройки у виджетов: город поиском и геолокацией, валюты, темы', async ({
  page,
  context,
}) => {
  const sync = await mockSync(page);
  const home = await mockHome(page, sync);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 56.80123, longitude: 60.55555 });
  await page.goto('/home');

  // Город поиском.
  await page.getByRole('button', { name: 'Настроить: Город погоды' }).click();
  const place = page.getByRole('group', { name: 'Город погоды' });
  await expect(place).toContainText('Сейчас: Челябинск');
  await place.getByLabel('Другой город').fill('Екат');
  await place.getByRole('button', { name: /Екатеринбург/ }).click();
  await expect.poll(() => home.patches.at(-1)).toEqual({ place: EKB });
  await expect(page.locator('.home-card').first()).toContainText('Екатеринбург');

  // Геолокация: координаты уходят один раз, хранится город.
  home.settings.place = CHELYABINSK;
  await place.getByRole('button', { name: 'Определить по геолокации' }).click();
  await expect.poll(() => home.located.length).toBe(1);
  expect(home.located[0]).toEqual({ latitude: 56.80123, longitude: 60.55555 });
  await expect(page.locator('.home-card').first()).toContainText('Екатеринбург');

  // Настройки — модальным окном (D-434): закрыть и открыть следующее.
  await page
    .getByRole('dialog', { name: 'Город погоды' })
    .getByRole('button', { name: 'Закрыть' })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Курсор остаётся там, где была кнопка «Закрыть», — у правого края, и раскрывает линии
  // заголовков (EdgeScroll): они перекрывают кнопки. Человек уводит курсор; уводим и мы.
  await page.mouse.move(180, 300);

  // Валюты.
  await page.getByRole('button', { name: 'Настроить: Валюты' }).click();
  const money = page.getByRole('group', { name: 'Валюты' });
  await money.getByText('KZT · Казахстанский тенге').click();
  await expect
    .poll(() => home.patches.at(-1))
    .toEqual({ currencies: ['USD', 'EUR', 'CNY', 'KZT'] });
  await expect(page.locator('.home-rates')).toContainText('16,80 ₽ за 100');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Темы новостей.
  await page.getByRole('button', { name: 'Настроить: Темы новостей' }).click();
  await page.getByRole('group', { name: 'Темы новостей' }).getByText('Олимпиады и учёба').click();
  await expect.poll(() => home.patches.at(-1)).toEqual({ topics: ['ai', 'code', 'study'] });
  await expect(page.locator('.home-news')).toContainText('Итоги олимпиады');
});

test('без агента — всё, кроме сводки; погода недоступна — остальное видно', async ({ page }) => {
  const sync = await mockSync(page);
  const home = await mockHome(page, sync, false);
  home.weatherDown = true;
  await page.goto('/home');
  await expect(page.locator('.home-rates')).toContainText('USD');
  await expect(page.getByText('Погода сейчас недоступна.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Сводка от AI' })).toHaveCount(0);
  await expect(page.getByText('На сегодня дел нет.')).toBeVisible();
  await expect(page.getByText('На неделю вперёд сроков нет.')).toBeVisible();
});

test('нет связи с сервером — Главная открывается, виджеты честно пустые', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort('connectionrefused'));
  await page.goto('/home');
  await expect(page.getByRole('heading', { level: 1, name: 'Главная' })).toBeAttached();
  await expect(page.getByText('Курсы сейчас недоступны.')).toBeVisible();
});
