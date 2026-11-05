import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { HttpError } from './http';
import { VoiceQueue, voiceFailure, type VoiceCapture, type VoiceTransport } from './voice';

/** Сервер голосовых записей в памяти: повтор с тем же ID — прежний ответ (D-847). */
class VoiceServer implements VoiceTransport {
  saved = new Map<string, VoiceCapture>();
  calls: string[] = [];
  /** что случится со следующими запросами: нет сети, ответ сервера с кодом */
  fail: 'offline' | number | null = null;

  async send(capture: VoiceCapture) {
    this.calls.push(capture.id);
    if (this.fail === 'offline') throw new TypeError('Failed to fetch');
    if (typeof this.fail === 'number')
      throw new HttpError(this.fail, 'invalid', 'Неподдерживаемый формат аудио');
    if (!this.saved.has(capture.id)) this.saved.set(capture.id, capture);
    const text = this.saved.get(capture.id)!.text;
    return text
      ? { transcribed: true, reason: null }
      : { transcribed: false, reason: 'Нет разрешения на AI-распознавание' };
  }
}

let n = 0;
const open = (server: VoiceTransport) => VoiceQueue.open(`voice-test-${++n}`, server);
const capture = (id: string, over: Partial<VoiceCapture> = {}): VoiceCapture => ({
  id,
  audio_base64: 'bW9jayBhdWRpbw==',
  mime: 'audio/webm;codecs=opus',
  duration_ms: 1500,
  source: 'web',
  ...over,
});

describe('очередь голосовых записей', () => {
  it('запись уходит на сервер и пропадает из очереди; ответ сервера запоминается', async () => {
    const server = new VoiceServer();
    const queue = await open(server);
    await queue.add(capture('a', { text: 'Купить хлеб' }));
    await queue.add(capture('b'));
    const flush = await queue.flush();
    expect(flush.left).toBe(0);
    expect(flush.sent.map((s) => s.id)).toEqual(['a', 'b']);
    expect(await queue.list()).toEqual([]);
    const results = await queue.results();
    expect(results.get('a')).toMatchObject({ transcribed: true, reason: null });
    expect(results.get('b')).toMatchObject({
      transcribed: false,
      reason: 'Нет разрешения на AI-распознавание',
    });
    // текст устройства уходит в том же запросе, без лишних полей
    expect(server.saved.get('a')).toEqual(capture('a', { text: 'Купить хлеб' }));
    expect(server.saved.get('b')).not.toHaveProperty('text');
  });

  it('без сети запись остаётся на устройстве и уходит потом с тем же ID', async () => {
    const server = new VoiceServer();
    const queue = await open(server);
    let changes = 0;
    queue.subscribe(() => changes++);
    server.fail = 'offline';
    await queue.add(capture('a'), 1000);
    await queue.add(capture('b'), 2000);
    const offline = await queue.flush();
    expect(offline).toEqual({ sent: [], left: 2 });
    // первая же неудача без сети — остальные даже не пробуем
    expect(server.calls).toEqual(['a']);
    const waiting = await queue.list();
    expect(waiting.map((q) => q.id)).toEqual(['b', 'a']);
    expect(waiting.find((q) => q.id === 'a')).toMatchObject({ attempts: 1 });
    expect(waiting.find((q) => q.id === 'a')).not.toHaveProperty('error');
    expect(changes).toBeGreaterThan(0);

    server.fail = null;
    const back = await queue.flush();
    expect(back.sent.map((s) => s.id)).toEqual(['a', 'b']);
    expect(server.calls).toEqual(['a', 'a', 'b']);
    expect(await queue.list()).toEqual([]);
  });

  it('очередь переживает перезагрузку страницы', async () => {
    const server = new VoiceServer();
    server.fail = 'offline';
    const first = await VoiceQueue.open('voice-reload', server);
    await first.add(capture('a'));
    await first.flush();
    first.close();
    server.fail = null;
    const again = await VoiceQueue.open('voice-reload', server);
    expect((await again.list()).map((q) => q.id)).toEqual(['a']);
    await again.flush();
    expect(server.saved.has('a')).toBe(true);
  });

  it('повтор после потерянного ответа не создаёт дубль', async () => {
    const server = new VoiceServer();
    // сервер сохранил, но ответ до устройства не дошёл
    let lost = true;
    const flaky: VoiceTransport = {
      async send(c) {
        const reply = await server.send(c);
        if (lost) {
          lost = false;
          throw new TypeError('network error');
        }
        return reply;
      },
    };
    const queue = await open(flaky);
    await queue.add(capture('a', { text: 'Позвонить маме' }));
    await queue.flush();
    expect(await queue.list()).toHaveLength(1);
    await queue.flush();
    expect(await queue.list()).toHaveLength(0);
    expect(server.calls).toEqual(['a', 'a']);
    expect(server.saved.size).toBe(1);
  });

  it('отказ насовсем не повторяется, запись ждёт решения человека', async () => {
    const server = new VoiceServer();
    const tries: string[] = [];
    const picky: VoiceTransport = {
      send: (c) => {
        tries.push(c.id);
        return c.id === 'bad'
          ? Promise.reject(new HttpError(400, 'invalid', 'Неподдерживаемый формат аудио'))
          : server.send(c);
      },
    };
    const queue = await open(picky);
    await queue.add(capture('bad'), 1000);
    await queue.add(capture('good'), 2000);
    // первая отклонена — вторая всё равно уходит
    const flush = await queue.flush();
    expect(flush.sent.map((s) => s.id)).toEqual(['good']);
    expect(flush.left).toBe(1);
    const [bad] = await queue.list();
    expect(bad).toMatchObject({
      id: 'bad',
      rejected: true,
      error: 'Неподдерживаемый формат аудио',
    });
    await queue.flush();
    expect(tries).toEqual(['bad', 'good']);
    await queue.remove('bad');
    expect(await queue.list()).toEqual([]);
  });

  it('одновременные отправки не шлют запись дважды', async () => {
    const server = new VoiceServer();
    const queue = await open(server);
    await queue.add(capture('a'));
    const [one, two] = await Promise.all([queue.flush(), queue.flush()]);
    expect(server.calls).toEqual(['a']);
    expect(one).toBe(two);
  });

  it('удалённая во время отправки запись не возвращается после сбоя сети', async () => {
    const server = new VoiceServer();
    const queue = await open(server);
    await queue.add(capture('a'));
    server.send = async () => {
      await queue.remove('a');
      throw new TypeError('Failed to fetch');
    };
    const flush = await queue.flush();
    expect(flush.left).toBe(0);
    expect(await queue.list()).toEqual([]);
  });

  it('удалённая во время прохода запись не отправляется из устаревшего снимка', async () => {
    const server = new VoiceServer();
    const queue = await open(server);
    await queue.add(capture('a'));
    await queue.add(capture('b'));
    const send = server.send.bind(server);
    server.send = async (c) => {
      const reply = await send(c);
      await queue.remove('b');
      return reply;
    };
    const flush = await queue.flush();
    expect(server.calls).toEqual(['a']);
    expect(flush.sent.map((s) => s.id)).toEqual(['a']);
    expect(flush.left).toBe(0);
  });

  it('повторный вызов во время отправки не стучится второй раз в ту же неудачу', async () => {
    const server = new VoiceServer();
    server.fail = 'offline';
    const queue = await open(server);
    await queue.add(capture('a'));
    const first = queue.flush();
    await queue.add(capture('b'));
    const second = queue.flush();
    await Promise.all([first, second]);
    // «a» — один раз; «b» добавилась во время отправки — её попробовали во втором проходе
    expect(server.calls).toEqual(['a', 'b']);
  });

  it('текст распознаёт устройство: запись ждёт его и уходит вместе с ним', async () => {
    const server = new VoiceServer();
    const queue = await open(server);
    await queue.add(capture('a'), 1000, 90_000);
    expect((await queue.list())[0]).toMatchObject({ hold_until_ms: 91_000 });
    // пока распознаётся — не отправляется
    expect(await queue.flush(() => 2000)).toEqual({ sent: [], left: 1 });
    expect(server.calls).toEqual([]);
    expect(await queue.settle('a', { text: '  Купить хлеб ' })).toBe(true);
    const [held] = await queue.list();
    expect(held).not.toHaveProperty('hold_until_ms');
    expect(held).toMatchObject({ text: 'Купить хлеб' });
    const flush = await queue.flush(() => 3000);
    expect(flush.sent).toEqual([{ id: 'a', transcribed: true, reason: null, at_ms: 3000 }]);
    expect(server.saved.get('a')).toEqual(capture('a', { text: 'Купить хлеб' }));
  });

  it('устройство не распознало — только звук, причина устройства точнее сервера', async () => {
    const server = new VoiceServer();
    const queue = await open(server);
    await queue.add(capture('a'), 1000, 90_000);
    await queue.settle('a', { why: 'Локальный Whisper не ответил' });
    await queue.flush();
    expect(server.saved.get('a')).toEqual(capture('a'));
    expect((await queue.results()).get('a')).toMatchObject({
      transcribed: false,
      reason: 'Локальный Whisper не ответил',
    });
  });

  it('распознавание оборвалось (вкладку закрыли) — по сроку запись уходит звуком', async () => {
    const server = new VoiceServer();
    const queue = await open(server);
    await queue.add(capture('a'), 1000, 90_000);
    expect((await queue.flush(() => 91_001)).sent.map((s) => s.id)).toEqual(['a']);
    // опоздавший текст уже некуда положить
    expect(await queue.settle('a', { text: 'поздно' })).toBe(false);
  });

  it('старые ответы сервера забываются через 30 дней', async () => {
    const server = new VoiceServer();
    const queue = await VoiceQueue.open('voice-prune', server, indexedDB, 0);
    await queue.add(capture('old'));
    await queue.flush(() => 0);
    queue.close();
    const later = await VoiceQueue.open('voice-prune', server, indexedDB, 31 * 24 * 3600 * 1000);
    expect((await later.results()).size).toBe(0);
  });
});

describe('что делать с неудачей', () => {
  it('сеть и временные ошибки — повторить, неверная запись — нет', () => {
    expect(voiceFailure(new TypeError('Failed to fetch'))).toEqual({ retry: true });
    expect(voiceFailure(new HttpError(503, 'unavailable', 'x'))).toEqual({
      retry: true,
      message: 'сервер не ответил — повторим позже',
    });
    expect(voiceFailure(new HttpError(401, 'unauthenticated', 'x')).retry).toBe(true);
    expect(voiceFailure(new HttpError(403, 'forbidden', 'Нет права записи'))).toEqual({
      retry: true,
      message: 'Нет права записи',
    });
    expect(voiceFailure(new HttpError(400, 'invalid', 'Аудиозапись слишком большая'))).toEqual({
      retry: false,
      message: 'Аудиозапись слишком большая',
    });
  });
});
