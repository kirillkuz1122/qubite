import { expect, test, type Page } from '@playwright/test';
import { mockSync } from './sync-mock';

/*
 * Уроки английского (ENG-002): сервер подделан (программа, урок, сверка ответов, итог), микрофон
 * и проигрывание — поддельные (браузер настоящий). Урок целиком: теория → задания (выбрать,
 * собрать фразу, повторить вслух голосом) → итог с огоньком и опытом, домашка в Planner. И
 * входной тест для новичка. Снимки для docs: ENG002_SHOTS=1.
 */

const SHOTS = process.env.ENG002_SHOTS === '1';

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  const w = page.viewportSize()?.width ?? 0;
  await page.screenshot({
    path: `../../docs/design/screens/eng-002/${name}-${w <= 400 ? 'phone' : 'pc'}.png`,
    fullPage: true,
  });
}

/** Без прокрутки вбок — когда смена вкладки (Swap) доехала: меряем устоявшийся вид. */
async function noSideScroll(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      { message: 'без горизонтальной прокрутки' },
    )
    .toBeLessThanOrEqual(0);
}

/** Поддельный микрофон и звук. */
async function fakeMedia(page: Page) {
  await page.addInitScript(() => {
    class FakeRecorder {
      static isTypeSupported(t: string) {
        return t.startsWith('audio/webm');
      }
      state = 'inactive';
      mimeType = 'audio/webm;codecs=opus';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['OPUS-FAKE'], { type: this.mimeType }) });
        setTimeout(() => this.onstop?.(), 10);
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { value: FakeRecorder });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      setTimeout(() => this.dispatchEvent(new Event('ended')), 300);
      return Promise.resolve();
    };
  });
}

const tasks = [
  {
    id: 't1',
    type: 'choose',
    ask_ru: 'Как правильно сказать «Я Кирилл»?',
    question: 'Я Кирилл.',
    options: ['I Kirill.', "I'm Kirill.", 'My Kirill.'],
    answer: "I'm Kirill.",
    explain_ru: 'I’m = I am. Без am не бывает.',
  },
  {
    id: 't4',
    type: 'build',
    ask_ru: 'Собери вопрос из плиток.',
    from_ru: 'Как тебя зовут?',
    answer: "What's your name?",
    extra: ['my'],
  },
  {
    id: 't7',
    type: 'speak',
    ask_ru: 'Повтори за Нейтом вслух.',
    mode: 'repeat',
    say: 'Nice to meet you!',
  },
];

const lesson = {
  id: 'a0-m1-l1',
  level: 'a0',
  title: { ru: 'Привет, я…', en: "Hello, I'm…" },
  goal_ru: 'После урока ты сможешь поздороваться и назвать своё имя.',
  words: [{ en: 'hello', ru: 'привет' }],
  grammar: {
    title_ru: "I'm = I am; My name is…",
    explain_ru: 'По-русски говорим «Я Кирилл» — без глагола. По-английски глагол нужен всегда.',
    explain_en: "Say your name: I'm Kirill.",
    examples: [{ en: "I'm Kirill.", ru: 'Я Кирилл.' }],
    mistakes: [{ wrong: 'I Kirill.', right: "I'm Kirill.", why_ru: 'Нужен глагол am.' }],
  },
  tasks,
  homework: { about_ru: 'Две минуты голосом.', tasks: [] },
  pass: { min_accuracy: 0.7, min_speak: 1, about_ru: 'Пройден, если верно 70% и сказал вслух.' },
};

const level = {
  id: 'a0',
  cefr: 'Pre-A1',
  title_ru: 'Старт: с нуля',
  about_ru: '',
  tutor_mode: 'ru_heavy',
  tutor_rules_ru: 'Объясняет по-русски.',
  boss: 'a0-m3-l4',
};

function game(over: Record<string, unknown> = {}) {
  return {
    xp: 0,
    rank: 'Кварк',
    next_rank: 'Электрон',
    next_rank_xp: 100,
    streak: 0,
    best_streak: 0,
    freezes: 1,
    lost_streak: 0,
    minutes_today: 0,
    goal_minutes: 10,
    ring: false,
    week: Array.from({ length: 7 }, (_, i) => ({
      day: `2026-10-${17 + i}`,
      weekday: ((i + 5) % 7) + 1,
      minutes: 0,
      counted: false,
      frozen: false,
    })),
    quests: [
      { id: 'minutes', title: 'Позанимайся 10 минут', counter: 'seconds', target: 600, done: 0 },
      { id: 'lesson', title: 'Пройди урок', counter: 'lessons', target: 1, done: 0 },
      { id: 'speak', title: 'Скажи вслух 5 фраз', counter: 'speak', target: 5, done: 0 },
    ],
    frozen: 0,
    badges: [
      { id: 'first_lesson', title: 'Первое слово', how: 'первый урок пройден', open: false },
    ],
    particles: [
      { id: 'spark', title: 'Искра', how: 'сразу', gives: 'живёт с огоньком', open: true },
      { id: 'echo', title: 'Эхо', how: '20 заданий «на слух»', gives: 'Диктант', open: false },
    ],
    ...over,
  };
}

const step = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id,
  level: 'a0',
  module: 'a0-m1',
  module_title_ru: 'Привет!',
  title_ru: title,
  goal_ru: 'После урока ты сможешь поздороваться и назвать своё имя.',
  detail: 'full',
  skipped: false,
  repeat: null,
  notes: [],
  passed: false,
  ready: true,
  homework: null,
  ...over,
});

function delta(over: Record<string, unknown> = {}) {
  return {
    xp: 1,
    xp_total: 1,
    streak: 0,
    streak_up: false,
    minutes: 1,
    goal_minutes: 10,
    ring_closed: false,
    quests_closed: false,
    unlocked: [],
    ...over,
  };
}

async function mockLessons(page: Page, placed = true) {
  const state = { placed, passed: false };
  const calls = { answers: [] as Record<string, unknown>[], place: 0, phrase: 0 };
  await page.route('**/api/v1/english/home', (route) =>
    route.fulfill({
      json: {
        learner: {
          level: 'a0',
          placed_at: state.placed ? '2026-10-23T10:00:00Z' : null,
          goal_minutes: 10,
          strictness: 2,
          voice: null,
          remind: true,
          remind_at: '18:00',
          rest_weekday: null,
          paused_until: null,
          companion: null,
        },
        levels: [level, { ...level, id: 'a1', title_ru: 'Моя жизнь' }],
        steps: [
          step('a0-m1-l1', 'Привет, я…', { passed: state.passed }),
          step('a0-m1-l2', 'Как дела?', {
            notes: state.passed ? ['давить на am / is'] : [],
          }),
        ],
        ops: state.passed
          ? [
              {
                id: 'op1',
                op: 'note',
                lesson: 'a0-m1-l2',
                summary: 'заметка к «Как дела?»',
                state: 'applied',
              },
            ]
          : [],
        next: state.passed ? 'a0-m1-l2' : 'a0-m1-l1',
        review_due: state.passed ? 1 : 0,
        game: state.passed ? game({ xp: 26, streak: 1, best_streak: 1, minutes_today: 6 }) : game(),
      },
    }),
  );
  await page.route('**/api/v1/english/placement', (route) => {
    if (route.request().method() === 'POST') {
      calls.place += 1;
      state.placed = true;
      return route.fulfill({
        json: { level: 'a0', start_lesson: 'a0-m1-l1', stages: [] },
      });
    }
    return route.fulfill({
      json: {
        about_ru: '',
        minutes: 5,
        stages: [
          {
            level: 'a0',
            pass_min: 3,
            items: [
              {
                id: 'p1',
                type: 'choose',
                ask_ru: 'Как сказать «Привет»?',
                options: ['Hello', 'Bye'],
                answer: 'Hello',
              },
            ],
          },
        ],
      },
    });
  });
  await page.route('**/api/v1/english/lessons/a0-m1-l1', (route) =>
    route.fulfill({
      json: { lesson, level, passed: false, run: null, homework_task: null, strictness: 2 },
    }),
  );
  await page.route('**/api/v1/english/lessons/*/start', (route) =>
    route.fulfill({
      json: { id: 'run-1', lesson_id: 'a0-m1-l1', kind: 'lesson', answers: [], tasks: [] },
    }),
  );
  await page.route('**/api/v1/english/runs/run-1/answer', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    calls.answers.push(body);
    const id = body.task_id as string;
    const tries = calls.answers.filter((a) => a.task_id === id).length;
    if (id === 't1' && tries === 1) {
      return route.fulfill({
        json: {
          task_id: 't1',
          correct: false,
          attempts: 1,
          right: "I'm Kirill.",
          explain_ru: 'I’m = I am. Без am не бывает.',
          say: null,
          mistakes: [],
          heard: null,
          offline: false,
          game: delta({ xp: 0 }),
        },
      });
    }
    const voice = 'audio_base64' in body;
    return route.fulfill({
      json: {
        task_id: id,
        correct: true,
        attempts: tries,
        right: null,
        explain_ru: null,
        say: voice ? 'Fine. Finally.' : null,
        mistakes: [],
        heard: voice ? 'nice to meet you' : null,
        offline: false,
        game: delta({ xp: voice ? 2 : 1, xp_total: calls.answers.length }),
      },
    });
  });
  await page.route('**/api/v1/english/runs/run-1/finish', (route) => {
    state.passed = true;
    return route.fulfill({
      json: {
        passed: true,
        accuracy: 1,
        spoken: 1,
        need_accuracy: 0.7,
        need_speak: 1,
        missing: [],
        review_ru: 'Путаешь am и is. Повтори: I am, he is.',
        program_actions: ['op1'],
        homework_task: 'task-1',
        game: delta({
          xp: 20,
          xp_total: 26,
          streak: 1,
          streak_up: true,
          unlocked: [{ kind: 'badge', id: 'first_lesson', title: 'Первое слово' }],
        }),
      },
    });
  });
  await page.route('**/api/v1/english/phrase', (route) => {
    calls.phrase += 1;
    return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: 'ID3-FAKE' });
  });
  return calls;
}

test('урок: теория → задания → голос → огонёк и опыт, домашка в Planner', async ({ page }) => {
  await fakeMedia(page);
  await mockSync(page);
  const calls = await mockLessons(page);
  await page.goto('/agent?tab=english');

  // Главная модуля: кольцо дня, огонёк, задания дня, следующий урок.
  await expect(page.getByRole('img', { name: 'Сегодня 0 из 10 минут' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Задания дня' })).toContainText('Пройди урок');
  await noSideScroll(page);
  await shot(page, 'home');
  await page.getByRole('button', { name: 'Начать урок' }).click();

  // Теория: Нейт объясняет по-русски (уровень A0), пример можно послушать.
  const theory = page.getByRole('region', { name: 'Теория' });
  await expect(theory).toContainText('По-английски глагол нужен всегда');
  await expect(theory).toContainText('Так не говори');
  await theory.getByRole('button', { name: 'Послушать' }).first().click();
  await expect.poll(() => calls.phrase).toBe(1);
  await noSideScroll(page);
  await shot(page, 'theory');
  await page.getByRole('button', { name: 'К заданиям' }).click();

  // 1. Выбрать: ошибка → как правильно и почему; «Ещё раз» → верно.
  const task = page.getByRole('region', { name: 'Задание' });
  await expect(task).toContainText('Выбери');
  await task.getByRole('button', { name: 'I Kirill.' }).click();
  await expect(task.getByRole('status')).toContainText('Неверно');
  await expect(task).toContainText("Правильно: I'm Kirill.");
  // видно, что выбрал и что было верно (ENG-006)
  await expect(task.getByRole('button', { name: 'I Kirill.' })).toHaveAttribute(
    'data-state',
    'bad',
  );
  await expect(task.getByRole('button', { name: "I'm Kirill." })).toHaveAttribute(
    'data-state',
    'ok',
  );
  await shot(page, 'mistake');
  await task.getByRole('button', { name: 'Ещё раз' }).click();
  await task.getByRole('button', { name: "I'm Kirill." }).click();
  await expect(task.getByRole('status')).toContainText('Верно');
  await expect(page.getByText('+1 XP')).toBeVisible();
  await task.getByRole('button', { name: 'Дальше' }).click();

  // 2. Собрать фразу из плиток.
  await expect(task).toContainText('Собери фразу');
  for (const w of ["What's", 'your', 'name?']) {
    await task.getByRole('group', { name: 'Плитки' }).getByRole('button', { name: w }).click();
  }
  await task.getByRole('button', { name: 'Проверить' }).click();
  expect(calls.answers.at(-1)).toMatchObject({ task_id: 't4', answer: "What's your name?" });
  await task.getByRole('button', { name: 'Дальше' }).click();

  // 3. Повторить вслух: запись голоса уходит на сервер, Нейт услышал и засчитал.
  await expect(task).toContainText('Повтори вслух');
  await task.getByRole('button', { name: 'Говорить' }).click();
  await page.waitForTimeout(500);
  await task.getByRole('button', { name: 'Готово' }).click();
  await expect(task).toContainText('Нейт услышал: «nice to meet you»');
  expect(calls.answers.at(-1)).toMatchObject({ task_id: 't7', mime: 'audio/webm;codecs=opus' });
  expect(calls.answers.at(-1)!.audio_base64).toBeTruthy();
  await noSideScroll(page);
  await shot(page, 'voice');
  await task.getByRole('button', { name: 'Закончить' }).click();

  // Итог: пройден, огонёк, опыт, достижение, разбор, домашка.
  const result = page.getByRole('region', { name: 'Итог' });
  await expect(result).toContainText('Урок пройден');
  await expect(result).toContainText('+20 XP');
  await expect(result).toContainText('огонёк 1 день');
  await expect(result).toContainText('достижение «Первое слово»');
  await expect(result).toContainText('Путаешь am и is');
  await expect(result).toContainText('Домашка — уже в Planner');
  await noSideScroll(page);
  await shot(page, 'result');
  await result.getByRole('button', { name: 'К урокам' }).click();

  // Главная: следующий урок с заметкой Нейта, огонёк, повторение ошибок.
  await expect(page.getByRole('region', { name: 'Следующий урок' })).toContainText('Как дела?');
  await expect(page.getByText('Нейт: давить на am / is')).toBeVisible();
  await expect(page.getByText('Повторить ошибки: 1')).toBeVisible();
  await expect(page.getByLabel('Огонёк: 1 день')).toBeVisible();
});

test('новичок: входной тест → уровень; игра и настройки', async ({ page }) => {
  await mockSync(page);
  const calls = await mockLessons(page, false);
  await page.route('**/api/v1/english/settings', (route) =>
    route.fulfill({
      json: {
        settings: {
          level: 'a0',
          placed_at: null,
          goal_minutes: 10,
          strictness: 2,
          voice: null,
          remind: true,
          remind_at: '18:00',
          rest_weekday: null,
          paused_until: null,
          companion: null,
        },
        voices: [
          { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', about: 'британский' },
          { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', about: 'строгий' },
        ],
        sample: "Hi, I'm Nate.",
      },
    }),
  );
  await page.goto('/agent?tab=english');
  await expect(page.getByRole('region', { name: 'Входной тест' })).toContainText('С чего начнём?');
  await shot(page, 'placement');
  await page.getByRole('button', { name: 'Пройти тест' }).click();
  await page.getByRole('button', { name: 'Hello' }).click();
  await page.getByRole('button', { name: 'Нормально' }).click();
  await expect.poll(() => calls.place).toBe(1);
  await expect(page.getByRole('button', { name: 'Начать урок' })).toBeVisible();

  await page.getByRole('radio', { name: 'Игра' }).click();
  await expect(page.getByRole('region', { name: 'Частицы' })).toContainText('Искра');
  await expect(page.getByRole('region', { name: 'Достижения' })).toContainText('Первое слово');
  await noSideScroll(page);
  await shot(page, 'game');

  await page.getByRole('radio', { name: 'Настройки' }).click();
  const settings = page.getByRole('region', { name: 'Настройки английского' });
  await expect(settings).toContainText('Голос Нейта');
  await expect(settings.getByRole('radio', { name: 'Строже' })).toBeVisible();
  await settings.getByRole('button', { name: 'Послушать' }).nth(1).click();
  await expect.poll(() => calls.phrase).toBe(1);
  await noSideScroll(page);
  await shot(page, 'settings');
});

test.describe('телефон, пальцем (ENG-006)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('«Соедини»: выбранное и пары видны, пару можно разъединить, после проверки — что верно', async ({
    page,
  }) => {
    await mockSync(page);
    const calls = await mockLessons(page);
    const match = {
      id: 't1',
      type: 'match',
      ask_ru: 'Соедини слово и перевод.',
      pairs: [
        { en: 'hello', ru: 'привет' },
        { en: 'bye', ru: 'пока' },
        { en: 'name', ru: 'имя' },
      ],
    };
    await page.route('**/api/v1/english/lessons/a0-m1-l1', (route) =>
      route.fulfill({
        json: {
          lesson: { ...lesson, tasks: [match, tasks[0]] },
          level,
          passed: false,
          run: null,
          homework_task: null,
          strictness: 2,
        },
      }),
    );
    const answers: unknown[] = [];
    await page.route('**/api/v1/english/runs/run-1/answer', async (route) => {
      const body = route.request().postDataJSON() as { answer: unknown };
      answers.push(body.answer);
      const ok = answers.length > 1;
      await route.fulfill({
        json: {
          task_id: 't1',
          correct: ok,
          attempts: answers.length,
          right: ok ? null : 'hello — привет, bye — пока, name — имя',
          explain_ru: null,
          say: null,
          mistakes: [],
          heard: null,
          offline: false,
          game: delta({ xp: ok ? 1 : 0 }),
        },
      });
    });
    const marks: Record<string, unknown>[] = [];
    await page.route('**/api/v1/english/runs/run-1/feedback', async (route) => {
      marks.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        json: { action: 'a1', summary_ru: 'Понял. Задание вернётся завтра в повторении.' },
      });
    });
    await page.route('**/api/v1/english/lessons/a0-m1-l1/ask', (route) =>
      route.fulfill({ json: { say: 'Hello — это «привет». Now, back to work!' } }),
    );

    await page.goto('/agent?tab=english');
    await page.getByRole('button', { name: 'Начать урок' }).tap();
    await page.getByRole('button', { name: 'К заданиям' }).tap();
    const task = page.getByRole('region', { name: 'Задание' });
    const en = (w: string) =>
      task.getByRole('group', { name: 'Английские слова' }).getByRole('button', { name: w });
    const ru = (w: string) =>
      task.getByRole('group', { name: 'Перевод' }).getByRole('button', { name: w });

    // Нажал слово — оно заметно выбрано, подсказка — что дальше.
    await en('hello').tap();
    await expect(en('hello')).toHaveAttribute('aria-pressed', 'true');
    await expect(en('hello')).toHaveAttribute('data-state', 'picked');
    await expect(task).toContainText('Выбрано «hello»');
    // Пара — номер и цвет с обеих сторон.
    await ru('пока').tap();
    await expect(en('hello')).toHaveAttribute('data-pair', '1');
    await expect(ru('пока')).toHaveAttribute('data-pair', '1');
    await expect(en('hello')).toHaveAccessibleName('hello, пара 1');
    // Можно начать и с перевода.
    await ru('имя').tap();
    await en('name').tap();
    await expect(en('name')).toHaveAttribute('data-pair', '2');
    await expect(ru('имя')).toHaveAttribute('data-pair', '2');
    await expect(task.getByRole('button', { name: 'Проверить' })).toBeDisabled();
    await expect(task).toContainText('Соединено 2 из 3');
    // Нажал на пару — разъединил.
    await ru('пока').tap();
    await expect(en('hello')).not.toHaveAttribute('data-pair');
    await expect(ru('пока')).toHaveAttribute('aria-pressed', 'true');
    await en('hello').tap();
    await en('bye').tap();
    await ru('привет').tap();
    await noSideScroll(page);
    // Кнопки — под палец.
    for (const b of [en('hello'), ru('привет')]) {
      const box = await b.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await task.getByRole('button', { name: 'Проверить' }).tap();
    expect(answers[0]).toEqual([
      ['name', 'имя'],
      ['hello', 'пока'],
      ['bye', 'привет'],
    ]);
    // После проверки у каждой пары видно, верна ли она.
    await expect(task).toContainText('Верных пар: 1 из 3');
    await expect(en('name')).toHaveAttribute('data-state', 'ok');
    await expect(ru('имя')).toHaveAttribute('data-state', 'ok');
    await expect(en('hello')).toHaveAttribute('data-state', 'bad');
    await expect(ru('привет')).toHaveAttribute('data-state', 'bad');

    // «Что-то не так?» → «Слишком трудно», «Объясни».
    await task.getByRole('button', { name: 'Что-то не так?' }).tap();
    const sheet = page.getByRole('dialog', { name: 'Что с заданием?' });
    await sheet.getByRole('button', { name: /Слишком трудно/ }).tap();
    await expect(sheet).toContainText('вернётся завтра в повторении');
    expect(marks[0]).toMatchObject({ task_id: 't1', kind: 'hard' });
    await sheet.getByRole('button', { name: /Объясни/ }).tap();
    await expect(sheet).toContainText('Нейт: Hello — это «привет»');
    await page.keyboard.press('Escape');
    await expect(task.getByRole('button', { name: 'Отмечено: слишком трудно' })).toBeVisible();

    // «Ещё раз»: верная пара осталась, остальные — заново.
    await task.getByRole('button', { name: 'Ещё раз' }).tap();
    await expect(en('name')).toHaveAttribute('data-pair', '1');
    await expect(en('hello')).not.toHaveAttribute('data-pair');
    await en('hello').tap();
    await ru('привет').tap();
    await en('bye').tap();
    await ru('пока').tap();
    await task.getByRole('button', { name: 'Проверить' }).tap();
    await expect(task.getByRole('status')).toContainText('Верно');
    await expect(en('bye')).toHaveAttribute('data-state', 'ok');
    expect(answers[1]).toEqual([
      ['name', 'имя'],
      ['hello', 'привет'],
      ['bye', 'пока'],
    ]);
    // Enter — дальше: фокус уже на «Дальше».
    await page.keyboard.press('Enter');
    await expect(task).toContainText('Выбери');
    expect(calls.answers).toHaveLength(0);
    await shot(page, 'match');
  });
});
