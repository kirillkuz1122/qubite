import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downsample,
  LiveTalk,
  nextStart,
  pcmToFloat,
  RECONNECT_MS,
  rms,
  SILENCE_MS,
  stopHint,
  Vad,
  type LiveHandlers,
} from './english-live';

describe('английский потоком: звук', () => {
  it('48 кГц → 16 кГц: втрое меньше отсчётов, громкость в Int16', () => {
    const input = new Float32Array(480).fill(0.5);
    const out = downsample(input, 48_000, 16_000);
    expect(out.length).toBe(160);
    expect(out[0]).toBe(Math.floor(0.5 * 0x7fff));
    expect(downsample(new Float32Array(3).fill(-1), 48_000, 16_000)[0]).toBe(-0x8000);
  });

  it('PCM 16 бит → Float32 и громкость', () => {
    const bytes = new ArrayBuffer(4);
    new DataView(bytes).setInt16(0, 0x4000, true);
    new DataView(bytes).setInt16(2, -0x8000, true);
    expect(Array.from(pcmToFloat(bytes))).toEqual([0.5, -1]);
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
  });

  it('пауза полсекунды — конец фразы; короткий шум — не речь', () => {
    const vad = new Vad(0.02, 150, SILENCE_MS);
    expect(vad.push(0.5, 40, false)).toBeNull(); // 40 мс — ещё не речь
    expect(vad.push(0.0, 200, false)).toBeNull(); // шум забыт
    let started = null;
    for (let i = 0; i < 5; i++) started ??= vad.push(0.3, 40, false);
    expect(started).toBe('start');
    expect(vad.push(0.0, 400, false)).toBeNull(); // пауза короче полсекунды
    expect(vad.push(0.0, 120, false)).toBe('end');
  });

  it('пока говорит репетитор, порог выше: его голос из колонок — не твоя речь', () => {
    const vad = new Vad(0.02, 150);
    for (let i = 0; i < 10; i++) expect(vad.push(0.04, 40, true)).toBeNull();
    let started = null;
    for (let i = 0; i < 5; i++) started ??= vad.push(0.2, 40, true);
    expect(started).toBe('start');
  });

  it('куски голоса встают в очередь без дыр', () => {
    expect(nextStart(1.0, 0)).toBeCloseTo(1.04);
    expect(nextStart(1.0, 1.5)).toBe(1.5);
  });
});

/** Поддельное соединение: тест сам открывает, закрывает и присылает сообщения. */
class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  binaryType = 'blob';
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  addEventListener() {}
  send(data: unknown) {
    this.sent.push(data);
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  drop() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
  }
  message(json: object) {
    this.onmessage?.({ data: JSON.stringify(json) });
  }
}

describe('английский потоком: связь и отказы (баг владельца 22.10.2026)', () => {
  let events: string[];
  const handlers = (): LiveHandlers => ({
    onSpeech: () => {},
    onPartial: () => {},
    onHeard: () => {},
    onSay: () => {},
    onVoice: () => {},
    onReply: () => {},
    onError: (code) => events.push(`error:${code}`),
    onLink: (state) => events.push(state),
    onClose: () => events.push('close'),
  });

  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
    events = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('лимит AI закончился — не переподключается и не слушает, пока не нажали «Попробовать снова»', () => {
    const talk = new LiveTalk(handlers());
    const ws = FakeSocket.all[0]!;
    ws.open();
    ws.message({
      type: 'error',
      error: 'budget_exhausted',
      message: 'AI-лимит исчерпан (user, day, usd).',
      stop: true,
    });
    // Голос в микрофон после отказа — на сервер ничего не уходит.
    const loud = new Float32Array(1600).fill(0.5);
    for (let i = 0; i < 20; i++) talk.frame(loud, 16_000);
    expect(ws.sent).toEqual([]);
    // Сервер закрыл соединение — по кругу не подключаемся.
    ws.drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(events).toEqual(['on', 'error:budget_exhausted', 'close']);
    // «Попробовать снова» — одно новое подключение.
    talk.retry();
    expect(FakeSocket.all).toHaveLength(2);
    talk.close();
  });

  it('связь оборвалась — переподключается с растущей паузой, но не больше трёх раз', () => {
    const talk = new LiveTalk(handlers());
    FakeSocket.all[0]!.open();
    FakeSocket.all[0]!.drop();
    for (const [i, delay] of RECONNECT_MS.entries()) {
      vi.advanceTimersByTime(delay - 1);
      expect(FakeSocket.all).toHaveLength(i + 1);
      vi.advanceTimersByTime(1);
      expect(FakeSocket.all).toHaveLength(i + 2);
      FakeSocket.all.at(-1)!.drop(); // сервер всё ещё недоступен
    }
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1 + RECONNECT_MS.length);
    expect(events.filter((e) => e === 'reconnecting')).toHaveLength(RECONNECT_MS.length);
    expect(events.at(-1)).toBe('close');
    talk.close();
  });

  it('окончательный ли отказ, решает сервер: без stop микрофон слушает дальше', () => {
    const talk = new LiveTalk(handlers());
    const ws = FakeSocket.all[0]!;
    ws.open();
    ws.message({ type: 'error', error: 'provider_unavailable', message: 'обрыв', stop: false });
    const loud = new Float32Array(1600).fill(0.5);
    for (let i = 0; i < 5; i++) talk.frame(loud, 16_000);
    expect(ws.sent).toContain(JSON.stringify({ type: 'listen' }));
    talk.close();
  });

  it('попытки переподключиться кончились — «Попробовать снова» включает микрофон обратно', () => {
    const talk = new LiveTalk(handlers());
    // Микрофон включён (подделка вместо getUserMedia).
    (talk as unknown as { mic: { stop(): void } }).mic = { stop() {} };
    FakeSocket.all[0]!.open();
    FakeSocket.all[0]!.drop();
    for (const delay of RECONNECT_MS) {
      vi.advanceTimersByTime(delay);
      FakeSocket.all.at(-1)!.drop();
    }
    expect(events.at(-1)).toBe('close');
    expect(talk.listening).toBe(false);
    expect(talk.retry()).toBe(true);
    talk.close();
  });

  it('связь оборвалась посреди фразы — фраза пропала, экран узнаёт; без связи не слушаем', () => {
    const talk = new LiveTalk(handlers());
    const ws = FakeSocket.all[0]!;
    ws.open();
    const loud = new Float32Array(1600).fill(0.5);
    for (let i = 0; i < 5; i++) talk.frame(loud, 16_000);
    ws.drop();
    expect(events).toEqual(['on', 'error:link_lost', 'reconnecting']);
    // Говорит дальше, пока связи нет, — ничего не уходит и речь не начинается.
    const sent = ws.sent.length;
    for (let i = 0; i < 20; i++) talk.frame(loud, 16_000);
    expect(ws.sent).toHaveLength(sent);
    expect(events.at(-1)).toBe('reconnecting');
    talk.close();
  });

  it('старое соединение после «Попробовать снова» не мешает новому', () => {
    const talk = new LiveTalk(handlers());
    const old = FakeSocket.all[0]!;
    old.open();
    old.message({ type: 'error', error: 'budget_exhausted', message: 'лимит', stop: true });
    old.readyState = FakeSocket.CLOSING; // сервер закрывает, onclose ещё не пришёл
    talk.retry();
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1]!.open();
    old.drop(); // закрылось позже — переподключения нет
    old.message({ type: 'error', error: 'budget_exhausted', message: 'старое', stop: true });
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(2);
    expect(events.filter((e) => e === 'error:budget_exhausted')).toHaveLength(1);
    talk.close();
  });

  it('подсказка на отказ говорит, что сделать', () => {
    expect(
      stopHint('budget_exhausted', 'AI-лимит исчерпан (user, day, usd). Можно сохранить без AI'),
    ).toMatch(/закончился \(user, day, usd\).*в настройках лимитов/);
    expect(stopHint('budget_exhausted', '')).not.toMatch(/just|qubite ai/);
    expect(stopHint('rate_limited', '')).toMatch(/зацикливания/);
  });
});
