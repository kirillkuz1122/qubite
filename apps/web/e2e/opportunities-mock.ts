import type { Page } from '@playwright/test';
import type { components } from '@qubite/api-client';
import { mockSync } from './sync-mock';

type Item = components['schemas']['OpportunityItem'];

/**
 * Поддельный сервер «Возможностей» (AGT-005) и Главной: те же адреса и ответы, что у
 * настоящего (`/api/v1/opportunities*`, `/api/v1/home*`), состояние — в памяти теста.
 * Названия — как на сохранённых страницах источников (Кодолимп, Devpost), длинное название и
 * «почему тебе» — тестовые; даты — в 2099 году, чтобы тест не устаревал.
 */
export interface OpportunitiesMock {
  items: Item[];
  /** GET списка отвечает 502 */
  down: boolean;
  /** «Интересно» отвечает 503 */
  interestedDown: boolean;
  /** что придёт после «Обновить» */
  found: Item[];
  /** POST-запросы браузера: путь */
  posts: string[];
}

let n = 0;
export function opportunity(over: Partial<Item> = {}): Item {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    account_id: '00000000-0000-4000-8000-0000000000aa',
    source: 'codolymp',
    external_id: `e2e-${n}`,
    kind: 'olympiad',
    title: 'Олимпиада',
    subject: '',
    stage: '',
    grades: '',
    registration_until: null,
    starts_at: '2099-11-30T21:00:00Z',
    ends_at: '2099-12-20T20:59:59Z',
    place: '',
    url: 'https://codolymp.ru/olympiads',
    tags: [],
    status: 'suggested',
    why: '',
    created_at: '2026-10-30T00:00:00Z',
    updated_at: '2026-10-30T00:00:00Z',
    ...over,
  };
}

/** Три предложения агента и одно про запас — как после утреннего хода агента. */
export function suggested(): Item[] {
  return [
    opportunity({
      title: 'Устная геометрия ВШЭ',
      subject: 'математика',
      stage: 'Регистрация',
      grades: '8–11 класс',
      starts_at: '2099-09-30T21:00:00Z',
      ends_at: '2099-10-27T20:59:59Z',
      registration_until: '2099-10-27T20:59:59Z',
      url: 'https://school.hse.ru/olymp-geometry/',
      why: 'В «О тебе» — 9 класс и геометрия; регистрация скоро закроется.',
    }),
    opportunity({
      title: 'Kiroween 2099',
      source: 'devpost',
      kind: 'hackathon',
      starts_at: '2099-10-30T00:00:00Z',
      ends_at: '2099-12-04T23:59:59Z',
      place: 'Онлайн',
      tags: ['Machine Learning/AI', 'Beginner Friendly'],
      url: 'https://kiroween.devpost.com/',
      why: 'Ты делаешь умный дом на ESP32 — тут есть трек для начинающих.',
    }),
    opportunity({
      title: 'Олимпиада СПбГУ по информатике',
      subject: 'информатика',
      stage: 'Отборочный этап',
      grades: '7–11 класс',
      registration_until: '2099-11-25T20:59:59Z',
      url: 'https://olympiada.spbu.ru/',
      why: 'Codeforces у тебя в интересах — задачи похожие.',
    }),
    opportunity({
      title: 'Innopolis Open, информатика',
      subject: 'информатика',
      stage: 'Первый отборочный тур',
      grades: '6–11 класс',
      url: 'https://olymp.innopolis.university/',
      why: 'Про запас: встанет на место убранной.',
    }),
  ];
}

/** Длинные название и этап — проверка переносов на 360 px. */
export function long(): Item[] {
  return [
    opportunity({
      title:
        'Всероссийская научно-техническая олимпиада школьников «Национальная технологическая инициатива» Junior по направлению «Программирование микроконтроллеров, электрика и умный дом» с очным финалом',
      subject: 'информатика, физика, технология',
      stage: 'Онлайн-этап для 1–7 классов и отбор для 8–11 классов',
      grades: '5–11 класс',
      registration_until: '2099-11-15T20:59:59Z',
      starts_at: '2099-11-30T21:00:00Z',
      ends_at: '2100-01-15T20:59:59Z',
      place: 'Челябинск, ЮУрГУ, проспект Ленина, 76, главный корпус',
      url: 'https://ntcontest.ru/junior/',
      why: 'Ты занимаешься электрикой и умным домом, а в «Памяти» записано, что хочешь участвовать в проектных конкурсах с очным финалом в Челябинске.',
    }),
    ...suggested().slice(1, 3),
  ];
}

export async function mockOpportunities(page: Page, items: Item[] = suggested()) {
  await mockSync(page);
  const mock: OpportunitiesMock = {
    items,
    down: false,
    interestedDown: false,
    found: [],
    posts: [],
  };
  const settings: components['schemas']['HomeSettings'] = {
    place: { name: 'Челябинск', region: 'Россия', latitude: 55.154, longitude: 61.4291 },
    currencies: [],
    coins: [],
    topics: [],
    available_topics: [],
  };
  await page.route('**/api/v1/home**', (route) => {
    if (new URL(route.request().url()).pathname === '/api/v1/home') {
      return route.fulfill({
        json: {
          agent: true,
          digest: {
            id: '00000000-0000-4000-8000-0000000000d1',
            action_id: '00000000-0000-4000-8000-0000000000d2',
            created_at: '2026-10-30T03:00:00Z',
            items: [
              {
                kind: 'important',
                text: 'До конца регистрации на «Устную геометрию ВШЭ» — три дня.',
                link: { type: 'action' },
              },
            ],
          },
          filed: [],
          held: [],
          settings,
        },
      });
    }
    return route.fulfill({ status: 502, json: { error: 'upstream', message: 'нет' } });
  });
  await page.route('**/api/v1/opportunities**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (req.method() === 'GET') {
      if (mock.down) {
        return route.fulfill({
          status: 502,
          json: { error: 'upstream', message: 'Сервер не ответил' },
        });
      }
      const status = url.searchParams.get('status');
      return route.fulfill({
        json: { items: mock.items.filter((i) => !status || i.status === status) },
      });
    }
    mock.posts.push(path);
    if (path === '/api/v1/opportunities/refresh') {
      mock.items.push(...mock.found);
      return route.fulfill({ json: { inserted: mock.found.length, failed_sources: [] } });
    }
    const [, id, action] = /^\/api\/v1\/opportunities\/([^/]+)\/(\w+)$/.exec(path) ?? [];
    const it = mock.items.find((i) => i.id === id);
    if (!it) return route.fulfill({ status: 404, json: { error: 'not_found', message: 'Нет' } });
    if (action === 'interested') {
      if (mock.interestedDown) {
        return route.fulfill({
          status: 503,
          json: { error: 'unavailable', message: 'Агент сейчас занят — попробуй позже' },
        });
      }
      it.status = 'interested';
      const tasks = [`Зарегистрироваться на ${it.title}`, `Подготовиться к ${it.title}`];
      tasks.push(`${it.title} — участие`);
      return route.fulfill({
        json: { item: it, tasks: tasks.map((title, i) => ({ id: `${it.id}-${i}`, title })) },
      });
    }
    if (action === 'dismiss') {
      it.status = 'dismissed';
      return route.fulfill({ json: it });
    }
    return route.fulfill({ status: 404, json: { error: 'not_found', message: 'Нет' } });
  });
  return mock;
}
