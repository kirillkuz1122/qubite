/**
 * Диктовка «начал говорить → получил текст» (ENG-005, для ENG-006 и других полей ответа).
 *
 * Основной путь — своя подписка ChatGPT: сервер выдаёт временный ключ сеанса только
 * распознавания (`gpt-4o-mini-transcribe`, до 2 минут), браузер шлёт звук в OpenAI напрямую по
 * WebRTC и получает текст по мере речи (`onPartial`). Нет подписки, лимит, OpenAI недоступен —
 * запасной путь: запись целиком и распознавание ElevenLabs на сервере (`/english/transcribe`).
 *
 *     const d = await startDictation({ language: 'en', onPartial: setDraft });
 *     …
 *     const text = await d.stop(); // или d.cancel()
 *
 * В React — {@link useDictation}.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Fail } from '../auth/client';
import { canRecord, record } from './english';
import {
  EMPTY,
  finishRealtime,
  postJson,
  reduce,
  type RealtimeSession,
  type RtEvent,
  type Transcript,
} from './english-realtime';
import { toBase64 } from './english-view';

export interface DictationOptions {
  /** Язык речи (`en`, `ru`); не задан — определит распознавание. */
  language?: string | undefined;
  /** Текст по мере речи (только ChatGPT). */
  onPartial?: (text: string) => void;
}

export interface Dictation {
  /** Чем распознаётся. */
  readonly via: 'chatgpt' | 'elevenlabs';
  /** Закончить и получить текст. */
  stop(): Promise<string>;
  /** Бросить без текста. */
  cancel(): void;
}

/** Сколько ждать последних слов после «стоп». */
const SETTLE_MS = 4_000;

/** Текст расшифровки: реплики человека по порядку. */
export function dictated(t: Transcript): string {
  return t.items
    .filter((i) => i.role === 'learner')
    .map((i) => i.text.trim())
    .filter(Boolean)
    .join(' ');
}

/** Всё ли сказанное уже расшифровано. */
export function settled(t: Transcript): boolean {
  return t.items.every((i) => i.role !== 'learner' || i.done);
}

/** Начать диктовку: ChatGPT, если можно, иначе запись для ElevenLabs. */
export async function startDictation(opts: DictationOptions = {}): Promise<Dictation> {
  let session: RealtimeSession | null = null;
  try {
    session = await postJson<RealtimeSession>('/api/v1/english/dictation', {
      key: crypto.randomUUID(),
      language: opts.language ?? null,
    });
  } catch (e) {
    // Нет подписки, лимит, сеть — запасной путь; нет прав — дальше не пробуем.
    if (e instanceof Fail && e.status === 403) throw e;
  }
  if (session && typeof RTCPeerConnection !== 'undefined') {
    try {
      return await viaChatGpt(session, opts);
    } catch (e) {
      if (e instanceof Fail && e.code === 'mic') throw e;
      // OpenAI недоступен — сеанс закрыть и записать по-старому.
      void finishRealtime(session.id, 0, false).catch(() => undefined);
    }
  }
  return viaElevenLabs();
}

async function viaChatGpt(session: RealtimeSession, opts: DictationOptions): Promise<Dictation> {
  let mic: MediaStream;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Fail('mic', 'Микрофон недоступен: разреши его браузеру', 0);
  }
  const pc = new RTCPeerConnection();
  for (const track of mic.getTracks()) pc.addTrack(track, mic);
  const dc = pc.createDataChannel('oai-events');
  let t: Transcript = EMPTY;
  let wake: (() => void) | null = null;
  dc.onmessage = (m) => {
    let e: RtEvent;
    try {
      e = JSON.parse(String(m.data)) as RtEvent;
    } catch {
      return;
    }
    const next = reduce(t, e);
    if (next === t) return;
    t = next;
    opts.onPartial?.(dictated(t));
    if (settled(t)) wake?.();
  };
  const started = performance.now();
  const close = () => {
    dc.close();
    pc.close();
    mic.getTracks().forEach((track) => track.stop());
  };
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const r = await fetch(session.calls_url, {
      method: 'POST',
      body: offer.sdp ?? '',
      headers: {
        Authorization: `Bearer ${session.client_secret}`,
        'Content-Type': 'application/sdp',
      },
    });
    if (!r.ok) throw new Fail('openai', `OpenAI: HTTP ${r.status}`, r.status);
    await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
  } catch (e) {
    close();
    throw e;
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    close();
    void finishRealtime(session.id, (performance.now() - started) / 1000, false).catch(
      () => undefined,
    );
  };
  return {
    via: 'chatgpt',
    async stop() {
      // Звук до этого места — распознать, дождаться последних слов.
      mic.getTracks().forEach((track) => (track.enabled = false));
      if (dc.readyState === 'open') dc.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      if (!settled(t) || t.items.length === 0)
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, SETTLE_MS);
        });
      finish();
      return dictated(t);
    },
    cancel: finish,
  };
}

async function viaElevenLabs(): Promise<Dictation> {
  if (!canRecord()) throw new Fail('mic', 'Этот браузер не умеет записывать звук', 0);
  let stopping: Promise<string> | null = null;
  let rec: Awaited<ReturnType<typeof record>>;
  try {
    rec = await record(() => void stop());
  } catch {
    throw new Fail('mic', 'Микрофон недоступен: разреши его браузеру', 0);
  }
  async function send(): Promise<string> {
    const { audio, ms } = await rec.stop();
    if (ms < 300 || audio.size === 0) return '';
    const r = await postJson<{ text: string }>('/api/v1/english/transcribe', {
      key: crypto.randomUUID(),
      audio_base64: toBase64(new Uint8Array(await audio.arrayBuffer())),
      mime: audio.type || 'audio/webm',
      duration_ms: Math.round(ms),
    });
    return r.text.trim();
  }
  function stop() {
    stopping ??= send();
    return stopping;
  }
  return { via: 'elevenlabs', stop, cancel: () => rec.cancel() };
}

/** Диктовка в React: кнопка «микрофон» у поля ответа. */
export function useDictation(language?: string) {
  const current = useRef<Dictation | null>(null);
  const [state, setState] = useState<'idle' | 'listening' | 'working'>('idle');
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => current.current?.cancel(), []);

  const start = useCallback(async () => {
    if (current.current) return;
    setError(null);
    setPartial('');
    setState('working');
    try {
      current.current = await startDictation({ language, onPartial: setPartial });
      setState('listening');
    } catch (e) {
      setState('idle');
      setError(e instanceof Error ? e.message : 'Не получилось начать запись');
    }
  }, [language]);

  /** Закончить; вернёт текст (пусто — ничего не расслышал или ошибка). */
  const stop = useCallback(async (): Promise<string> => {
    const d = current.current;
    if (!d) return '';
    current.current = null;
    setState('working');
    try {
      return await d.stop();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не расслышал');
      return '';
    } finally {
      setState('idle');
    }
  }, []);

  const cancel = useCallback(() => {
    current.current?.cancel();
    current.current = null;
    setState('idle');
  }, []);

  return { state, partial, error, start, stop, cancel };
}
