/**
 * Один клиент синхронизации на всё приложение: «Входящие», «Сегодня» и Planner
 * читают одно хранилище в браузере (IndexedDB) и одну очередь отправки. Сервер по
 * WebSocket подсказывает «есть новое» — клиент забирает изменения сам.
 */
import { SyncClient, httpTransport, watchChanges, type SyncState } from '@qubite/sync-client';
import { SyncCtx, type SyncApi } from './sync-context';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

function socketUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/api/v1/sync/ws`;
}

/** Открыть клиент синхронизации браузера. */
async function openBrowserClient(): Promise<SyncClient> {
  return SyncClient.open({ dbName: 'qubite-sync', transport: httpTransport() });
}

export function SyncProvider({
  children,
  open = openBrowserClient,
  live = true,
}: {
  children: ReactNode;
  /** Для тестов — свой клиент (поддельный сервер). */
  open?: () => Promise<SyncClient>;
  /** Слушать WebSocket и событие `online`. */
  live?: boolean;
}) {
  const [client, setClient] = useState<SyncClient | null>(null);
  const [state, setState] = useState<SyncState>({ status: 'synced', pending: 0, problems: 0 });
  const [version, setVersion] = useState(0);
  const opening = useRef<Promise<SyncClient> | null>(null);

  useEffect(() => {
    let alive = true;
    let stop = () => {};
    let unsubscribe = () => {};
    const promise = open();
    opening.current = promise;
    void promise
      .then((c) => {
        if (!alive) {
          c.close();
          return;
        }
        setClient(c);
        unsubscribe = c.subscribe((s) => {
          setState(s);
          setVersion((n) => n + 1);
        });
        if (live) stop = watchChanges(c, { url: socketUrl() });
        void c.sync();
      })
      .catch((error: unknown) => {
        // IndexedDB недоступна (приватный режим старого браузера) — экраны пустые, без падения.
        console.warn('Синхронизация: хранилище на устройстве недоступно', error);
      });
    return () => {
      alive = false;
      stop();
      unsubscribe();
      void promise.then((c) => c.close()).catch(() => {});
    };
  }, [open, live]);

  const value = useMemo<SyncApi>(
    () => ({
      client,
      ready: () => opening.current ?? Promise.reject(new Error('хранилище не открыто')),
      version,
      state,
    }),
    [client, version, state],
  );
  return <SyncCtx.Provider value={value}>{children}</SyncCtx.Provider>;
}
