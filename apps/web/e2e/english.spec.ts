import { expect, test, type Page } from '@playwright/test';
import { mockSync } from './sync-mock';

/*
 * «Английский» (ENG-001): сервер подделан (ответы репетитора и речь), микрофон и проигрывание —
 * поддельные (браузер настоящий). Разговор голосом и текстом, ошибки, «повтори», живой Нейт,
 * распознанное не пропадает при отказе, «Закончить».
 */

/** Поддельный микрофон и звук: запись — несколько байт, «проигрывание» длится 1,5 с. */
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
      value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
      },
    });
    // поддельные байты речи браузер не раскодирует: элемент без загрузки, только «play»
    Object.defineProperty(window, 'Audio', {
      value: function FakeAudio(src?: string) {
        const el = document.createElement('audio');
        el.dataset.src = src ?? '';
        return el;
      },
    });
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      setTimeout(() => this.dispatchEvent(new Event('ended')), 1500);
      return Promise.resolve();
    };
  });
}

const now = () => new Date().toISOString();

function message(over: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    seq: 1,
    role: 'tutor',
    text: '',
    via: 'text',
    verdict: 'none',
    mistakes: [],
    repeat: '',
    repeated: false,
    has_speech: false,
    at: now(),
    ...over,
  };
}

function session(over: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    started_at: now(),
    last_at: now(),
    finished_at: null,
    turns: 0,
    correct: 0,
    mistakes: 0,
    memory_action: null,
    ...over,
  };
}

async function mockEnglish(page: Page, voice = { listen: true, speak: true }) {
  const state = {
    session: null as ReturnType<typeof session> | null,
    messages: [] as ReturnType<typeof message>[],
  };
  const calls = { turns: [] as Record<string, unknown>[], speech: 0, finish: 0 };
  const replies = [
    {
      verdict: 'mistake',
      text: '"I goed"? Seriously? Go is irregular: went. Say it again: I went to school yesterday.',
      mistakes: [{ wrong: 'I goed', right: 'I went', why: 'go — неправильный глагол: went' }],
      repeat: 'I went to school yesterday.',
      learner: 'I goed to school yesterday',
      via: 'voice',
    },
    {
      verdict: 'ok',
      text: 'Fine. Finally. What did you do there?',
      mistakes: [],
      repeat: '',
      repeated: true,
      learner: 'I went to school yesterday.',
      via: 'text',
    },
  ];
  await page.route('**/api/v1/english', (route) =>
    route.fulfill({
      json: {
        session: state.session,
        messages: state.messages,
        last: null,
        totals: { sessions: 0, turns: 0, correct: 0, mistakes: 0 },
        voice,
      },
    }),
  );
  await page.route('**/api/v1/english/session', (route) => {
    state.session = session();
    state.messages = [
      message({
        text: 'Oh, look who finally showed up. Tell me about your day. In English, please.',
      }),
    ];
    return route.fulfill({ json: { session: state.session, messages: state.messages } });
  });
  await page.route('**/api/v1/english/session/finish', (route) => {
    calls.finish += 1;
    const done = session({ finished_at: now(), turns: 2, memory_action: crypto.randomUUID() });
    state.session = null;
    state.messages = [];
    return route.fulfill({ json: { session: done } });
  });
  await page.route('**/api/v1/english/turn', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    calls.turns.push(body);
    const next = replies.shift();
    if (!next)
      return route.fulfill({
        status: 409,
        json: {
          error: 'budget_exhausted',
          message:
            'AI-лимит исчерпан (user, day, usd). Можно сохранить без AI или попросить владельца',
          heard: 'My name is Kirill',
        },
      });
    const learner = message({ role: 'learner', text: next.learner, via: next.via, verdict: null });
    const tutor = message({
      text: next.text,
      verdict: next.verdict,
      mistakes: next.mistakes,
      repeat: next.repeat,
      repeated: next.repeated ?? false,
    });
    state.messages.push(learner, tutor);
    return route.fulfill({
      json: { session: session({ turns: 1 }), learner, tutor, cost_usd_micros: 1500 },
    });
  });
  await page.route('**/api/v1/english/messages/*/speech', (route) => {
    calls.speech += 1;
    return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: 'ID3-FAKE' });
  });
  return calls;
}

test('английский: голос и текст, ошибки, «повтори», живой Нейт', async ({ page }) => {
  await fakeMedia(page);
  await mockSync(page);
  const calls = await mockEnglish(page);
  await page.goto('/agent?tab=english&view=talk');

  await expect(page.getByRole('img', { name: 'Нейт — репетитор' })).toBeVisible();
  await expect(page.getByText('Нейт ждёт')).toBeVisible();
  await page.getByRole('button', { name: 'Начать разговор' }).click();
  const talk = page.getByRole('list', { name: 'Разговор с Нейтом' });
  await expect(talk).toContainText('Tell me about your day');
  await expect.poll(() => calls.speech, { message: 'Нейт здоровается вслух' }).toBe(1);

  // Голосом: «Говорить» → слушает → «Готово» → запись уходит на сервер.
  await page.getByRole('button', { name: 'Говорить' }).click();
  await expect(page.getByText('Нейт слушает…')).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByText('Нейт нашёл ошибку')).toBeVisible();
  expect(calls.turns[0]).toMatchObject({ audio_base64: btoaNode('OPUS-FAKE') });
  expect(calls.turns[0]!.mime).toBe('audio/webm;codecs=opus');

  const wrong = talk.getByRole('listitem').filter({ hasText: 'Seriously?' });
  await expect(wrong).toContainText('ошибка');
  const fixes = wrong.getByRole('list', { name: 'Ошибки' });
  await expect(fixes.locator('s')).toHaveText('I goed');
  await expect(fixes.locator('b')).toHaveText('I went');
  await expect(fixes).toContainText('go — неправильный глагол');
  await expect(wrong).toContainText('Повтори: I went to school yesterday.');
  await expect(talk.getByRole('listitem').filter({ hasText: 'I goed to school' })).toContainText(
    'голосом',
  );
  await expect(page.getByText('Нейт говорит')).toBeVisible();
  await expect(page.getByText('Нейт ждёт')).toBeVisible();
  expect(calls.speech).toBe(2);

  // Текстом: повторил правильно — Нейт доволен (почти).
  await page.getByLabel('Написать по-английски').fill('I went to school yesterday.');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByText('Нейт доволен (почти)')).toBeVisible();
  await expect(talk.getByRole('listitem').filter({ hasText: 'Fine. Finally.' })).toContainText(
    'верно',
  );
  expect(calls.turns[1]).toMatchObject({ text: 'I went to school yesterday.' });

  // «Ещё раз» — голос из памяти страницы, без нового запроса.
  const speechBefore = calls.speech;
  await wrong.getByRole('button', { name: 'Ещё раз' }).click();
  await expect(page.getByText('Нейт говорит')).toBeVisible();
  expect(calls.speech).toBe(speechBefore);

  // Отказ после распознавания: распознанное — в поле, можно отправить текстом.
  await expect(page.getByText('Нейт ждёт')).toBeVisible();
  await page.getByRole('button', { name: 'Говорить' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByRole('alert')).toContainText('AI-лимит исчерпан');
  await expect(page.getByLabel('Написать по-английски')).toHaveValue('My name is Kirill');

  await page.getByRole('button', { name: 'Закончить' }).click();
  await expect(page.getByRole('button', { name: 'Начать разговор' })).toBeVisible();
  expect(calls.finish).toBe(1);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'без горизонтальной прокрутки').toBeLessThanOrEqual(0);
});

test('английский без ключа ElevenLabs: честно и текстом', async ({ page }) => {
  await fakeMedia(page);
  await mockSync(page);
  await mockEnglish(page, { listen: false, speak: false });
  await page.goto('/agent?tab=english&view=talk');
  await expect(page.getByRole('status').filter({ hasText: 'Голос не настроен' })).toBeVisible();
  await page.getByRole('button', { name: 'Начать разговор' }).click();
  await expect(page.getByRole('list', { name: 'Разговор с Нейтом' })).toContainText('Tell me');
  await expect(page.getByRole('button', { name: 'Говорить' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ещё раз' })).toHaveCount(0);
  await page.getByLabel('Написать по-английски').fill('I goed to school yesterday');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByText('Нейт нашёл ошибку')).toBeVisible();
});

function btoaNode(s: string) {
  return Buffer.from(s).toString('base64');
}
