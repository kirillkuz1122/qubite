/** Входящие для экранов: что показать и что можно сделать (данные — в `inbox.tsx`). */
import type { SyncState } from '@qubite/sync-client';
import { createContext, useContext } from 'react';
import type { InboxItem } from './data';

export interface InboxApi {
  items: InboxItem[];
  sync: SyncState;
  /** Записать мысль (без сети — на устройство, отправится потом). */
  capture(text: string): Promise<void>;
  /** Разобрано — в архив (не удаляется). */
  done(id: string): Promise<void>;
  /** «Позже» — в конец списка (только на этом устройстве). */
  later(id: string): void;
  /**
   * Голосовая запись (CMD-005b): сохраняется на устройство и сразу начинает уходить на сервер —
   * ответа не ждём (облачное распознавание идёт до 15 с), строка списка показывает «отправляется».
   * Без сети — остаётся в очереди и уходит сама, когда сеть появится (повтор с тем же ID).
   *
   * `recognize` — текст распознаёт само устройство уже после записи (способ «локально»,
   * CMD-005c): запись сохраняется сразу и ждёт текста, а уходит вместе с ним — или только
   * звуком с причиной, если распознать не вышло.
   */
  voice(take: NewVoice, recognize?: () => Promise<Recognized>): Promise<VoiceSaved>;
  /** Не отправлять запись с устройства (сервер её не принял или человек передумал). */
  dropVoice(id: string): Promise<void>;
}

/** Запись с микрофона, готовая к отправке. */
export interface NewVoice {
  audio_base64: string;
  mime: string;
  duration_ms: number;
  /** текст, распознанный на устройстве (способ «встроенное») */
  text?: string;
}

/** Распознавание на устройстве: текст — или почему его нет (простыми словами). */
export interface Recognized {
  text?: string;
  why?: string;
}

export interface VoiceSaved {
  id: string;
  /** где запись сейчас: в очереди на устройстве (обычно) или уже на сервере (хранилища нет) */
  kept: 'device' | 'server';
}

export const InboxCtx = createContext<InboxApi | null>(null);

export function useInbox(): InboxApi {
  const v = useContext(InboxCtx);
  if (!v) throw new Error('useInbox: оберни в <InboxProvider>');
  return v;
}
