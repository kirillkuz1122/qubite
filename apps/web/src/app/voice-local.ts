/**
 * «Локально» (CMD-005c, D-686): речь распознаёт Whisper на компьютере человека, а не Pi.
 * Браузер сам отправляет запись на его сервер (whisper.cpp: `POST {адрес}/inference`, multipart
 * `file` + `response_format=json`, ответ `{"text": "…"}`) и шлёт в Qubite уже готовый текст
 * полем `text` вместе со звуком — как «встроенное». Не вышло — запись уходит только звуком
 * (D-846), а причина простыми словами остаётся у записи.
 *
 * Адрес хранится только на этом устройстве: у каждого компьютера свой Whisper.
 */
import type { Recognized } from './inbox-context';

export const LOCAL_DEFAULT_URL = 'http://127.0.0.1:8080';
/** Дольше записи ждать не будем: распознавание двух минут на обычном ПК укладывается. */
export const LOCAL_TIMEOUT_MS = 60_000;
/** Проверка — полсекунды тишины: ответ быстрый, если сервер вообще жив. */
const CHECK_TIMEOUT_MS = 20_000;
const STORE_KEY = 'qubite.voice.local-url';

/** Адрес Whisper на этом устройстве (по умолчанию — whisper.cpp на этом же компьютере). */
export function localWhisperUrl(): string {
  try {
    return localStorage.getItem(STORE_KEY) ?? LOCAL_DEFAULT_URL;
  } catch {
    return LOCAL_DEFAULT_URL;
  }
}

export function setLocalWhisperUrl(url: string): void {
  try {
    localStorage.setItem(STORE_KEY, url.trim());
  } catch {
    /* хранилище закрыто (приватный режим) — адрес проживёт до перезагрузки в поле */
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Что не так с адресом; `null` — можно пробовать. `page` — протокол страницы Qubite: с https
 * браузер пустит на http только к этому же компьютеру (127.0.0.1, localhost).
 */
export function localUrlProblem(
  url: string,
  page: string = globalThis.location?.protocol ?? 'https:',
): string | null {
  const u = url.trim();
  if (!u) return 'Впишите адрес Whisper, например http://127.0.0.1:8080';
  let p: URL;
  try {
    p = new URL(u);
  } catch {
    return 'Адрес вида http://127.0.0.1:8080';
  }
  if (p.protocol !== 'http:' && p.protocol !== 'https:') return 'Адрес вида http://127.0.0.1:8080';
  if (page === 'https:' && p.protocol === 'http:' && !LOOPBACK.has(p.hostname))
    return 'Qubite открыт по https — браузер пустит на http только к этому компьютеру (127.0.0.1). Для другого нужен https.';
  return null;
}

/** Почему Whisper не дал текст — коротко, для записи во «Входящих». */
export type LocalFailKind = 'nourl' | 'offline' | 'timeout' | 'http' | 'format' | 'silent';

const WHY: Record<LocalFailKind, string> = {
  nourl: 'Не задан адрес локального Whisper',
  offline: 'Локальный Whisper не ответил',
  timeout: 'Локальный Whisper не успел за минуту',
  http: 'Локальный Whisper ответил ошибкой',
  format: 'Локальный Whisper ответил не текстом',
  silent: 'Локальный Whisper не разобрал слов',
};

class LocalFail extends Error {
  constructor(
    readonly kind: LocalFailKind,
    readonly status = 0,
  ) {
    super(WHY[kind]);
  }
}

const EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
};

/** Один запрос к whisper.cpp: текст (может быть пустым) или `LocalFail`. */
async function ask(url: string, audio: Blob, mime: string, timeoutMs: number): Promise<string> {
  if (localUrlProblem(url)) throw new LocalFail('nourl');
  const form = new FormData();
  const ext = EXT[mime.split(';')[0]!.trim().toLowerCase()] ?? 'webm';
  form.append('file', audio, `voice.${ext}`);
  form.append('response_format', 'json');
  const stop = new AbortController();
  let late = false;
  const timer = setTimeout(() => {
    late = true;
    stop.abort();
  }, timeoutMs);
  let r: Response;
  try {
    r = await fetch(`${url.trim().replace(/\/+$/, '')}/inference`, {
      method: 'POST',
      body: form,
      signal: stop.signal,
      // чужой сервер: ни cookie, ни адреса страницы Qubite ему не нужны
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new LocalFail(late ? 'timeout' : 'offline');
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) throw new LocalFail('http', r.status);
  const body: unknown = await r.json().catch(() => null);
  const text = body && typeof body === 'object' ? (body as { text?: unknown }).text : undefined;
  if (typeof text !== 'string') throw new LocalFail('format');
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Распознать запись своим Whisper. Не бросает: текст — или почему его нет (запись всё равно
 * уйдёт звуком).
 */
export async function transcribeLocal(
  url: string,
  audio: Blob,
  mime: string,
  timeoutMs = LOCAL_TIMEOUT_MS,
): Promise<Recognized> {
  try {
    const text = await ask(url, audio, mime, timeoutMs);
    return text ? { text } : { why: WHY.silent };
  } catch (e) {
    if (e instanceof LocalFail)
      return { why: e.kind === 'http' ? `${WHY.http} ${e.status}` : e.message };
    return { why: WHY.offline };
  }
}

/** Итог «Проверить»: сервер ответил как whisper.cpp — или что не так, простыми словами. */
export type LocalCheck = { ok: true } | { ok: false; message: string };

export async function checkLocal(url: string, timeoutMs = CHECK_TIMEOUT_MS): Promise<LocalCheck> {
  const problem = localUrlProblem(url);
  if (problem) return { ok: false, message: problem };
  try {
    // тишина — ответ без слов, это нормально: главное, что сервер отвечает как Whisper
    await ask(url, silence(), 'audio/wav', timeoutMs);
    return { ok: true };
  } catch (e) {
    const fail = e instanceof LocalFail ? e : new LocalFail('offline');
    switch (fail.kind) {
      case 'timeout':
        return { ok: false, message: 'Whisper не ответил за 20 секунд — компьютер занят?' };
      case 'http':
        return {
          ok: false,
          message: `Whisper ответил ошибкой ${fail.status}. Это точно адрес whisper-server?`,
        };
      case 'format':
        return { ok: false, message: 'По этому адресу отвечает не Whisper.' };
      default:
        return {
          ok: false,
          message:
            'Whisper не отвечает. Запущен ли он? Если браузер спросит про доступ к устройствам в сети — разрешите.',
        };
    }
  }
}

/** Полсекунды тишины в WAV (16 кГц, моно, 16 бит) — для проверки, без микрофона. */
export function silence(): Blob {
  const rate = 16_000;
  const samples = rate / 2;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  tag(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // моно
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, 'data');
  v.setUint32(40, samples * 2, true);
  return new Blob([buf], { type: 'audio/wav' });
}
