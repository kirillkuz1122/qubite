/**
 * «Английский» (ENG-001): запросы к `/api/v1/english/*`, запись голоса и проигрывание речи.
 * Всё платное (распознавание, модель, речь) делает сервер через AI-шлюз с бюджетом.
 */
import { CSRF_HEADER, csrfFromCookie, type components } from '@qubite/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export async function sendTurn(saying: Saying): Promise<EnglishTurn> {
  const key = crypto.randomUUID();
  const body =
    'text' in saying
      ? { key, text: saying.text }
      : {
          key,
          audio_base64: toBase64(new Uint8Array(await saying.audio.arrayBuffer())),
          mime: saying.audio.type || 'audio/webm',
          duration_ms: Math.round(saying.ms),
        };
  let r;
  try {
    r = await api.POST('/api/v1/english/turn', { body });
  } catch {
    throw new TurnFail('network', 'Нет связи с сервером', 0, null);
  }
  if (r.error !== undefined || !r.response.ok) {
    const e = (r.error ?? {}) as { error?: string; message?: string; heard?: string | null };
    throw new TurnFail(
      e.error ?? `http_${r.response.status}`,
      e.message ?? 'Сервер сейчас не отвечает. Попробуйте чуть позже',
      r.response.status,
      e.heard ?? null,
    );
  }
  return r.data as EnglishTurn;
}

/** Ход: ответ репетитора сразу кладётся в экран (без лишнего запроса). */
export function useTurn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sendTurn,
    onSuccess: (t) =>
      qc.setQueryData<EnglishOverview>(ENGLISH, (o) =>
        o
          ? {
              ...o,
              session: t.session,
              messages: [...o.messages, t.learner, t.tutor],
            }
          : o,
      ),
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
