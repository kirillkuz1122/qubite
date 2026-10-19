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
}

export const InboxCtx = createContext<InboxApi | null>(null);

export function useInbox(): InboxApi {
  const v = useContext(InboxCtx);
  if (!v) throw new Error('useInbox: оберни в <InboxProvider>');
  return v;
}
