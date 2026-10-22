/**
 * «Английский» потоком (ENG-001, D-457…D-459): разговор почти без задержки. Микрофон всё время
 * слушает (руки свободны): заговорил — звук кусками PCM 16 кГц идёт на сервер, замолчал на
 * полсекунды — фраза кончилась; ответ приходит текстом по словам и голосом кусками PCM 24 кГц,
 * которые играются сразу. Заговорил поверх репетитора — он замолкает.
 */
import type { EnglishTurn } from './english';

/** Частота микрофона для сервера и голоса репетитора. */
export const MIC_RATE = 16_000;
export const SPEECH_RATE = 24_000;
/** Пауза — конец фразы (как у распознавания на сервере). */
export const SILENCE_MS = 500;
/** Сколько звука до начала речи тоже отправить (первый слог не теряется). */
export const PREROLL_MS = 300;
/** Паузы перед переподключением, когда оборвалась связь; потом — запасной путь. */
export const RECONNECT_MS = [1_000, 3_000, 9_000];
/** Связь продержалась столько — обрыв после этого снова получает все попытки. */
export const STABLE_MS = 10_000;

/**
 * Отказы, которые не пройдут от повтора: лимит AI, защита от зацикливания, нет прав, отказ
 * провайдера (ElevenLabs из закрытой страны отвечает 302, неверный ключ). На них
 * микрофон выключается и экран ждёт «Попробовать снова», а не слушает и не подключается по кругу.
 */
export const STOP_CODES = new Set([
  'budget_exhausted',
  'budget_not_set',
  'platform_cap_not_set',
  'rate_limited',
  'repeated_request',
  'subscription_limit',
  'provider_refused',
  'ai_not_granted',
  'module_not_granted',
  'action_not_granted',
  'account_inactive',
  'unauthenticated',
]);

const LIMIT_COMMAND =
  'just qubite ai limit --scope user:<почта> --period day --metric usd --value <доллары>';

/** Что сказать человеку на отказ из {@link STOP_CODES}: что случилось и что сделать. */
export function stopHint(code: string, message: string): string {
  switch (code) {
    case 'budget_exhausted': {
      const what = /\(([^)]+)\)/.exec(message)?.[1];
      return (
        `AI-лимит закончился${what ? ` (${what})` : ''}. Дневной сам обнулится в полночь; ` +
        `поднять сейчас: ${LIMIT_COMMAND} — или попроси владельца.`
      );
    }
    case 'budget_not_set':
      return `AI-бюджет не выдан. Владелец выдаёт его: ${LIMIT_COMMAND}.`;
    case 'rate_limited':
      return 'Слишком много AI-запросов за минуту — сработала защита от зацикливания. Подожди минуту и попробуй снова.';
    case 'repeated_request':
      return 'Один и тот же запрос повторяется — защита от зацикливания остановила разговор. Попробуй снова.';
    case 'subscription_limit':
      return `Лимит подписки закончился: ${message}. Попробуй позже.`;
    default:
      return message;
  }
}

// ---------------------------------------------------------------- чистые части

/** Float32 [-1, 1] с частотой `from` → Int16 с частотой `to` (простое прореживание со средним). */
export function downsample(input: Float32Array, from: number, to: number): Int16Array<ArrayBuffer> {
  const ratio = from / to;
  const length = Math.floor(input.length / ratio);
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j]!;
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

/** Громкость куска (RMS) — для определения речи. */
export function rms(input: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += input[i]! * input[i]!;
  return Math.sqrt(sum / Math.max(1, input.length));
}

/** PCM 16 бит → Float32 для проигрывания. */
export function pcmToFloat(bytes: ArrayBuffer): Float32Array {
  const view = new DataView(bytes);
  const out = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

export type VadEvent = 'start' | 'end' | null;

/**
 * Где речь, а где пауза: громче порога ~150 мс подряд — начал говорить; тише порога
 * {@link SILENCE_MS} — кончил. Порог растёт, пока говорит репетитор (его голос из колонок не
 * должен считаться твоей речью).
 */
export class Vad {
  speaking = false;
  private loud = 0;
  private quiet = 0;
  constructor(
    private threshold = 0.02,
    private startMs = 150,
    private silenceMs = SILENCE_MS,
  ) {}

  push(level: number, ms: number, tutorTalking: boolean): VadEvent {
    const limit = tutorTalking ? this.threshold * 3 : this.threshold;
    if (level >= limit) {
      this.loud += ms;
      this.quiet = 0;
      if (!this.speaking && this.loud >= this.startMs) {
        this.speaking = true;
        return 'start';
      }
    } else {
      this.quiet += ms;
      if (this.quiet >= this.startMs) this.loud = 0;
      if (this.speaking && this.quiet >= this.silenceMs) {
        this.speaking = false;
        this.loud = 0;
        return 'end';
      }
    }
    return null;
  }
}

/** Когда начать следующий кусок голоса: сразу (с запасом 40 мс) или после уже поставленных. */
export function nextStart(now: number, queuedUntil: number, lead = 0.04): number {
  return Math.max(now + lead, queuedUntil);
}

// ---------------------------------------------------------------- разговор

export interface LiveHandlers {
  /** Ты заговорил / замолчал. */
  onSpeech(speaking: boolean): void;
  /** Черновик распознавания. */
  onPartial(text: string): void;
  /** Фраза распознана. */
  onHeard(text: string): void;
  /** Кусок ответа репетитора (текст). */
  onSay(text: string): void;
  /** Голос репетитора начался / кончился. */
  onVoice(playing: boolean): void;
  /** Ход записан; `waitMs` — от конца твоей фразы до первого звука (замер на экране). */
  onReply(turn: EnglishTurn, waitMs: number | null): void;
  /** Ошибка; на код из {@link STOP_CODES} микрофон уже выключен — ждём {@link LiveTalk.retry}. */
  onError(code: string, message: string, heard: string | null): void;
  /** Связь есть / оборвалась и переподключаемся. */
  onLink(state: 'on' | 'reconnecting'): void;
  /** Связи нет и больше не переподключаемся (попытки кончились или отказ по лимиту). */
  onClose(): void;
}

/** Микрофон — куски PCM и громкость (в тестах — подделка). */
export interface Mic {
  stop(): void;
}

const WORKLET = `
class QubiteMic extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.size = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      this.buf.push(new Float32Array(ch)); this.size += ch.length;
      if (this.size >= sampleRate / 25) {
        const out = new Float32Array(this.size); let o = 0;
        for (const b of this.buf) { out.set(b, o); o += b.length; }
        this.port.postMessage(out, [out.buffer]); this.buf = []; this.size = 0;
      }
    }
    return true;
  }
}
registerProcessor('qubite-mic', QubiteMic);
`;

/** Есть ли всё для разговора потоком. */
export function canLive(): boolean {
  return (
    typeof WebSocket !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export class LiveTalk {
  private ws: WebSocket;
  private ctx: AudioContext | null = null;
  private mic: Mic | null = null;
  private vad = new Vad();
  private sources = new Set<AudioBufferSourceNode>();
  private queuedUntil = 0;
  private playing = false;
  private voiceTimer: ReturnType<typeof setTimeout> | undefined;
  private preroll: Int16Array<ArrayBuffer>[] = [];
  private phraseEnd: number | null = null;
  private firstAudio: number | null = null;
  /** Отказ по лимиту: не слушаем и не переподключаемся до «Попробовать снова». */
  private blocked = false;
  /** Микрофон был включён до отказа — «Попробовать снова» включит его обратно. */
  private resume = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stableTimer: ReturnType<typeof setTimeout> | undefined;
  private closing = false;
  /** Связь хоть раз была: не открылась с первого раза — сразу запасной путь, без попыток. */
  private linked = false;

  constructor(private h: LiveHandlers) {
    this.ws = this.connect();
  }

  private connect(): WebSocket {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/v1/english/live`);
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (e) => this.receive(e.data as ArrayBuffer | string);
    ws.onopen = () => {
      this.linked = true;
      this.h.onLink('on');
      this.stableTimer = setTimeout(() => (this.attempt = 0), STABLE_MS);
    };
    ws.onclose = () => this.dropped();
    return ws;
  }

  /** Связь оборвалась: переподключиться с растущей паузой, но не по кругу. */
  private dropped() {
    clearTimeout(this.stableTimer);
    if (this.closing) return;
    const delay = RECONNECT_MS[this.attempt];
    if (this.blocked || !this.linked || delay === undefined) {
      this.stopMic();
      this.hush();
      return this.h.onClose();
    }
    this.attempt++;
    this.h.onLink('reconnecting');
    this.retryTimer = setTimeout(() => (this.ws = this.connect()), delay);
  }

  /**
   * «Попробовать снова» после отказа по лимиту или когда попытки кончились. Возвращает, был ли
   * включён микрофон до отказа (экран включит его обратно).
   */
  retry(): boolean {
    this.blocked = false;
    this.attempt = 0;
    const ws = this.ws.readyState;
    if (ws === WebSocket.CLOSING || ws === WebSocket.CLOSED) {
      clearTimeout(this.retryTimer);
      this.h.onLink('reconnecting');
      this.ws = this.connect();
    }
    const resume = this.resume;
    this.resume = false;
    return resume;
  }

  /** Ждём открытия соединения (или ошибку). */
  ready(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('нет соединения')), { once: true });
    });
  }

  private audio(): AudioContext {
    this.ctx ??= new AudioContext();
    void this.ctx.resume?.();
    return this.ctx;
  }

  private send(json: object) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(json));
  }

  /** Написать текстом (ответ — тем же потоком). */
  text(text: string) {
    this.audio();
    this.phraseEnd = performance.now();
    this.firstAudio = null;
    this.send({ type: 'text', text });
  }

  /** Замолчи (кнопка или заговорил поверх). */
  interrupt() {
    this.hush();
    this.send({ type: 'interrupt' });
  }

  /** Микрофон включён: руки свободны, фразы определяются паузой. */
  async listen(): Promise<void> {
    const ctx = this.audio();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'qubite-mic');
    node.port.onmessage = (e: MessageEvent<Float32Array>) => this.frame(e.data, ctx.sampleRate);
    source.connect(node);
    this.mic = {
      stop: () => {
        node.port.onmessage = null;
        source.disconnect();
        node.disconnect();
        stream.getTracks().forEach((t) => t.stop());
      },
    };
  }

  /** Кусок с микрофона: громкость → начало/конец речи; во время речи — на сервер. */
  frame(samples: Float32Array, rate: number) {
    if (this.blocked) return;
    const ms = (samples.length / rate) * 1000;
    const pcm = downsample(samples, rate, MIC_RATE);
    const event = this.vad.push(rms(samples), ms, this.playing);
    if (event === 'start') {
      if (this.playing) this.interrupt();
      this.h.onSpeech(true);
      this.send({ type: 'listen' });
      if (this.ws.readyState === WebSocket.OPEN)
        for (const chunk of this.preroll) this.ws.send(chunk);
      this.preroll = [];
    }
    if (this.vad.speaking || event === 'end') {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(pcm);
    } else {
      this.preroll.push(pcm);
      const keep = Math.ceil(PREROLL_MS / Math.max(1, ms));
      if (this.preroll.length > keep) this.preroll.splice(0, this.preroll.length - keep);
    }
    if (event === 'end') {
      this.h.onSpeech(false);
      this.phraseEnd = performance.now();
      this.firstAudio = null;
      this.send({ type: 'done' });
    }
  }

  private receive(data: ArrayBuffer | string) {
    if (typeof data !== 'string') return this.play(data);
    let msg: { type?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(data) as typeof msg;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'partial':
        return this.h.onPartial(String(msg.text ?? ''));
      case 'heard':
        return this.h.onHeard(String(msg.text ?? ''));
      case 'say':
        return this.h.onSay(String(msg.text ?? ''));
      case 'reply': {
        const wait =
          this.phraseEnd !== null && this.firstAudio !== null
            ? Math.max(0, Math.round(this.firstAudio - this.phraseEnd))
            : null;
        return this.h.onReply(msg.turn as EnglishTurn, wait);
      }
      case 'error': {
        const code = String(msg.error ?? 'error');
        if (STOP_CODES.has(code)) {
          this.blocked = true;
          this.resume ||= this.listening;
          this.stopMic();
          this.hush();
        }
        return this.h.onError(
          code,
          String(msg.message ?? ''),
          (msg.heard as string | null) ?? null,
        );
      }
    }
  }

  /** Кусок голоса — сразу в очередь проигрывания. */
  private play(bytes: ArrayBuffer) {
    if (bytes.byteLength < 2) return;
    const ctx = this.audio();
    const samples = pcmToFloat(bytes);
    const buffer = ctx.createBuffer(1, samples.length, SPEECH_RATE);
    buffer.getChannelData(0).set(samples);
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    const at = nextStart(ctx.currentTime, this.queuedUntil);
    node.start(at);
    this.queuedUntil = at + buffer.duration;
    this.sources.add(node);
    node.onended = () => this.sources.delete(node);
    this.firstAudio ??= performance.now();
    if (!this.playing) {
      this.playing = true;
      this.h.onVoice(true);
    }
    clearTimeout(this.voiceTimer);
    this.voiceTimer = setTimeout(
      () => {
        this.playing = false;
        this.h.onVoice(false);
      },
      Math.max(0, (this.queuedUntil - ctx.currentTime) * 1000) + 60,
    );
  }

  /** Замолчать сразу: всё поставленное в очередь — стоп. */
  hush() {
    for (const node of this.sources) {
      try {
        node.stop();
      } catch {
        /* уже кончился */
      }
    }
    this.sources.clear();
    this.queuedUntil = 0;
    clearTimeout(this.voiceTimer);
    if (this.playing) {
      this.playing = false;
      this.h.onVoice(false);
    }
  }

  stopMic() {
    this.mic?.stop();
    this.mic = null;
    if (this.vad.speaking) {
      this.vad = new Vad();
      this.send({ type: 'done' });
      this.h.onSpeech(false);
    }
  }

  get listening(): boolean {
    return this.mic !== null;
  }

  close() {
    this.closing = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.stableTimer);
    this.stopMic();
    this.hush();
    this.ws.onclose = null;
    this.ws.close();
    void this.ctx?.close?.();
  }
}
