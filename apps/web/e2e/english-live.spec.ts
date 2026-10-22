import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { mockSync } from './sync-mock';

/*
 * «Английский» потоком (ENG-001, D-457…D-459): микрофон «руки свободны», пауза — конец фразы,
 * ответ по словам и голос кусками, замер «ответил через …», перебивание голосом. Сервер
 * (WebSocket), микрофон и звук — поддельные; браузер настоящий.
 */

/** Поддельные Web Audio и микрофон: `__speak(мс, громкость)` подаёт звук кусками по 20 мс. */
async function fakeAudio(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__played = 0;
    w.__stopped = 0;
    class FakeNode {
      port: { onmessage: ((e: { data: Float32Array }) => void) | null } = { onmessage: null };
      constructor() {
        w.__mic = this;
      }
      connect() {}
      disconnect() {}
    }
    class FakeCtx {
      sampleRate = 48_000;
      destination = {};
      audioWorklet = { addModule: async () => {} };
      get currentTime() {
        return performance.now() / 1000;
      }
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createBuffer(_ch: number, length: number, rate: number) {
        return { duration: length / rate, getChannelData: () => new Float32Array(length) };
      }
      createBufferSource() {
        const node = {
          buffer: null as unknown,
          onended: null as null | (() => void),
          connect() {},
          start() {
            w.__played = (w.__played as number) + 1;
          },
          stop() {
            w.__stopped = (w.__stopped as number) + 1;
          },
        };
        return node;
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    }
    Object.defineProperty(window, 'AudioContext', { value: FakeCtx });
    Object.defineProperty(window, 'AudioWorkletNode', { value: FakeNode });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
    w.__speak = (ms: number, level: number) =>
      new Promise<void>((done) => {
        let left = ms;
        const tick = setInterval(() => {
          const mic = w.__mic as FakeNode | undefined;
          mic?.port.onmessage?.({ data: new Float32Array(960).fill(level) });
          left -= 20;
          if (left <= 0) {
            clearInterval(tick);
            done();
          }
        }, 20);
      });
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
    latency: null,
    at: now(),
    ...over,
  };
}

const session = {
  id: 'sess-1',
  started_at: now(),
  last_at: now(),
  finished_at: null,
  turns: 0,
  correct: 0,
  mistakes: 0,
  memory_action: null,
};

/** Экран с идущим разговором и поддельный сервер потока; `refuse` — лимит AI закончился. */
async function mockLive(page: Page, refuse = false) {
  const greeting = message({ text: 'Back again? Good. What did you do yesterday?' });
  await page.route('**/api/v1/english', (route) =>
    route.fulfill({
      json: {
        session,
        messages: [greeting],
        last: null,
        totals: { sessions: 0, turns: 0, correct: 0, mistakes: 0 },
        voice: { listen: true, speak: true, live: true },
      },
    }),
  );
  await page.route('**/api/v1/english/messages/*/speech', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: 'RIFF' }),
  );
  const seen = { connects: 0, listen: 0, done: 0, audio: 0, interrupt: 0, texts: [] as string[] };
  let socket: WebSocketRoute | null = null;
  /** Ответ репетитора потоком: слова, голос кусками, замер, записанный ход. */
  const answer = async (learner: string, via: string, pieces: string[], audioChunks: number) => {
    const ws = socket!;
    ws.send(JSON.stringify({ type: 'heard', text: learner }));
    for (const piece of pieces) {
      ws.send(JSON.stringify({ type: 'say', text: piece }));
      await new Promise((r) => setTimeout(r, 60));
      if (audioChunks > 0) {
        ws.send(Buffer.alloc(4800, 1));
        audioChunks -= 1;
      }
    }
    while (audioChunks-- > 0) ws.send(Buffer.alloc(4800, 1));
    ws.send(
      JSON.stringify({
        type: 'metrics',
        first_audio_ms: 640,
        first_text_ms: 380,
        heard_ms: 0,
        reply_ms: 900,
      }),
    );
    ws.send(
      JSON.stringify({
        type: 'reply',
        turn: {
          session: { ...session, turns: 1 },
          learner: message({ role: 'learner', text: learner, via, verdict: null }),
          tutor: message({
            text: pieces.join(''),
            verdict: 'mistake',
            mistakes: [{ wrong: 'I goed', right: 'I went', why: 'go — неправильный глагол' }],
            repeat: 'I went to the park.',
            latency: { first_audio_ms: 640, first_text_ms: 380, heard_ms: 0, reply_ms: 900 },
          }),
          cost_usd_micros: 900,
        },
      }),
    );
  };
  await page.routeWebSocket('**/api/v1/english/live', (ws) => {
    socket = ws;
    seen.connects += 1;
    ws.onMessage((msg) => {
      if (typeof msg !== 'string') {
        seen.audio += 1;
        return;
      }
      const json = JSON.parse(msg) as { type: string; text?: string };
      if (json.type === 'listen') {
        seen.listen += 1;
        if (refuse) {
          ws.send(
            JSON.stringify({
              type: 'error',
              error: 'budget_exhausted',
              message: 'AI-лимит исчерпан (user, day, usd). Можно сохранить без AI',
              heard: null,
            }),
          );
          void ws.close();
        }
      }
      if (json.type === 'interrupt') seen.interrupt += 1;
      if (json.type === 'done') {
        seen.done += 1;
        void answer(
          'I goed to the park',
          'voice',
          ['"I goed"? ', 'No. ', 'Went. ', 'Say it again.'],
          6,
        );
      }
      if (json.type === 'text') {
        seen.texts.push(json.text ?? '');
        // Длинный ответ голосом — чтобы успеть перебить.
        void answer(json.text ?? '', 'text', ['Fine. ', 'Now tell me more.'], 20);
      }
    });
  });
  return seen;
}

test('английский потоком: заговорил — пауза — Нейт отвечает сразу, перебивается голосом', async ({
  page,
}) => {
  await fakeAudio(page);
  await mockSync(page);
  const seen = await mockLive(page);
  await page.goto('/agent?tab=english');
  const talk = page.getByRole('list', { name: 'Разговор с Нейтом' });
  await expect(talk).toContainText('What did you do yesterday?');

  await page.getByRole('button', { name: 'Включить микрофон' }).click();
  await expect(page.getByText('Говори — полсекунды паузы')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выключить микрофон' })).toBeVisible();

  // Говорит 0,6 с, потом молчит 0,7 с: экран сам понял конец фразы.
  const speaking = page.evaluate(() =>
    (window as unknown as { __speak(ms: number, l: number): Promise<void> }).__speak(600, 0.3),
  );
  await expect(page.getByText('Нейт слушает…')).toBeVisible();
  await speaking;
  await page.evaluate(() =>
    (window as unknown as { __speak(ms: number, l: number): Promise<void> }).__speak(700, 0),
  );
  await expect.poll(() => seen.done).toBe(1);
  expect(seen.listen).toBe(1);
  expect(seen.audio, 'звук ушёл кусками, пока говорил').toBeGreaterThan(10);

  // Ответ по словам и голос кусками — сразу, не дожидаясь конца.
  await expect(page.getByText('Нейт говорит')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __played: number }).__played))
    .toBeGreaterThan(0);
  const answer = talk.getByRole('listitem').filter({ hasText: 'Say it again.' }).last();
  await expect(answer).toContainText('ошибка');
  await expect(answer).toContainText('ответил через');
  await expect(answer.getByRole('list', { name: 'Ошибки' })).toContainText('I went');
  await expect(talk.getByRole('listitem').filter({ hasText: 'I goed to the park' })).toContainText(
    'голосом',
  );

  // Длинный ответ на текст — и перебиваем голосом.
  await expect(page.getByText('Нейт говорит')).toBeHidden({ timeout: 10_000 });
  await page.getByLabel('Написать по-английски').fill('I went to the park.');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect.poll(() => seen.texts).toEqual(['I went to the park.']);
  await expect(page.getByRole('button', { name: 'Перебить' })).toBeVisible();
  const stoppedBefore = await page.evaluate(
    () => (window as unknown as { __stopped: number }).__stopped,
  );
  await page.evaluate(() =>
    (window as unknown as { __speak(ms: number, l: number): Promise<void> }).__speak(400, 0.5),
  );
  await expect
    .poll(() => seen.interrupt, { message: 'заговорил поверх — «замолчи»' })
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __stopped: number }).__stopped))
    .toBeGreaterThan(stoppedBefore);
  await expect(page.getByText('Нейт слушает…')).toBeVisible();

  await page.getByRole('button', { name: 'Выключить микрофон' }).click();
  await expect(page.getByRole('button', { name: 'Включить микрофон' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'без горизонтальной прокрутки').toBeLessThanOrEqual(0);
});

test('лимит AI закончился: понятно, что сделать, микрофон выключен, по кругу не подключается', async ({
  page,
}) => {
  await fakeAudio(page);
  await mockSync(page);
  const seen = await mockLive(page, true);
  await page.goto('/agent?tab=english');
  await page.getByRole('button', { name: 'Включить микрофон' }).click();
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() =>
      (window as unknown as { __speak(ms: number, l: number): Promise<void> }).__speak(400, 0.3),
    );
  }
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('AI-лимит закончился (user, day, usd)');
  await expect(alert).toContainText('just qubite ai limit');
  await expect(page.getByRole('button', { name: /микрофон|Говорить/ })).toBeHidden();
  // Шум в микрофоне и время — ни новых «слушай», ни новых подключений.
  await page.waitForTimeout(4_000);
  expect(seen.listen).toBe(1);
  expect(seen.connects).toBe(1);

  await alert.getByRole('button', { name: 'Попробовать снова' }).click();
  await expect.poll(() => seen.connects).toBe(2);
  await expect(page.getByRole('button', { name: 'Выключить микрофон' })).toBeVisible();
});
