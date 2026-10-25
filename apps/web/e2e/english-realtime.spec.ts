import { expect, test, type Page } from '@playwright/test';
import { mockSync } from './sync-mock';

/*
 * Живой голос Нейта через подписку ChatGPT (ENG-005): временный ключ с сервера, WebRTC к OpenAI,
 * расшифровка обеих сторон по мере речи и в историю, пауза, перебивание, «Закончить»; понятные
 * ошибки (OpenAI недоступен, лимит подписки) и «Говорить через ElevenLabs»; переключатель в
 * Настройках. WebRTC, микрофон, OpenAI и сервер Qubite — поддельные; браузер настоящий.
 * Снимки для docs: ENG005_SHOTS=1.
 */

const SHOTS = process.env.ENG005_SHOTS === '1';

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  const w = page.viewportSize()?.width ?? 0;
  await page.screenshot({
    path: `../../docs/design/screens/eng-005/${name}-${w <= 400 ? 'phone' : 'pc'}.png`,
    fullPage: true,
  });
}

type W = {
  __emit(e: Record<string, unknown>): void;
  __sent: { type: string }[];
  __track: { enabled: boolean; stopped: boolean };
  __pcClosed: boolean;
};

/** Поддельные RTCPeerConnection и микрофон: `__emit(событие)` — событие OpenAI по каналу данных. */
async function fakeRtc(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__sent = [];
    w.__pcClosed = false;
    const track = { enabled: true, stopped: false, stop() {} };
    track.stop = () => {
      track.stopped = true;
    };
    w.__track = track;
    class FakeDC {
      readyState = 'connecting';
      onopen: (() => void) | null = null;
      onmessage: ((m: { data: string }) => void) | null = null;
      send(s: string) {
        (w.__sent as unknown[]).push(JSON.parse(s));
      }
      close() {
        this.readyState = 'closed';
      }
    }
    class FakePC {
      connectionState = 'new';
      ontrack: unknown = null;
      onconnectionstatechange: unknown = null;
      dc = new FakeDC();
      addTrack() {}
      createDataChannel() {
        w.__emit = (e: unknown) => this.dc.onmessage?.({ data: JSON.stringify(e) });
        return this.dc;
      }
      async createOffer() {
        return { type: 'offer', sdp: 'v=0 fake-offer' };
      }
      async setLocalDescription() {}
      async setRemoteDescription() {
        setTimeout(() => {
          this.dc.readyState = 'open';
          this.dc.onopen?.();
        }, 20);
      }
      close() {
        w.__pcClosed = true;
      }
    }
    Object.defineProperty(window, 'RTCPeerConnection', { value: FakePC });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: async () => ({ getTracks: () => [track] }) },
    });
  });
}

const now = () => new Date().toISOString();
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

function engine(over: Record<string, unknown> = {}) {
  return {
    chosen: null,
    engine: 'chatgpt',
    chatgpt_connected: true,
    realtime_ready: true,
    model: 'chatgpt:gpt-realtime-1.5',
    voice: 'marin',
    sessions_today: 0,
    seconds_today: 0,
    day_sessions: 20,
    day_secs: 3600,
    max_session_secs: 900,
    ...over,
  };
}

/** Сервер Qubite: экран, ключ, реплики, конец, настройки. `refuse` — код отказа выдачи ключа. */
async function mockServer(page: Page, refuse: string | null = null) {
  const seen = {
    lines: [] as { item: string; role: string; text: string }[][],
    finish: [] as { seconds: number; end: boolean }[],
    patch: [] as Record<string, unknown>[],
    sdp: [] as { auth: string | null; type: string | null; body: string }[],
  };
  await page.route('**/api/v1/english', (route) =>
    route.fulfill({
      json: {
        session: null,
        messages: [],
        last: null,
        totals: { sessions: 0, turns: 0, correct: 0, mistakes: 0 },
        voice: { listen: true, speak: true, live: true },
        engine: engine(),
      },
    }),
  );
  await page.route('**/api/v1/english/realtime', (route) =>
    refuse
      ? route.fulfill({
          status: 409,
          json: { error: refuse, message: 'лимит подписки ChatGPT исчерпан' },
        })
      : route.fulfill({
          json: {
            session,
            messages: [],
            realtime: {
              id: 'call-1',
              client_secret: 'ek_test_1',
              expires_at: 1_900_000_000,
              model: 'chatgpt:gpt-realtime-1.5',
              external_model: 'gpt-realtime-1.5',
              voice: 'marin',
              calls_url: 'https://realtime.test/v1/realtime/calls',
              max_seconds: 900,
            },
            fallback: null,
          },
        }),
  );
  await page.route('**/api/v1/english/realtime/call-1/lines', (route) => {
    const body = route.request().postDataJSON() as { lines: (typeof seen.lines)[number] };
    seen.lines.push(body.lines);
    return route.fulfill({ json: { session, messages: [] } });
  });
  await page.route('**/api/v1/english/realtime/call-1/finish', (route) => {
    seen.finish.push(route.request().postDataJSON() as (typeof seen.finish)[number]);
    return route.fulfill({ json: { seconds: 3, session: null } });
  });
  await page.route('**/api/v1/english/settings', (route) => {
    if (route.request().method() === 'PATCH')
      seen.patch.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      json: {
        settings: {
          level: 'a1',
          placed_at: now(),
          goal_minutes: 10,
          strictness: 2,
          voice: null,
          remind: true,
          remind_at: '18:00',
          rest_weekday: null,
          paused_until: null,
          companion: null,
          voice_engine: null,
          realtime_model: null,
          realtime_voice: null,
        },
        voices: [{ id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', about: 'британский' }],
        sample: "Hi, I'm Nate.",
        engine: engine({ sessions_today: 2, seconds_today: 600 }),
        realtime_models: [
          { id: 'chatgpt:gpt-realtime-1.5', name: 'GPT Realtime 1.5', about: 'по умолчанию' },
          { id: 'chatgpt:gpt-realtime-mini', name: 'Realtime mini', about: 'быстрее' },
        ],
        realtime_voices: [
          { id: 'marin', about: 'женский, живой' },
          { id: 'cedar', about: 'мужской, живой' },
        ],
      },
    });
  });
  return seen;
}

test('живой голос: ключ → WebRTC → расшифровка обеих сторон, пауза, перебить, закончить', async ({
  page,
}) => {
  await fakeRtc(page);
  await mockSync(page);
  const seen = await mockServer(page);
  // Поддельный OpenAI: SDP-ответ на предложение с временным ключом.
  await page.route('https://realtime.test/**', (route) => {
    const r = route.request();
    seen.sdp.push({
      auth: r.headers()['authorization'] ?? null,
      type: r.headers()['content-type'] ?? null,
      body: r.postData() ?? '',
    });
    return route.fulfill({ status: 201, contentType: 'application/sdp', body: 'v=0 fake-answer' });
  });
  const emit = (e: Record<string, unknown>) =>
    page.evaluate((e) => (window as unknown as W).__emit(e), e);

  await page.goto('/agent?tab=english&view=talk');
  await expect(page.getByText('Живой голос ChatGPT')).toBeVisible();
  await shot(page, 'talk-start');
  await page.getByRole('button', { name: 'Начать разговор' }).click();

  await expect.poll(() => seen.sdp.length).toBe(1);
  expect(seen.sdp[0]).toEqual({
    auth: 'Bearer ek_test_1',
    type: 'application/sdp',
    body: 'v=0 fake-offer',
  });
  // Нейт начинает сам.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__sent.map((e) => e.type)))
    .toContain('response.create');

  // Ответ Нейта — по мере речи.
  await emit({
    type: 'response.output_item.added',
    item: { id: 'a1', type: 'message', role: 'assistant' },
  });
  await emit({ type: 'output_audio_buffer.started' });
  await emit({ type: 'response.output_audio_transcript.delta', item_id: 'a1', delta: 'Hi! What ' });
  const talk = page.getByRole('list', { name: 'Разговор с Нейтом' });
  await expect(talk).toContainText('Hi! What');
  await expect(page.getByText('Нейт говорит')).toBeVisible();
  await emit({
    type: 'response.output_audio_transcript.delta',
    item_id: 'a1',
    delta: 'did you do yesterday?',
  });
  await emit({
    type: 'response.output_audio_transcript.done',
    item_id: 'a1',
    transcript: 'Hi! What did you do yesterday?',
  });
  await emit({ type: 'response.done', response: { status: 'completed' } });
  await emit({ type: 'output_audio_buffer.stopped' });

  // Говорю я — расшифровка тоже по мере речи.
  await emit({ type: 'input_audio_buffer.speech_started', item_id: 'u1' });
  await expect(page.getByText('Нейт слушает…')).toBeVisible();
  await emit({
    type: 'conversation.item.input_audio_transcription.delta',
    item_id: 'u1',
    delta: 'I goed',
  });
  await expect(talk.getByRole('listitem').filter({ hasText: 'I goed' })).toContainText('Ты');
  await emit({ type: 'input_audio_buffer.speech_stopped', item_id: 'u1' });
  await emit({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'u1',
    transcript: 'I goed to the park',
  });
  // Готовые реплики — в историю, по порядку.
  await expect
    .poll(() => seen.lines.flat().map((l) => [l.item, l.role, l.text]))
    .toEqual([
      ['a1', 'tutor', 'Hi! What did you do yesterday?'],
      ['u1', 'learner', 'I goed to the park'],
    ]);
  await shot(page, 'talk-live');

  // Нейт говорит — перебить кнопкой.
  await emit({ type: 'response.output_item.added', item: { id: 'a2', role: 'assistant' } });
  await emit({ type: 'output_audio_buffer.started' });
  await emit({ type: 'response.output_audio_transcript.delta', item_id: 'a2', delta: 'Goed? No.' });
  await page.getByRole('button', { name: 'Перебить' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__sent.map((e) => e.type)))
    .toContain('response.cancel');

  // Пауза: микрофон выключен, «Продолжить» — снова включён.
  await page.getByRole('button', { name: 'Пауза' }).click();
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as W).__track.enabled)).toBe(false);
  await page.getByRole('button', { name: 'Продолжить' }).click();
  expect(await page.evaluate(() => (window as unknown as W).__track.enabled)).toBe(true);

  // Закончить: недоговорённое — тоже в историю, сеанс — в учёт, разговор закрыт.
  await page.getByRole('button', { name: 'Закончить' }).click();
  await expect.poll(() => seen.finish).toHaveLength(1);
  expect(seen.finish[0]!.end).toBe(true);
  expect(seen.lines.flat().map((l) => l.text)).toContain('Goed? No.');
  expect(await page.evaluate(() => (window as unknown as W).__pcClosed)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as W).__track.stopped)).toBe(true);
});

test('живой голос: OpenAI недоступен — совет про VPN и «Говорить через ElevenLabs»', async ({
  page,
}) => {
  await fakeRtc(page);
  await mockSync(page);
  const seen = await mockServer(page);
  await page.route('https://realtime.test/**', (route) => route.abort('connectionrefused'));
  await page.goto('/agent?tab=english&view=talk');
  await page.getByRole('button', { name: 'Начать разговор' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('api.openai.com');
  await expect(alert).toContainText('VPN');
  // Сеанс закрыт — сервер узнал, что разговора не было.
  await expect.poll(() => seen.finish).toEqual([{ seconds: 0, end: false }]);
  await shot(page, 'talk-no-network');
  await alert.getByRole('button', { name: 'Говорить через ElevenLabs' }).click();
  await expect.poll(() => seen.patch).toEqual([{ voice_engine: 'elevenlabs' }]);
});

test('живой голос: лимит подписки — понятная ошибка до подключения', async ({ page }) => {
  await fakeRtc(page);
  await mockSync(page);
  await mockServer(page, 'subscription_limit');
  await page.goto('/agent?tab=english&view=talk');
  await page.getByRole('button', { name: 'Начать разговор' }).click();
  await expect(page.getByRole('alert')).toContainText('Лимит подписки ChatGPT закончился');
  await expect(page.getByRole('button', { name: 'Начать снова' })).toBeVisible();
});

test('настройки: голос ChatGPT / ElevenLabs, модель и голос живого разговора', async ({ page }) => {
  await mockSync(page);
  const seen = await mockServer(page);
  await page.goto('/agent?tab=english&view=settings');
  const settings = page.getByRole('region', { name: 'Настройки английского' });
  await expect(settings).toContainText('Голос разговора');
  const engineSwitch = settings.getByRole('radiogroup', { name: 'Голос разговора' });
  await expect(engineSwitch.getByRole('radio', { name: 'ChatGPT — живой' })).toBeChecked();
  await expect(settings).toContainText('Сегодня: разговоров 2 из 20, минут 10 из 60');
  await expect(settings).toContainText('ElevenLabs (запасной)');
  await settings.getByRole('radio', { name: 'Realtime mini' }).click();
  await settings.getByRole('radio', { name: 'cedar' }).click();
  await shot(page, 'settings');
  await engineSwitch.getByRole('radio', { name: 'ElevenLabs' }).click();
  await expect
    .poll(() => seen.patch)
    .toEqual([
      { realtime_model: 'chatgpt:gpt-realtime-mini' },
      { realtime_voice: 'cedar' },
      { voice_engine: 'elevenlabs' },
    ]);
});
