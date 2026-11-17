/**
 * «Английский» (ENG-001): запросы к `/api/v1/english/*`, запись голоса и проигрывание речи.
 * Всё платное (распознавание, модель, речь) делает сервер через AI-шлюз с бюджетом.
 */
import { CSRF_HEADER, csrfFromCookie, type components } from '@qubite/api-client';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { currentAccount } from '../account';
import { api } from '../api';
import { Fail, must } from '../auth/client';
import { MAX_RECORD_MS, pickMime, toBase64 } from './english-view';

export type EnglishOverview = components['schemas']['EnglishOverview'];
export type EnglishMessage = components['schemas']['EnglishMessage'];
export type EnglishTurn = components['schemas']['EnglishTurn'];

export const ENGLISH = ['english'] as const;

export function useEnglish() {
  return useQuery({
    queryKey: ENGLISH,
    queryFn: () => must(api.GET('/api/v1/english')),
    retry: false,
  });
}

export function useStart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => must(api.POST('/api/v1/english/session')),
    onSuccess: () => qc.invalidateQueries({ queryKey: ENGLISH }),
  });
}

export function useFinish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => must(api.POST('/api/v1/english/session/finish')),
    onSuccess: () => qc.invalidateQueries({ queryKey: ENGLISH }),
  });
}

/** Что сказать: текст или запись. */
export type Saying = { text: string } | { audio: Blob; ms: number };

/** Отказ хода; `heard` — что успели распознать (положить в поле, отправить текстом). */
export class TurnFail extends Fail {
  constructor(
    code: string,
    message: string,
    status: number,
    readonly heard: string | null,
  ) {
    super(code, message, status);
  }
}

/** Повтор хода после обрыва (D-972): каждые 5 с, не дольше минуты. */
export const TURN_RETRY_MS = 5_000;
export const TURN_RETRY_FOR_MS = 60_000;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Обрыв, после которого ход мог дойти до конца на сервере: 408 (голосовой ход — до двух
 * вызовов AI по 60 с, а запрос ждёт 90 с), «ещё думаю» или сеть пропала по дороге.
 * Повтор с тем же `key` бесплатный — сервер отдаёт уже сохранённый ход.
 */
function worthRetry(fail: TurnFail): boolean {
  if (fail.code === 'network') return typeof navigator === 'undefined' || navigator.onLine;
  return fail.status === 408 || fail.code === 'in_progress';
}

/** Часы и ожидание — подменяются в тестах. */
export type TurnClock = { wait: (ms: number) => Promise<void>; now: () => number };
const REAL_CLOCK: TurnClock = { wait: sleep, now: () => Date.now() };

export async function sendTurn(
  saying: Saying,
  clock: TurnClock = REAL_CLOCK,
): Promise<EnglishTurn> {
  const key = crypto.randomUUID();
  // Повтор идёт только от того, кто сказал: сменился аккаунт — его реплику не отправляем.
  const account = currentAccount();
  const body =
    'text' in saying
      ? { key, text: saying.text }
      : {
          key,
          audio_base64: toBase64(new Uint8Array(await saying.audio.arrayBuffer())),
          mime: saying.audio.type || 'audio/webm',
          duration_ms: Math.round(saying.ms),
        };
  const send = async (signal: AbortSignal | null = null): Promise<EnglishTurn | TurnFail> => {
    let r;
    try {
      r = await api.POST('/api/v1/english/turn', { body, signal });
    } catch {
      return new TurnFail('network', 'Нет связи с сервером', 0, null);
    }
    if (r.error !== undefined || !r.response.ok) {
      const e = (r.error ?? {}) as { error?: string; message?: string; heard?: string | null };
      return new TurnFail(
        e.error ?? `http_${r.response.status}`,
        e.message ?? 'Сервер сейчас не отвечает. Попробуйте чуть позже',
        r.response.status,
        e.heard ?? null,
      );
    }
    return r.data as EnglishTurn;
  };
  // Первая попытка ждёт сколько нужно (сервер сам обрывает на 90 с). Повторы — в общей
  // минуте от первого обрыва, считая и время самих запросов: ответ на повтор быстрый
  // (готовый ход или «ещё думаю»), долгий — обрываем.
  let result = await send();
  const deadline = clock.now() + TURN_RETRY_FOR_MS;
  while (result instanceof TurnFail) {
    if (!worthRetry(result) || currentAccount() !== account) throw result;
    if (clock.now() + TURN_RETRY_MS >= deadline) throw result;
    await clock.wait(TURN_RETRY_MS);
    if (currentAccount() !== account) throw result;
    result = await send(AbortSignal.timeout(Math.max(1, deadline - clock.now())));
  }
  return result;
}

/** Записанный ход — в экран без лишнего запроса. Уже загруженные реплики (ход пришёл
 * повтором, а обзор успел обновиться) второй раз не добавляются. */
export function appendTurn(qc: QueryClient, t: EnglishTurn) {
  // Ход пришёл повтором, а разговор за это время закончили или начали другой — старый
  // ход не приклеиваем к текущему: обзор загружается заново.
  const shown = qc.getQueryData<EnglishOverview>(ENGLISH);
  if (shown && (shown.session?.id !== t.session.id || t.session.finished_at)) {
    void qc.invalidateQueries({ queryKey: ENGLISH });
    return;
  }
  qc.setQueryData<EnglishOverview>(ENGLISH, (o) => {
    if (!o) return o;
    const have = new Set(o.messages.map((m) => m.id));
    return {
      ...o,
      session: t.session,
      messages: [...o.messages, ...[t.learner, t.tutor].filter((m) => !have.has(m.id))],
    };
  });
}

/** Ход целиком (запасной путь без потока). */
export function useTurn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (saying: Saying) => sendTurn(saying),
    onSuccess: (t) => appendTurn(qc, t),
  });
}

/** Голос реплики репетитора (MP3). Готовый сервер отдаёт бесплатно. */
export async function fetchSpeech(id: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const csrf = csrfFromCookie();
  if (csrf) headers[CSRF_HEADER] = csrf;
  const r = await fetch(`/api/v1/english/messages/${id}/speech`, {
    method: 'POST',
    credentials: 'include',
    headers,
  });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Fail(e.error ?? `http_${r.status}`, e.message ?? 'Голос не получен', r.status);
  }
  return r.blob();
}

/** Есть ли в браузере запись с микрофона. */
export function canRecord(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  );
}

/** Идущая запись: `stop()` отдаёт звук и длину. Сама останавливается через минуту. */
export interface Recording {
  stop(): Promise<{ audio: Blob; ms: number }>;
  cancel(): void;
}

export async function record(onAutoStop: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMime((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const started = performance.now();
  rec.start();
  const release = () => stream.getTracks().forEach((t) => t.stop());
  const timer = setTimeout(onAutoStop, MAX_RECORD_MS);
  return {
    stop: () =>
      new Promise((resolve) => {
        clearTimeout(timer);
        rec.onstop = () => {
          release();
          resolve({
            audio: new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }),
            ms: performance.now() - started,
          });
        };
        rec.stop();
      }),
    cancel: () => {
      clearTimeout(timer);
      rec.onstop = release;
      if (rec.state !== 'inactive') rec.stop();
      else release();
    },
  };
}
