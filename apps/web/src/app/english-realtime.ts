/**
 * Живой голос Нейта через подписку ChatGPT (ENG-005, D-573): сервер выдаёт временный ключ OpenAI
 * Realtime, браузер говорит с моделью напрямую по WebRTC — звук через сервер Qubite не идёт.
 * Модель слышит и отвечает голосом сама, конец фразы — по смыслу паузы, перебить можно голосом.
 * Расшифровка обеих сторон приходит событиями по каналу данных: она на экране по мере речи, а
 * готовые реплики уходят на сервер — в историю разговора, как у ElevenLabs.
 */
import { CSRF_HEADER, csrfFromCookie, type components } from '@qubite/api-client';
import { api } from '../api';
import { Fail, must } from '../auth/client';

export type RealtimeStarted = components['schemas']['EnglishRealtimeStarted'];
export type RealtimeSession = components['schemas']['EnglishRealtimeSession'];
export type EnglishEngine = components['schemas']['EnglishEngine'];

/** Реплика расшифровки: кто, что, договорил ли. */
export interface Item {
  id: string;
  role: 'learner' | 'tutor';
  text: string;
  done: boolean;
}

/** Расшифровка разговора по порядку (как реплики шли в разговоре). */
export interface Transcript {
  items: Item[];
  /** ID уже отправленных на сервер реплик. */
  sent: ReadonlySet<string>;
}

export const EMPTY: Transcript = { items: [], sent: new Set() };

/** Что делает разговор сейчас — для маскота и подписей. */
export type Activity = 'listening' | 'thinking' | 'speaking' | null;

/** Событие OpenAI Realtime (только поля, которые нужны экрану). */
export interface RtEvent {
  type: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  item?: { id?: string; type?: string; role?: string };
  response?: { status?: string; status_details?: { error?: { message?: string } } };
  error?: { message?: string; code?: string };
}

function upsert(t: Transcript, id: string, role: Item['role'], change: (i: Item) => Item) {
  const at = t.items.findIndex((i) => i.id === id);
  if (at < 0) return { ...t, items: [...t.items, change({ id, role, text: '', done: false })] };
  const items = t.items.slice();
  items[at] = change(items[at]!);
  return { ...t, items };
}

/**
 * Новое состояние расшифровки после события. Чистая функция — проверяется без браузера.
 * Имена событий — GA Realtime API (`response.output_audio_transcript.*`) и прежние
 * (`response.audio_transcript.*`).
 */
export function reduce(t: Transcript, e: RtEvent): Transcript {
  switch (e.type) {
    case 'input_audio_buffer.speech_started':
    case 'input_audio_buffer.committed':
      return e.item_id ? upsert(t, e.item_id, 'learner', (i) => i) : t;
    case 'conversation.item.input_audio_transcription.delta':
      return e.item_id
        ? upsert(t, e.item_id, 'learner', (i) => ({ ...i, text: i.text + (e.delta ?? '') }))
        : t;
    case 'conversation.item.input_audio_transcription.completed':
      return e.item_id
        ? upsert(t, e.item_id, 'learner', (i) => ({
            ...i,
            text: (e.transcript ?? i.text).trim(),
            done: true,
          }))
        : t;
    case 'conversation.item.input_audio_transcription.failed':
      return e.item_id ? upsert(t, e.item_id, 'learner', (i) => ({ ...i, done: true })) : t;
    case 'response.output_item.added':
      return e.item?.id && e.item.role === 'assistant'
        ? upsert(t, e.item.id, 'tutor', (i) => i)
        : t;
    case 'response.output_audio_transcript.delta':
    case 'response.audio_transcript.delta':
      return e.item_id
        ? upsert(t, e.item_id, 'tutor', (i) => ({ ...i, text: i.text + (e.delta ?? '') }))
        : t;
    case 'response.output_audio_transcript.done':
    case 'response.audio_transcript.done':
      return e.item_id
        ? upsert(t, e.item_id, 'tutor', (i) => ({
            ...i,
            text: (e.transcript ?? i.text).trim(),
            done: true,
          }))
        : t;
    case 'response.done':
      // Ответ кончился (или его перебили) — недоговорённое у Нейта тоже готово.
      return { ...t, items: t.items.map((i) => (i.role === 'tutor' ? { ...i, done: true } : i)) };
    default:
      return t;
  }
}

/** Что сейчас происходит по событию (`undefined` — не меняется). */
export function activityOf(e: RtEvent): Activity | undefined {
  switch (e.type) {
    case 'input_audio_buffer.speech_started':
      return 'listening';
    case 'input_audio_buffer.speech_stopped':
    case 'response.created':
      return 'thinking';
    case 'output_audio_buffer.started':
    case 'response.output_audio.delta':
      return 'speaking';
    case 'output_audio_buffer.stopped':
    case 'output_audio_buffer.cleared':
      return null;
    default:
      return undefined;
  }
}

/**
 * Готовые реплики для сервера: с начала по порядку, до первой недоговорённой (чтобы история шла
 * так же, как разговор). Пустые — пропускаются, но отмечаются отправленными.
 */
export function ready(t: Transcript): Item[] {
  const out: Item[] = [];
  for (const i of t.items) {
    if (!i.done) break;
    if (!t.sent.has(i.id)) out.push(i);
  }
  return out;
}

export function markSent(t: Transcript, ids: readonly string[]): Transcript {
  return { ...t, sent: new Set([...t.sent, ...ids]) };
}

/** Секунды → «12 мин» / «40 с». */
export function minutesLeft(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s >= 60 ? `${Math.floor(s / 60)} мин` : `${s} с`;
}

// ---------------------------------------------------------------- ошибки

/** Почему не вышло: что сказать человеку и что предложить. */
export interface RtFailure {
  code:
    | 'chatgpt_not_connected'
    | 'subscription_limit'
    | 'realtime_limit'
    | 'network'
    | 'region'
    | 'mic'
    | 'key'
    | 'time'
    | 'other';
  text: string;
  /** Предложить ElevenLabs. */
  fallback: boolean;
}

const VPN =
  'Браузер не достучался до OpenAI (api.openai.com) — из России он без VPN не открывается. ' +
  'Включи VPN на этом устройстве и попробуй снова, или выбери голос ElevenLabs.';

/** Отказ сервера Qubite (выдача ключа) → понятная ошибка. */
export function serverFailure(code: string, message: string): RtFailure {
  switch (code) {
    case 'chatgpt_not_connected':
      return {
        code,
        text: 'ChatGPT не подключён. Войди через ChatGPT в «Настройки → AI и бюджет» — или говори через ElevenLabs.',
        fallback: true,
      };
    case 'subscription_limit':
      return {
        code,
        text: `Лимит подписки ChatGPT закончился: ${message}. Попробуй позже — или поговори через ElevenLabs.`,
        fallback: true,
      };
    case 'realtime_limit':
      return { code, text: message, fallback: true };
    case 'network':
      return { code, text: 'Нет связи с сервером Qubite. Проверь интернет.', fallback: false };
    default:
      if (/unsupported_country|region/i.test(message))
        return { code: 'region', text: VPN, fallback: true };
      return { code: 'other', text: message, fallback: true };
  }
}

/** Ответ OpenAI на SDP-предложение → понятная ошибка. */
export function openAiFailure(status: number, body: string): RtFailure {
  if (/unsupported_country|region|territory/i.test(body) || status === 403)
    return { code: 'region', text: VPN, fallback: true };
  if (status === 401)
    return {
      code: 'key',
      text: 'Ключ разговора устарел — нажми «Начать» ещё раз.',
      fallback: false,
    };
  if (status === 429)
    return {
      code: 'subscription_limit',
      text: 'OpenAI просит подождать (лимит подписки) — попробуй позже или поговори через ElevenLabs.',
      fallback: true,
    };
  return {
    code: 'other',
    text: `OpenAI не принял разговор (HTTP ${status}). Попробуй ещё раз или выбери ElevenLabs.`,
    fallback: true,
  };
}

export const MIC_FAILURE: RtFailure = {
  code: 'mic',
  text: 'Микрофон недоступен: разреши его браузеру (значок рядом с адресом) и попробуй снова.',
  fallback: false,
};
export const NETWORK_FAILURE: RtFailure = { code: 'network', text: VPN, fallback: true };
export const TIME_FAILURE: RtFailure = {
  code: 'time',
  text: 'Время этого разговора вышло. Можно начать новый — сегодняшний лимит видно в настройках.',
  fallback: false,
};

// ---------------------------------------------------------------- сервер Qubite

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const csrf = csrfFromCookie();
  if (csrf) headers[CSRF_HEADER] = csrf;
  let r: Response;
  try {
    r = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new Fail('network', 'Нет связи с сервером', 0);
  }
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Fail(e.error ?? `http_${r.status}`, e.message ?? 'Сервер не ответил', r.status);
  }
  return (await r.json()) as T;
}

/** Временный ключ живого разговора по своей подписке ChatGPT. */
export async function startRealtime(): Promise<RealtimeStarted> {
  return must(
    api.POST('/api/v1/english/realtime', { body: { key: crypto.randomUUID() } }),
  ) as Promise<RealtimeStarted>;
}

export async function saveLines(id: string, items: Item[]) {
  return postJson<components['schemas']['EnglishRealtimeSaved']>(
    `/api/v1/english/realtime/${id}/lines`,
    { lines: items.map((i) => ({ item: i.id, role: i.role, text: i.text })) },
  );
}

export async function finishRealtime(id: string, seconds: number, end: boolean) {
  return postJson<components['schemas']['EnglishRealtimeFinished']>(
    `/api/v1/english/realtime/${id}/finish`,
    { seconds: Math.max(0, Math.round(seconds)), end },
  );
}

// ---------------------------------------------------------------- WebRTC

export interface RealtimeHandlers {
  onTranscript(t: Transcript): void;
  onActivity(a: Activity): void;
  /** Связь установлена / пропала. */
  onLink(state: 'connecting' | 'live' | 'closed'): void;
  onFailure(f: RtFailure): void;
  /** Осталось секунд в этом сеансе. */
  onTick(left: number): void;
  /** Готовые реплики — на сервер (вызывающий решает как). */
  onLines(items: Item[]): void;
}

/** Есть ли в браузере всё для живого разговора. */
export function canRealtime(): boolean {
  return (
    typeof RTCPeerConnection !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/**
 * Один живой разговор: микрофон → WebRTC → модель; голос модели — в `<audio>`; события —
 * по каналу данных `oai-events`. Время считается без пауз; потолок сеанса — от сервера.
 */
export class RealtimeTalk {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private transcript: Transcript = EMPTY;
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeMs = 0;
  private lastTick = 0;
  private closed = false;
  paused = false;

  constructor(
    private session: RealtimeSession,
    private h: RealtimeHandlers,
  ) {}

  get seconds(): number {
    return this.activeMs / 1000;
  }

  async start(): Promise<void> {
    this.h.onLink('connecting');
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.fail(MIC_FAILURE);
      return;
    }
    const pc = new RTCPeerConnection();
    this.pc = pc;
    const audio = document.createElement('audio');
    audio.autoplay = true;
    this.audio = audio;
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] ?? null;
    };
    for (const track of this.mic.getTracks()) pc.addTrack(track, this.mic);
    const dc = pc.createDataChannel('oai-events');
    this.dc = dc;
    dc.onopen = () => {
      // Нейт начинает сам — с вопроса урока (так в инструкциях).
      this.send({ type: 'response.create' });
      this.h.onLink('live');
      this.lastTick = performance.now();
      this.timer = setInterval(() => this.tick(), 1000);
    };
    dc.onmessage = (m) => this.event(m.data);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.fail(NETWORK_FAILURE);
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    let r: Response;
    try {
      r = await fetch(this.session.calls_url, {
        method: 'POST',
        body: offer.sdp ?? '',
        headers: {
          Authorization: `Bearer ${this.session.client_secret}`,
          'Content-Type': 'application/sdp',
        },
      });
    } catch {
      this.fail(NETWORK_FAILURE);
      return;
    }
    const answer = await r.text();
    if (!r.ok) {
      this.fail(openAiFailure(r.status, answer));
      return;
    }
    if (this.closed) return;
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  }

  private send(event: Record<string, unknown>) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(event));
  }

  private event(raw: unknown) {
    let e: RtEvent;
    try {
      e = JSON.parse(String(raw)) as RtEvent;
    } catch {
      return;
    }
    if (e.type === 'error') {
      // Отменить нечего и т. п. — не мешает разговору; остальное показать.
      const code = e.error?.code ?? '';
      if (code !== 'response_cancel_not_active')
        this.h.onFailure({
          code: 'other',
          text: e.error?.message ?? 'OpenAI сообщил об ошибке',
          fallback: false,
        });
      return;
    }
    const a = activityOf(e);
    if (a !== undefined) this.h.onActivity(a);
    const next = reduce(this.transcript, e);
    if (next !== this.transcript) {
      this.transcript = next;
      this.h.onTranscript(next);
      this.flush();
    }
    if (e.type === 'response.done' && e.response?.status === 'failed') {
      const msg = e.response.status_details?.error?.message ?? 'ответ не получился';
      this.h.onFailure({ code: 'other', text: `OpenAI: ${msg}`, fallback: false });
    }
  }

  /** Готовые реплики — наружу (на сервер), один раз каждую. */
  private flush() {
    const items = ready(this.transcript);
    if (items.length === 0) return;
    this.transcript = markSent(
      this.transcript,
      items.map((i) => i.id),
    );
    const real = items.filter((i) => i.text.trim());
    if (real.length) this.h.onLines(real);
  }

  private tick() {
    const now = performance.now();
    if (!this.paused) this.activeMs += now - this.lastTick;
    this.lastTick = now;
    const left = this.session.max_seconds - this.seconds;
    this.h.onTick(left);
    if (left <= 0) this.fail(TIME_FAILURE);
  }

  /** Написать Нейту текстом (в том же живом разговоре). */
  text(text: string) {
    // ID элемента у OpenAI — до 32 знаков.
    const id = `text_${crypto.randomUUID().replaceAll('-', '').slice(0, 26)}`;
    this.send({
      type: 'conversation.item.create',
      item: { id, type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    });
    this.send({ type: 'response.create' });
    this.transcript = {
      ...this.transcript,
      items: [...this.transcript.items, { id, role: 'learner', text, done: true }],
    };
    this.h.onTranscript(this.transcript);
    this.flush();
  }

  /** Пауза: микрофон молчит, Нейт замолкает, время не идёт. */
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.mic?.getTracks().forEach((t) => (t.enabled = false));
    this.send({ type: 'response.cancel' });
    this.send({ type: 'output_audio_buffer.clear' });
    if (this.audio) this.audio.muted = true;
    this.h.onActivity(null);
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.mic?.getTracks().forEach((t) => (t.enabled = true));
    if (this.audio) this.audio.muted = false;
  }

  /** Перебить: Нейт замолкает сразу. */
  interrupt() {
    this.send({ type: 'response.cancel' });
    this.send({ type: 'output_audio_buffer.clear' });
  }

  private fail(f: RtFailure) {
    if (this.closed) return;
    this.close();
    this.h.onFailure(f);
  }

  /** Закрыть всё. Недоговорённое — тоже на сервер. */
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    if (!this.paused && this.lastTick) this.activeMs += performance.now() - this.lastTick;
    this.transcript = {
      ...this.transcript,
      items: this.transcript.items.map((i) => ({ ...i, done: true })),
    };
    this.flush();
    this.dc?.close();
    this.pc?.close();
    this.mic?.getTracks().forEach((t) => t.stop());
    if (this.audio) this.audio.srcObject = null;
    this.h.onLink('closed');
  }
}
