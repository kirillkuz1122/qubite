/**
 * «Английский» (ENG-001) без React: что делает маскот, подписи, формат записи, base64 —
 * чтобы проверить тестами без браузера.
 */
import type { Mood } from '@qubite/ui';

/** Что сейчас происходит в разговоре. */
export type Phase =
  /** ничего: ждёт тебя */
  | 'idle'
  /** пишет микрофон */
  | 'listening'
  /** ответ ещё не пришёл (распознаёт, думает, готовит голос) */
  | 'thinking'
  /** звучит голос репетитора */
  | 'speaking'
  /** только что: ошибка */
  | 'wrong'
  /** только что: верно */
  | 'right';

/** Настроение Нейта для фазы. */
export function moodFor(phase: Phase): Mood {
  switch (phase) {
    case 'listening':
      return 'listen';
    case 'thinking':
      return 'think';
    case 'speaking':
      return 'talk';
    case 'wrong':
      return 'angry';
    case 'right':
      return 'happy';
    case 'idle':
      return 'idle';
  }
}

/** Подпись под маскотом (для глаз и читалки). */
export function phaseLabel(phase: Phase): string {
  switch (phase) {
    case 'listening':
      return 'Нейт слушает…';
    case 'thinking':
      return 'Нейт думает…';
    case 'speaking':
      return 'Нейт говорит';
    case 'wrong':
      return 'Нейт нашёл ошибку';
    case 'right':
      return 'Нейт доволен (почти)';
    case 'idle':
      return 'Нейт ждёт';
  }
}

/** Реакция на ответ: ошибка — сердится, верно или «повторил» — радуется. */
export function reactionOf(verdict: string | null | undefined, repeated: boolean): Phase | null {
  if (verdict === 'mistake') return 'wrong';
  if (verdict === 'ok' || repeated) return 'right';
  return null;
}

/** Сколько длится реакция, прежде чем Нейт заговорит. */
export const REACTION_MS = 900;
/** Самая длинная запись за раз (сервер примет до 120 с). */
export const MAX_RECORD_MS = 60_000;

/** Формат записи, который понимает и браузер, и распознавание. */
export function pickMime(supported: (type: string) => boolean): string | null {
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'])
    if (supported(type)) return type;
  return null;
}

/** Байты → base64 (кусками: большой запись не уронит стек). */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK)
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

/** «верно 6 из 10 (60 %)». */
export function scoreLabel(correct: number, turns: number): string {
  if (turns <= 0) return 'ещё ни одной реплики';
  return `верно ${correct} из ${turns} (${Math.floor((correct * 100) / turns)} %)`;
}

/** «12 мин» — сколько шёл разговор. */
export function minutesLabel(from: string, to: string): string {
  const ms = Date.parse(to) - Date.parse(from);
  return `${Math.max(1, Math.ceil(ms / 60_000))} мин`;
}

/** Почему голос недоступен — честно и коротко. */
export function voiceNote(listen: boolean, speak: boolean, mic: boolean): string | null {
  if (!listen && !speak)
    return 'Голос не настроен: на сервере нет ключа ElevenLabs. Пока — текстом, Нейт ответит так же строго.';
  if (!listen) return 'Распознавание речи не настроено — пиши текстом; отвечать вслух Нейт будет.';
  if (!speak) return 'Речь репетитора не настроена — ответы будут только текстом.';
  if (!mic) return 'Браузер не даёт микрофон — пиши текстом.';
  return null;
}

/** «ответил через 0,9 с» — замер от конца фразы до первого звука. */
export function waitLabel(ms: number): string {
  return `ответил через ${(Math.max(0, ms) / 1000).toFixed(1).replace('.', ',')} с`;
}
