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
   * Голосовая запись (CMD-005b): сначала на устройство, потом на сервер. Без сети — остаётся
   * в очереди и уходит сама, когда сеть появится (повтор с тем же ID).
   */
  voice(take: NewVoice): Promise<VoiceSaved>;
  /** Не отправлять запись с устройства (сервер её не принял или человек передумал). */
  dropVoice(id: string): Promise<void>;
}

/** Запись с микрофона, готовая к отправке. */
export interface NewVoice {
  audio_base64: string;
  mime: string;
  duration_ms: number;
  /** текст, распознанный браузером (способ «встроенное») */
  text?: string;
}

export interface VoiceSaved {
  id: string;
  /** дошла до сервера сразу; нет — лежит на устройстве и уйдёт сама */
  sent: boolean;
  transcribed: boolean;
}

export const InboxCtx = createContext<InboxApi | null>(null);

export function useInbox(): InboxApi {
  const v = useContext(InboxCtx);
  if (!v) throw new Error('useInbox: оберни в <InboxProvider>');
  return v;
}
