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

async function mockVerbs(page: Page) {
  const progress = new Map<string, Progress>(SET.map(([id]) => [id, fresh()]));
  const calls: Record<string, unknown>[] = [];
  const body = () => {
    const verbs = SET.map(([id, v2, v3, ru, group]) => ({
      id,
      v1: id,
      v2,
      v3,
      v2_alt: [],
      v3_alt: [],
      ru,
      group,
      progress: progress.get(id)!,
    }));
    const count = (ok: (p: Progress) => boolean) => verbs.filter((v) => ok(v.progress)).length;
    return {
      groups: [
        { id: 'same', title_ru: 'Все три одинаковые', hint: 'hit – hit – hit' },
        { id: 'i-a-u', title_ru: 'i → a → u', hint: 'drink – drank – drunk' },
      ],
      verbs,
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
    };
    calls.push(sent);
    const verb = SET.find(([id]) => id === sent.verb_id)!;
    const correct = sent.given
      ? sent.given.v2 === verb[1] && sent.given.v3 === verb[2]
      : sent.grade !== 'again';
    const before = progress.get(sent.verb_id)!;
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
