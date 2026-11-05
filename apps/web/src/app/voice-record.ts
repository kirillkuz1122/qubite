/**
 * Запись с микрофона для голосового ввода (CMD-005b): MediaRecorder, автостоп на двух минутах и,
 * если человек выбрал «встроенное в браузер», распознавание речи браузером (Web Speech API)
 * параллельно с записью. Звук сохраняется всегда; готовый текст уходит вместе с ним.
 */
import { MAX_VOICE_MS, VOICE_BITRATE, pickVoiceMime } from './voice-view';

export interface VoiceTake {
  audio: Blob;
  mime: string;
  ms: number;
  /** текст от браузера; пусто — не распознавали или не расслышали */
  text: string;
}

export interface VoiceSession {
  /** закончить и получить запись */
  stop(): Promise<VoiceTake>;
  /** бросить без записи, микрофон выключить */
  cancel(): void;
}

export interface VoiceOptions {
  /** распознавать ли речь браузером */
  speech: boolean;
  lang?: string;
  /** что браузер успел расслышать (пока идёт запись) */
  onHeard?: (text: string) => void;
  /** кончились две минуты — пора остановить */
  onLimit: () => void;
}

/* Web Speech API: в стандартных типах TypeScript его нет. */
interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  0: SpeechAlternative;
}
interface SpeechResultEvent {
  results: ArrayLike<SpeechResult>;
}
interface Speech {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechCtor = new () => Speech;

/** Распознавание речи браузером, если оно есть (Chrome, Edge, Safari; в Firefox — нет). */
export function speechRecognition(): SpeechCtor | null {
  const w = globalThis as unknown as {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Почему записать не выйдет ещё до вопроса о микрофоне; `null` — можно. */
export function cannotRecord(): 'insecure' | 'unsupported' | null {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'insecure';
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === 'undefined'
  )
    return 'unsupported';
  return null;
}

/** Сколько ждать последних слов от распознавания после «стоп». */
const SETTLE_MS = 1500;

export async function startVoice(options: VoiceOptions): Promise<VoiceSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const release = () => stream.getTracks().forEach((t) => t.stop());
  let rec: MediaRecorder;
  const chunks: Blob[] = [];
  const asked = pickVoiceMime((t) => MediaRecorder.isTypeSupported?.(t) ?? false);
  try {
    rec = new MediaRecorder(stream, {
      ...(asked ? { mimeType: asked } : {}),
      audioBitsPerSecond: VOICE_BITRATE,
    });
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.start(1000);
  } catch (e) {
    // не вышло создать или запустить запись — микрофон не должен остаться включённым
    release();
    throw e;
  }
  const started = performance.now();
  const timer = setTimeout(options.onLimit, MAX_VOICE_MS);
  const speech = options.speech ? listen(options) : null;

  return {
    stop: () =>
      new Promise<VoiceTake>((resolve, reject) => {
        clearTimeout(timer);
        const ms = Math.min(MAX_VOICE_MS, Math.max(1, Math.round(performance.now() - started)));
        const heard = speech ? speech.stop() : Promise.resolve('');
        const finish = () => {
          release();
          const mime = rec.mimeType || asked || 'audio/webm';
          void heard.then((text) =>
            resolve({ audio: new Blob(chunks, { type: mime }), mime, ms, text }),
          );
        };
        rec.onstop = finish;
        rec.onerror = () => {
          release();
          reject(new Error('запись прервалась'));
        };
        if (rec.state === 'inactive') finish();
        else rec.stop();
      }),
    cancel: () => {
      clearTimeout(timer);
      speech?.cancel();
      rec.ondataavailable = null;
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      release();
    },
  };
}

/**
 * Распознавание браузером, пока идёт запись. Chrome сам заканчивает сеанс после паузы —
 * тогда начинаем новый, а уже готовые фразы складываем.
 */
function listen(options: VoiceOptions): { stop(): Promise<string>; cancel(): void } | null {
  const Ctor = speechRecognition();
  if (!Ctor) return null;
  const done: string[] = [];
  let session: string[] = [];
  let live = true;
  let ended: (() => void) | null = null;
  let r: Speech;
  try {
    r = new Ctor();
  } catch {
    return null;
  }
  r.lang = options.lang ?? 'ru-RU';
  r.continuous = true;
  r.interimResults = true;
  const text = () => [...done, ...session].join(' ').replace(/\s+/g, ' ').trim();
  r.onresult = (e) => {
    const finals: string[] = [];
    let interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const res = e.results[i]!;
      if (res.isFinal) finals.push(res[0].transcript.trim());
      else interim += res[0].transcript;
    }
    session = finals.filter(Boolean);
    options.onHeard?.(`${text()} ${interim}`.trim());
  };
  /* запрет или нет службы — перезапуск бесполезен; звук всё равно сохранится */
  const FATAL = ['not-allowed', 'service-not-allowed', 'language-not-supported', 'audio-capture'];
  let fatal = false;
  /* сеансы, что кончились почти сразу и без слов, — не даём крутиться без паузы */
  let quick = 0;
  let began = performance.now();
  r.onerror = (e) => {
    if (FATAL.includes(e.error)) fatal = true;
  };
  r.onend = () => {
    const silent = session.length === 0;
    done.push(...session);
    session = [];
    quick = silent && performance.now() - began < 1000 ? quick + 1 : 0;
    if (live && !fatal && quick < 3) {
      began = performance.now();
      try {
        r.start();
        return;
      } catch {
        /* второй раз не завёлся — довольствуемся сказанным */
      }
    }
    ended?.();
  };
  try {
    r.start();
  } catch {
    return null;
  }
  return {
    stop: () =>
      new Promise<string>((resolve) => {
        live = false;
        const finish = () => resolve(text());
        const t = setTimeout(finish, SETTLE_MS);
        ended = () => {
          clearTimeout(t);
          finish();
        };
        try {
          r.stop();
        } catch {
          ended();
        }
      }),
    cancel: () => {
      live = false;
      r.onresult = null;
      try {
        r.abort();
      } catch {
        /* уже остановлено */
      }
    },
  };
}
