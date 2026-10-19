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

/** Общее хранилище до разделения по аккаунтам — удаляется при первом открытии. */
export const SHARED_DB = 'qubite-sync';
/** Чьё хранилище открыть без сети (последний вошедший на этом устройстве). */
export const LAST_ACCOUNT = 'qubite.sync.account';

/** Имя хранилища аккаунта в браузере. */
export function syncDbName(account: string): string {
  return `${SHARED_DB}-${account}`;
}

export function rememberedAccount(): string | null {
  try {
    return localStorage.getItem(LAST_ACCOUNT);
  } catch {
    return null;
  }
}

/** После «Выйти»: без сети разделы больше не откроют хранилище вышедшего. */
export function forgetSyncAccount(): void {
  try {
    localStorage.removeItem(LAST_ACCOUNT);
  } catch {
    /* хранилище браузера недоступно — помнить и так нечего */
  }
}
