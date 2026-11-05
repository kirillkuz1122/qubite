/**
 * Голосовой ввод в вебе (CMD-005b) — чистая логика без браузера: какой формат просить у
 * MediaRecorder, что сказать человеку при ошибке микрофона, как кнопка записи переходит из
 * состояния в состояние, как объяснить, почему у записи нет текста.
 */
import type { components } from '@qubite/api-client';
import type { ChoiceOption } from '@qubite/ui';

/** Не дольше двух минут — как на сервере (`qubite_ai::voice::MAX_SECONDS`). */
export const MAX_VOICE_MS = 120_000;
/** Не больше 1,2 МБ звука — как на сервере (`qubite_ai::voice::MAX_AUDIO_BYTES`). */
export const MAX_VOICE_BYTES = 1_200_000;
/** Короче — это случайное нажатие, а не запись. */
export const MIN_VOICE_MS = 500;
/** Речь в opus/aac на 32 кбит/с: две минуты — около 0,5 МБ, вдвое меньше предела. */
export const VOICE_BITRATE = 32_000;
/** Так сервер называет запись, у которой нет текста (D-846). */
export const VOICE_PLACEHOLDER = 'Голосовая запись';

/**
 * Что просить у MediaRecorder: opus в webm (Chrome, Firefox, Edge, Android), иначе mp4 (Safari).
 * Последние два — запасные, сервер их тоже принимает.
 */
export const VOICE_MIMES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/webm',
  'audio/ogg;codecs=opus',
] as const;

export function pickVoiceMime(supported: (type: string) => boolean): string | null {
  for (const type of VOICE_MIMES) if (supported(type)) return type;
  return null;
}

/** Форматы, которые принимает `POST /api/v1/inbox/voice` (параметры после «;» не важны). */
const SERVER_MIMES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
]);

export function acceptedMime(mime: string): boolean {
  return SERVER_MIMES.has(mime.split(';')[0]!.trim().toLowerCase());
}

/** Способ распознавания (D-845): хранится у человека, по умолчанию — облако. */
export type VoiceMethod = components['schemas']['VoiceMethod'];

/** Ошибка микрофона простыми словами. */
export function micError(error: unknown): string {
  const name =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'name' in error
        ? String((error as { name: unknown }).name)
        : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Нет доступа к микрофону. Разрешите его браузеру — значок замка или микрофона у адреса сайта — и нажмите ещё раз.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'Микрофон не найден. Подключите его и попробуйте ещё раз.';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'Микрофон занят другой программой или не отвечает. Закройте её и попробуйте ещё раз.';
    case 'insecure':
      return 'Запись голоса работает только на защищённом адресе (https).';
    case 'unsupported':
      return 'Этот браузер не умеет записывать звук. Откройте Qubite в Chrome, Firefox или Safari.';
    default:
      return 'Не получилось включить микрофон. Попробуйте ещё раз.';
  }
}

/** Где сейчас кнопка записи. */
export type VoicePhase = 'idle' | 'asking' | 'recording' | 'sending';

export interface VoiceState {
  phase: VoicePhase;
  /** что пошло не так в последний раз — простыми словами */
  error: string | null;
  /** что успел распознать браузер (способ «встроенное») */
  heard: string;
  /** когда включился микрофон (`performance.now()`) — для таймера */
  started: number;
}

export type VoiceEvent =
  /** нажали «записать» — браузер спрашивает разрешение на микрофон */
  | { type: 'start' }
  /** микрофон включён, идёт запись */
  | { type: 'live'; at: number }
  | { type: 'heard'; text: string }
  /** нажали «стоп» или кончились две минуты — запись уходит */
  | { type: 'stop' }
  | { type: 'cancel' }
  /** запись сохранена (на сервере или на устройстве) */
  | { type: 'sent' }
  | { type: 'fail'; error: string }
  /** человек прочитал ошибку */
  | { type: 'dismiss' };

export const VOICE_IDLE: VoiceState = { phase: 'idle', error: null, heard: '', started: 0 };

export function voiceStep(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case 'start':
      return state.phase === 'idle' ? { ...VOICE_IDLE, phase: 'asking' } : state;
    case 'live':
      return state.phase === 'asking' ? { ...state, phase: 'recording', started: event.at } : state;
    case 'heard':
      return state.phase === 'recording' ? { ...state, heard: event.text } : state;
    case 'stop':
      return state.phase === 'recording' ? { ...state, phase: 'sending' } : state;
    case 'cancel':
      return state.phase === 'asking' || state.phase === 'recording' ? VOICE_IDLE : state;
    case 'sent':
      return state.phase === 'sending' ? VOICE_IDLE : state;
    case 'fail':
      return { ...VOICE_IDLE, error: event.error };
    case 'dismiss':
      return state.error ? { ...state, error: null } : state;
  }
}

/** Запись без текста: сервер назвал её «Голосовая запись» (D-846). */
export function isBareVoice(kind: string, body: string): boolean {
  return kind === 'voice' && body.trim() === VOICE_PLACEHOLDER;
}

/** Почему у записи нет текста — короткой подсказкой Элика. */
export function voiceReason(reason: string | null | undefined): string {
  const r = (reason ?? '').trim();
  if (!r) return 'текста нет — послушай запись';
  if (/разрешени/i.test(r)) return 'распознавание голоса не подключено — послушай запись';
  if (/не удалось распознать/i.test(r)) return 'не разобрал слова — послушай запись';
  if (/не передало/i.test(r)) return 'браузер не прислал текст — послушай запись';
  if (/своим ключом/i.test(r)) return 'свой ключ пока не работает — послушай запись';
  return `${r.charAt(0).toLowerCase()}${r.slice(1)}`;
}

/** «0:07 / 2:00» — сколько записано из двух минут. */
export function recClock(ms: number): string {
  const s = Math.min(MAX_VOICE_MS, Math.max(0, ms)) / 1000;
  const fmt = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  return `${fmt(s)} / ${fmt(MAX_VOICE_MS / 1000)}`;
}

/** Где звук записи лежит на сервере (`GET /api/v1/inbox/{id}/audio`, #223). */
export function voiceAudioUrl(id: string): string {
  return `/api/v1/inbox/${encodeURIComponent(id)}/audio`;
}

/** Что не так с готовой записью (до отправки); `null` — всё в порядке. */
export function takeProblem(take: { ms: number; size: number; mime: string }): string | null {
  if (take.ms < MIN_VOICE_MS) return 'Слишком коротко — ничего не отправили. Нажмите и говорите.';
  if (take.size === 0) return 'Микрофон ничего не записал. Проверьте, что он включён.';
  if (take.size > MAX_VOICE_BYTES) return 'Запись получилась слишком большой — скажите короче.';
  if (!acceptedMime(take.mime))
    return 'Этот браузер записывает звук в формате, который Qubite пока не принимает.';
  return null;
}

const SOON = 'Появится в следующем обновлении';

/** Четыре способа простыми словами; `canSpeak` — умеет ли этот браузер распознавать сам. */
export function voiceOptions(canSpeak: boolean): ChoiceOption<VoiceMethod>[] {
  return [
    {
      value: 'cloud',
      label: 'Облако (ElevenLabs) — по умолчанию',
      hint: 'Звук уходит на сервер Qubite, текст присылает ElevenLabs. Работает в любом браузере; расход виден в «AI и бюджет».',
    },
    {
      value: 'device',
      label: 'Встроенное в браузер или Android',
      hint: 'Текст распознаёт сам браузер, пока вы говорите, — бесплатно. Звук тоже сохраняется. В Chrome речь при этом обрабатывает Google.',
      ...(canSpeak
        ? {}
        : {
            disabled: true,
            note: 'Этот браузер так не умеет — попробуйте Chrome, Edge или Safari',
          }),
    },
    {
      value: 'own_key',
      label: 'Свой ключ API',
      hint: 'Распознавание через ваш собственный ключ сервиса — расход не из бюджета Qubite.',
      disabled: true,
      note: SOON,
    },
    {
      value: 'local',
      label: 'Локально на устройстве',
      hint: 'Речь распознаёт модель прямо на компьютере или телефоне — даже без интернета.',
      disabled: true,
      note: SOON,
    },
  ];
}
