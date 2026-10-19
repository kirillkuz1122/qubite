/** Общий клиент синхронизации для экранов (сам клиент открывает `sync.tsx`). */
import type { SyncClient, SyncState } from '@qubite/sync-client';
import { createContext, useContext } from 'react';

export interface SyncApi {
  /** открытый клиент (до открытия — `null`) */
  client: SyncClient | null;
  /** ждать открытия, чтобы записать без потерь сразу после загрузки страницы */
  ready(): Promise<SyncClient>;
  /** растёт при каждом изменении на устройстве или с сервера — повод перечитать */
  version: number;
  state: SyncState;
}

export const SyncCtx = createContext<SyncApi | null>(null);

export function useSync(): SyncApi {
  const v = useContext(SyncCtx);
  if (!v) throw new Error('useSync: оберни в <SyncProvider>');
  return v;
}
