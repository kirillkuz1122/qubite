import { expect, test, type Page } from '@playwright/test';
import { mockSync } from './sync-mock';

/*
 * Вкладка «Глаголы» (ENG-008): сервер подделан (набор, сверка форм, срок повторения), браузер
 * настоящий. Письменное занятие целиком: новые глаголы показывают → впиши формы → ошибка
 * возвращает глагол → итог; потом карточки по трудным. На 360 px — без прокрутки вбок.
 */

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

interface Progress {
  new: boolean;
  due: boolean;
  hard: boolean;
  learned: boolean;
  reps: number;
  lapses: number;
  interval_days: number;
  due_on: string | null;
}

const TODAY = '2026-11-16';
const fresh = (): Progress => ({
  new: true,
  due: true,
  hard: false,
  learned: false,
  reps: 0,
  lapses: 0,
  interval_days: 0,
  due_on: null,
});
const SET = [
  ['cut', 'cut', 'cut', 'резать', 'same'],
  ['put', 'put', 'put', 'класть', 'same'],
  ['sing', 'sang', 'sung', 'петь', 'i-a-u'],
  // Длинный глагол — проверка переноса на телефоне.
  ['misunderstand', 'misunderstood', 'misunderstood', 'неправильно понять', 'i-a-u'],
] as const;
const game = {
  xp: 2,
  xp_total: 12,
  streak: 0,
  streak_up: false,
  minutes: 1,
  goal_minutes: 10,
  ring_closed: false,
  quests_closed: false,
  unlocked: [],
};

/** `started` — глаголы уже учились (для игр): сегодня их пора повторять. */
async function mockVerbs(page: Page, started = false) {
  const begun = (): Progress => ({
    ...fresh(),
    new: false,
    reps: 2,
    interval_days: 3,
    due_on: TODAY,
  });
  const progress = new Map<string, Progress>(SET.map(([id]) => [id, started ? begun() : fresh()]));
  const sets: Record<string, unknown>[] = [];
  const mine: { id: string; v1: string; v2: string; v3: string; ru: string }[] = [];
  const calls: Record<string, unknown>[] = [];
  const body = () => {
    const verbs = [
      ...SET.map(([id, v2, v3, ru, group]) => ({ id, v1: id, v2, v3, ru, group })),
      ...mine.map((v) => ({ ...v, group: 'my' })),
    ].map((v) => ({ ...v, v2_alt: [], v3_alt: [], progress: progress.get(v.id) ?? fresh() }));
    const count = (ok: (p: Progress) => boolean) => verbs.filter((v) => ok(v.progress)).length;
    return {
      groups: [
        { id: 'same', title_ru: 'Все три одинаковые', hint: 'hit – hit – hit' },
        { id: 'i-a-u', title_ru: 'i → a → u', hint: 'drink – drank – drunk' },
      ],
      verbs,
      sets,
      counts: {
        total: verbs.length,
        started: count((p) => !p.new),
        learned: count((p) => p.learned),
        due: count((p) => !p.new && p.due),
        hard: count((p) => p.hard),
      },
      today: TODAY,
    };
  };
  await page.route('**/api/v1/english/home', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/v1/english/verbs', (route) => route.fulfill({ json: body() }));
  await page.route('**/api/v1/english/verbs/answer', async (route) => {
    const sent = route.request().postDataJSON() as {
      verb_id: string;
      mode: string;
      given?: { v2: string; v3: string };
      grade?: string;
      correct?: boolean;
    };
    calls.push(sent);
    const own = mine.find((v) => v.id === sent.verb_id);
    const verb = own
      ? ([own.v1, own.v2, own.v3] as const)
      : SET.find(([id]) => id === sent.verb_id)!;
    const correct = sent.given
      ? sent.given.v2 === verb[1] && sent.given.v3 === verb[2]
      : (sent.correct ?? sent.grade !== 'again');
    const before = progress.get(sent.verb_id) ?? fresh();
    const next: Progress = correct
      ? { ...before, new: false, due: false, reps: 1, interval_days: 1, due_on: '2026-11-17' }
      : {
          ...before,
          new: false,
          due: true,
          hard: true,
          lapses: before.lapses + 1,
          interval_days: 0,
          due_on: TODAY,
        };
    progress.set(sent.verb_id, next);
    await route.fulfill({
      json: {
        verb_id: sent.verb_id,
        correct,
        expected: { v1: verb[0], v2: verb[1], v3: verb[2] },
        progress: next,
        moved: true,
        game: { ...game, xp: correct ? 2 : 0 },
      },
    });
  });
  await page.route('**/api/v1/english/verbs/recognize', async (route) => {
    const sent = route.request().postDataJSON() as { text?: string; image_base64?: string };
    calls.push({ recognize: sent.text ? 'text' : 'photo', mime: (sent as { mime?: string }).mime });
    await route.fulfill({
      json: {
        verbs: [
          { v1: 'sing', v2: 'sang', v3: 'sung', ru: 'петь', known: 'sing' },
          { v1: 'google', v2: 'googled', v3: 'googled', ru: 'гуглить', known: null },
        ],
      },
    });
  });
  await page.route('**/api/v1/english/verbs/sets', async (route) => {
    const sent = route.request().postDataJSON() as {
      title: string;
      source: string;
      verbs: { v1: string; v2: string; v3: string; ru: string }[];
    };
    calls.push({ set: sent.title, source: sent.source, verbs: sent.verbs.map((v) => v.v1) });
    const ids = sent.verbs.map((v) => {
      if (SET.some(([id]) => id === v.v1)) return v.v1;
      mine.push({ id: `my:${v.v1}`, ...v });
      return `my:${v.v1}`;
    });
    sets.unshift({
      id: 'set-1',
      title: sent.title,
      source: sent.source,
      verb_ids: ids,
      created_at: '2026-11-16T10:00:00Z',
    });
    await route.fulfill({ json: body() });
  });
  await page.route('**/api/v1/english/verbs/sets/set-1', async (route) => {
    calls.push({ deleted: 'set-1' });
    sets.length = 0;
    await route.fulfill({ json: body() });
  });
  return calls;
}

const type = async (page: Page, v2: string, v3: string) => {
  await page.getByLabel('Вторая форма (V2)').fill(v2);
  await page.getByLabel('Третья форма (V3)').fill(v3);
};

test('глаголы: группы → письменное занятие с возвратом ошибки → карточки по трудным', async ({
  page,
}) => {
  await mockSync(page);
  const calls = await mockVerbs(page);
  await page.goto('/agent?tab=english&view=verbs');

  // Вкладка: счётчики и группы по звучанию.
  const card = page.getByRole('region', { name: 'Неправильные глаголы' });
  await expect(card).toContainText('Начни с первой группы');
  await expect(card.getByRole('list', { name: 'Прогресс' })).toContainText('0 начато');
  await noSideScroll(page);

  // Группа: все формы, длинный глагол не ломает раскладку.
  await page.getByRole('button', { name: /i → a → u/ }).click();
  const sheet = page.getByRole('dialog', { name: 'i → a → u' });
  await expect(sheet.getByText('sing – sang – sung')).toBeVisible();
  await expect(sheet.getByText('misunderstand – misunderstood – misunderstood')).toBeVisible();
  await noSideScroll(page);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // Письменно: новые сначала показывают.
  await page.getByRole('button', { name: 'Заниматься' }).click();
  const trainer = page.getByRole('dialog', { name: 'Тренажёр глаголов' });
  await expect(trainer.getByText('Посмотри и запомни')).toBeVisible();
  await expect(trainer.getByText('cut – cut – cut')).toBeVisible();
  await noSideScroll(page);
  await trainer.getByRole('button', { name: 'Запомнил — проверь' }).click();

  // Ошибка: видно, как правильно, глагол вернётся в этом же занятии.
  await expect(trainer.getByText('Глагол 1 из 4')).toBeVisible();
  await expect(trainer.getByRole('button', { name: 'Проверить' })).toBeDisabled();
  await type(page, 'cutted', 'cut');
  await trainer.getByRole('button', { name: 'Проверить' }).click();
  await expect(trainer.getByText('Правильно: cut – cut – cut')).toBeVisible();
  await expect(trainer.getByText('Правильно: cut', { exact: true })).toBeVisible();
  await noSideScroll(page);
  await trainer.getByRole('button', { name: 'Дальше' }).click();
  await expect(trainer.getByText('Глагол 2 из 5')).toBeVisible();

  // Дальше — с клавиатуры: Enter в первом поле ведёт во второе, во втором — проверяет.
  for (const [v1, v2, v3] of [
    ['put', 'put', 'put'],
    ['sing', 'sang', 'sung'],
    ['misunderstand', 'misunderstood', 'misunderstood'],
    ['cut', 'cut', 'cut'],
  ] as const) {
    await expect(trainer.locator('.vb-word')).toHaveText(v1);
    await page.getByLabel('Вторая форма (V2)').fill(v2);
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Третья форма (V3)')).toBeFocused();
    await page.keyboard.type(v3);
    await page.keyboard.press('Enter');
    await expect(trainer.getByText('Верно!')).toBeVisible();
    await page.keyboard.press('Enter');
  }

  // Итог: что с первого раза, что вернётся.
  const result = trainer.getByRole('region', { name: 'Итог занятия' });
  await expect(result).toContainText('С первого раза: 3 из 4');
  await expect(result).toContainText('cut – cut – cut');
  await expect(result).toContainText('+8 XP');
  await noSideScroll(page);
  expect(calls).toHaveLength(5);
  expect(calls[0]).toEqual({ verb_id: 'cut', mode: 'type', given: { v2: 'cutted', v3: 'cut' } });
  await trainer.getByRole('button', { name: 'Готово' }).click();
  await expect(trainer).toBeHidden();

  // Вкладка обновилась: трудный глагол виден, по нему — карточки.
  await expect(card.getByRole('list', { name: 'Прогресс' })).toContainText('4 начато');
  await page.getByRole('radio', { name: 'Карточки' }).click();
  await page.getByRole('button', { name: 'Трудные: 1' }).click();
  await expect(trainer.locator('.vb-word')).toHaveText('cut');
  await expect(trainer.locator('.vb-answer')).toBeHidden();
  await trainer.getByRole('button', { name: 'Показать формы' }).click();
  await expect(trainer.locator('.vb-answer')).toHaveText('cut · cut');
  await trainer.getByRole('button', { name: 'Знал', exact: true }).click();
  await expect(trainer.getByRole('region', { name: 'Итог занятия' })).toBeVisible();
  expect(calls.at(-1)).toEqual({ verb_id: 'cut', mode: 'cards', grade: 'good' });
});

test('глаголы: игры — соедини, викторина, поиск слов; свои слова списком и с фото', async ({
  page,
}) => {
  await mockSync(page);
  const calls = await mockVerbs(page, true);
  await page.goto('/agent?tab=english&view=verbs');
  const trainer = page.getByRole('dialog', { name: 'Тренажёр глаголов' });
  const done = async () => {
    await expect(trainer.getByRole('region', { name: 'Итог занятия' })).toBeVisible();
    await noSideScroll(page);
    await trainer.getByRole('button', { name: 'Готово' }).click();
    await expect(trainer).toBeHidden();
  };

  // «Соедини»: все пары с первого раза.
  await page.getByRole('button', { name: /^Соедини/ }).click();
  const left = trainer.getByRole('group', { name: 'Первая форма' });
  const right = trainer.getByRole('group', { name: 'Вторая и третья форма' });
  await noSideScroll(page);
  for (const [v1, v2, v3] of SET) {
    await left.getByRole('button', { name: v1, exact: true }).click();
    await right.getByRole('button', { name: `${v2} · ${v3}`, exact: true }).click();
  }
  await expect(trainer.getByText('С первого раза: 4 из 4')).toBeVisible();
  expect(calls.filter((c) => c.mode === 'match')).toHaveLength(4);
  await done();

  // «Викторина»: один вопрос, четыре варианта, после ответа — «Дальше».
  await page.getByRole('button', { name: /^Викторина/ }).click();
  const options = trainer.getByRole('group', { name: 'Варианты' }).getByRole('button');
  await expect(options).toHaveCount(4);
  await noSideScroll(page);
  await options.first().click();
  await expect(trainer.getByRole('button', { name: 'Дальше' })).toBeVisible();
  expect(calls.at(-1)).toMatchObject({ mode: 'quiz' });
  await trainer.getByRole('button', { name: 'Закрыть' }).click();
  await expect(trainer).toBeHidden();

  // «Поиск слов»: таблица 7×7 помещается на телефоне; «Сдаюсь» записывает ненайденное.
  await page.getByRole('button', { name: /^Поиск слов/ }).click();
  await expect(trainer.getByRole('gridcell')).toHaveCount(49);
  await noSideScroll(page);
  await trainer.getByRole('gridcell').first().click();
  await expect(trainer.getByText('Теперь нажми последнюю букву слова')).toBeVisible();
  await trainer.getByRole('button', { name: 'Сдаюсь' }).click();
  await expect(trainer.getByText(/С первого раза: 0 из \d/)).toBeVisible();
  await done();

  // Свои слова списком: найденное можно проверить и сохранить набором.
  await page.getByRole('button', { name: 'Добавить' }).click();
  const add = page.getByRole('dialog', { name: 'Свои слова' });
  await add.getByRole('textbox').fill('sing\ngoogle – googled – googled – гуглить');
  await add.getByRole('button', { name: 'Найти глаголы' }).click();
  await expect(add.getByText('google – googled – googled')).toBeVisible();
  await expect(add.getByText(/петь · есть в Qubite/)).toBeVisible();
  await noSideScroll(page);
  await add.getByLabel('Название набора').fill('Домашка на среду');
  await add.getByRole('button', { name: 'Сохранить набор' }).click();
  await expect(add).toBeHidden();
  expect(calls.at(-1)).toEqual({
    set: 'Домашка на среду',
    source: 'text',
    verbs: ['sing', 'google'],
  });

  // Набор в списке: открыть, выучить письменно свой глагол, удалить.
  await page.getByRole('button', { name: /Домашка на среду/ }).click();
  const set = page.getByRole('dialog', { name: 'Домашка на среду' });
  await expect(set.getByText('google – googled – googled')).toBeVisible();
  await set.getByRole('button', { name: 'Учить набор' }).click();
  await expect(trainer.getByText('Посмотри и запомни')).toBeVisible();
  await trainer.getByRole('button', { name: 'Закрыть' }).click();
  await page.getByRole('button', { name: /Домашка на среду/ }).click();
  await set.getByRole('button', { name: 'Удалить набор' }).click();
  await expect(set).toBeHidden();
  await expect(page.getByText(/Добавь свои слова списком или с фото/)).toBeVisible();

  // С фото: файл уходит на распознавание картинкой.
  await page.getByRole('button', { name: 'Добавить' }).click();
  await add.getByLabel('Фото со словами').setInputFiles({
    name: 'board.png',
    mimeType: 'image/png',
    // 1×1 PNG.
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(add.getByText('Нашёл глаголов: 2.', { exact: false })).toBeVisible();
  expect(calls.at(-1)).toMatchObject({ recognize: 'photo' });
});
