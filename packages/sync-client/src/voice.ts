/**
 * Голосовые записи без потерь (CMD-005b): запись сначала ложится на устройство (IndexedDB),
 * потом уходит на сервер `POST /api/v1/inbox/voice`. ID записи придумывает устройство, а
 * повтор с тем же ID сервер принимает как уже сохранённый (D-847) — поэтому оборванную
 * отправку можно смело повторять: дубля во «Входящих» не будет.
 *
 * Что делать с неудачей, решает {@link voiceFailure}: нет сети, сервер прилёг, не вошли —
 * запись ждёт и уходит при следующей попытке; сервер отказал насовсем (не тот формат,
 * слишком большая) — запись остаётся на устройстве с причиной, удалить её может только человек.
 */
import { HttpError } from './http';
import { done, promisify } from './store';

export type VoiceSource = 'web' | 'desktop' | 'android';

/** Тело запроса — как `VoiceCaptureRequest` сервера. */
export interface VoiceCapture {
  id: string;
  audio_base64: string;
  /** `audio/webm;codecs=opus`, `audio/mp4`… */
  mime: string;
  duration_ms: number;
  /** текст, распознанный на устройстве (способ `device`/`local`); сервер берёт его только там */
  text?: string;
  source: VoiceSource;
}

/** Запись в очереди на устройстве. */
export interface QueuedVoice extends VoiceCapture {
  captured_at_ms: number;
  attempts: number;
  /** почему последняя попытка не прошла; нет — просто не было сети */
  error?: string;
  /** сервер отказал насовсем: повтор не поможет, решать человеку */
  rejected?: boolean;
}

/** Что сервер ответил на запись. */
export interface VoiceResult {
  id: string;
  transcribed: boolean;
  /** почему остался только звук (D-846); `null` — текст получен */
  reason: string | null;
  at_ms: number;
}

/** Как очередь говорит с сервером. В тестах — подделка, в приложении — HTTP. */
export interface VoiceTransport {
  send(capture: VoiceCapture): Promise<{ transcribed: boolean; reason?: string | null }>;
}

/** Итог одной отправки очереди. */
export interface VoiceFlush {
  sent: VoiceResult[];
  /** осталось на устройстве (ждут сети или решения человека) */
  left: number;
}

/** Чем кончилась неудачная попытка: ждать и повторить — или отказ насовсем. */
export interface VoiceFailure {
  retry: boolean;
  /** что сказать человеку; нет — «отправится, когда появится сеть» */
  message?: string;
}

/** Ответы сервера, после которых повтор того же запроса ничего не изменит. */
const FINAL = new Set([400, 404, 409, 413, 415, 422]);

export function voiceFailure(error: unknown): VoiceFailure {
  if (!(error instanceof HttpError)) return { retry: true };
  if (FINAL.has(error.status)) return { retry: false, message: error.message };
  if (error.status === 401) return { retry: true, message: 'нужно войти — отправится после входа' };
  if (error.status >= 500) return { retry: true, message: 'сервер не ответил — повторим позже' };
  return { retry: true, message: error.message };
}

/** Сколько помнить, что ответил сервер (причины «только звук» показываются у записи). */
const KEEP_RESULTS_MS = 30 * 24 * 3600 * 1000;
const VERSION = 1;

export class VoiceQueue {
  private listeners = new Set<() => void>();
  private running: Promise<VoiceFlush> | null = null;
  private again = false;
  private closed = false;

  private constructor(
    private readonly db: IDBDatabase,
    private readonly transport: VoiceTransport,
  ) {}

  static async open(
    name: string,
    transport: VoiceTransport,
    factory: IDBFactory = indexedDB,
    now: number = Date.now(),
  ): Promise<VoiceQueue> {
    const request = factory.open(name, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('queue', { keyPath: 'id' });
      db.createObjectStore('results', { keyPath: 'id' });
    };
    const db = await promisify(request);
    // Хранилище удаляют (выход в другой вкладке) — отпустить его.
    db.onversionchange = () => db.close();
    const queue = new VoiceQueue(db, transport);
    await queue.prune(now);
    return queue;
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    this.db.close();
  }

  /** Подписка на любое изменение очереди или ответов сервера. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Сохранить запись на устройстве. Отправка — {@link flush}. */
  async add(capture: VoiceCapture, now: number = Date.now()): Promise<QueuedVoice> {
    const queued: QueuedVoice = { ...capture, captured_at_ms: now, attempts: 0 };
    const tx = this.db.transaction('queue', 'readwrite');
    tx.objectStore('queue').put(queued);
    await done(tx);
    this.emit();
    return queued;
  }

  /** Записи на устройстве, свежие сверху. */
  async list(): Promise<QueuedVoice[]> {
    const tx = this.db.transaction('queue');
    const all = await promisify(tx.objectStore('queue').getAll() as IDBRequest<QueuedVoice[]>);
    // в одну миллисекунду — по ID: UUIDv7 растёт со временем
    return all.sort(
      (a, b) => b.captured_at_ms - a.captured_at_ms || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );
  }

  /** Что сервер ответил на отправленные записи (по ID). */
  async results(): Promise<Map<string, VoiceResult>> {
    const tx = this.db.transaction('results');
    const all = await promisify(tx.objectStore('results').getAll() as IDBRequest<VoiceResult[]>);
    return new Map(all.map((r) => [r.id, r]));
  }

  /** Человек решил не отправлять запись. */
  async remove(id: string): Promise<void> {
    const tx = this.db.transaction('queue', 'readwrite');
    tx.objectStore('queue').delete(id);
    await done(tx);
    this.emit();
  }

  /**
   * Отправить всё, что ждёт, по порядку записи. Одновременно идёт одна отправка; позвали
   * ещё раз во время неё — после неё пройдёт ещё одна, но только по новым записям: уже
   * не отправленное в этот раз ждёт следующего повода (сеть, синхронизация).
   */
  flush(now: () => number = Date.now): Promise<VoiceFlush> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      const total: VoiceFlush = { sent: [], left: 0 };
      const tried = new Set<string>();
      do {
        this.again = false;
        const pass = await this.pass(now, tried);
        total.sent.push(...pass.sent);
        total.left = pass.left;
      } while (this.again && !this.closed);
      return total;
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async pass(now: () => number, tried: Set<string>): Promise<VoiceFlush> {
    const waiting = (await this.list()).reverse(); // старые первыми
    const sent: VoiceResult[] = [];
    let left = 0;
    let stop = false;
    for (const item of waiting) {
      if (stop || item.rejected || this.closed || tried.has(item.id)) {
        left += 1;
        continue;
      }
      tried.add(item.id);
      // снимок очереди мог устареть: пока шла прошлая отправка, запись могли удалить
      const tx0 = this.db.transaction('queue', 'readonly');
      const alive = await promisify(tx0.objectStore('queue').count(item.id));
      if (alive === 0) continue;
      try {
        const { id, audio_base64, mime, duration_ms, text, source } = item;
        const reply = await this.transport.send({
          id,
          audio_base64,
          mime,
          duration_ms,
          source,
          ...(text ? { text } : {}),
        });
        const result: VoiceResult = {
          id,
          transcribed: reply.transcribed,
          reason: reply.reason ?? null,
          at_ms: now(),
        };
        if (this.closed) return { sent, left: left + 1 };
        const tx = this.db.transaction(['queue', 'results'], 'readwrite');
        tx.objectStore('queue').delete(id);
        tx.objectStore('results').put(result);
        await done(tx);
        sent.push(result);
      } catch (error) {
        if (this.closed) return { sent, left: left + 1 };
        const failure = voiceFailure(error);
        const next: QueuedVoice = { ...item, attempts: item.attempts + 1 };
        delete next.error;
        if (failure.message) next.error = failure.message;
        if (!failure.retry) next.rejected = true;
        // запись могли удалить, пока шла отправка, — не возвращаем её из устаревшего снимка
        const tx = this.db.transaction('queue', 'readwrite');
        const store = tx.objectStore('queue');
        const existing = await promisify(store.get(item.id) as IDBRequest<QueuedVoice | undefined>);
        if (existing) store.put(next);
        await done(tx);
        if (existing) left += 1;
        // нет сети или сервер не принимает никого — остальные попробуем в следующий раз
        if (failure.retry) stop = true;
      }
      this.emit();
    }
    return { sent, left };
  }

  /** Старые ответы сервера больше не нужны: запись давно разобрана. */
  private async prune(now: number): Promise<void> {
    const old = [...(await this.results()).values()].filter((r) => now - r.at_ms > KEEP_RESULTS_MS);
    if (old.length === 0) return;
    const tx = this.db.transaction('results', 'readwrite');
    for (const r of old) tx.objectStore('results').delete(r.id);
    await done(tx);
  }

  private emit(): void {
    if (this.closed) return;
    for (const listener of this.listeners) listener();
  }
}
