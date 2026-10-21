/** Общий клиент синхронизации для экранов (сам клиент открывает `sync.tsx`). */
import { httpTransport, SyncClient, type SyncState } from '@qubite/sync-client';
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

/**
 * «Выйти» (D-284): пока сессия ещё жива — последний раз отправить очередь. Всё на
 * сервере — хранилище аккаунта в браузере удаляется. Осталось неотправленное (нет
 * сети, конфликт) — хранилище остаётся, и при следующем входе того же аккаунта
 * разделы откроют его и дошлют сами. Возвращает, удалено ли.
 */
export async function clearAccountStore(
  account: string,
  open: (dbName: string) => Promise<SyncClient> = (dbName) =>
    SyncClient.open({ dbName, transport: httpTransport() }),
  factory: IDBFactory = indexedDB,
  wait = 5000,
): Promise<boolean> {
  const name = syncDbName(account);
  let client: SyncClient;
  try {
    client = await open(name);
  } catch {
    return false;
  }
  // Медленная сеть не держит «Выйти» дольше 5 секунд: не успели — оставляем.
  const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), wait));
  const state = await Promise.race([client.sync().catch(() => client.state()), late]);
  client.close();
  if (!state || state.pending > 0 || state.problems > 0) return false;
  await new Promise<void>((resolve) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
  return true;
}
