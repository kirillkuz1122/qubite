/** Запись голоса для экранов: одна на всё приложение (сам микрофон — в `voice.tsx`). */
import { createContext, useContext, useEffect, useState } from 'react';
import type { VoiceSaved } from './inbox-context';
import type { VoiceMethod, VoiceState } from './voice-view';

/** Откуда начали запись: там и показываем ошибку. */
export type VoiceOrigin = 'inbox' | 'command';

export interface VoiceApi extends VoiceState {
  origin: VoiceOrigin;
  /** способ распознавания этого человека; `null` — пока неизвестен (нет сети) */
  method: VoiceMethod | null;
  /** выбрано «встроенное» и браузер умеет: текст уйдёт вместе со звуком */
  speech: boolean;
  /** выбран «свой ключ», а ключ не задан: запись сохранится только звуком */
  noKey: boolean;
  /** включить микрофон и записывать; `onSaved` — запись сохранена (на сервере или устройстве) */
  start(origin: VoiceOrigin, onSaved?: (saved: VoiceSaved) => void): void;
  /** закончить и отправить */
  stop(): void;
  /** бросить запись, ничего не отправлять */
  cancel(): void;
  /** убрать сообщение об ошибке */
  dismiss(): void;
}

export const VoiceCtx = createContext<VoiceApi | null>(null);

export function useVoice(): VoiceApi {
  const v = useContext(VoiceCtx);
  if (!v) throw new Error('useVoice: оберни в <VoiceProvider>');
  return v;
}

/** Сколько миллисекунд идёт запись (обновляется 4 раза в секунду, только пока идёт). */
export function useElapsed(started: number, on: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!on) return;
    const tick = () => setNow(performance.now());
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [on]);
  return on ? Math.max(0, now - started) : 0;
}
