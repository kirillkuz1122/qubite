/**
 * Один клиент синхронизации на всё приложение: «Входящие», «Сегодня» и Planner
 * читают одно хранилище в браузере (IndexedDB) и одну очередь отправки. Сервер по
 * WebSocket подсказывает «есть новое» — клиент забирает изменения сам.
 *
 * Хранилище — своё у каждого аккаунта: иначе после «Выйти» и входа другим человеком
 * в том же браузере он увидел бы чужие дела, а неотправленные мысли прежнего ушли бы
 * на сервер в его аккаунт.
 */
import { SyncClient, httpTransport, watchChanges, type SyncState } from '@qubite/sync-client';
import {
  LAST_ACCOUNT,
  rememberedAccount,
  SHARED_DB,
  SyncCtx,
  syncDbName,
  type SyncApi,
} from './sync-context';
import { useMe } from '../auth/client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

function socketUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/api/v1/sync/ws`;
}

/** Открыть клиент синхронизации браузера. */
async function openBrowserClient(dbName: string): Promise<SyncClient> {
  return SyncClient.open({ dbName, transport: httpTransport() });
}

/**
 * «Выйти» (D-284): пока сессия ещё жива — последний раз отправить очередь. Всё на
 * сервере — хранилище аккаунта в браузере удаляется. Осталось неотправленное (нет
 * сети, конфликт) — хранилище остаётся, и при следующем входе того же аккаунта
 * разделы откроют его и дошлют сами. Возвращает, удалено ли.
 */
export async function clearAccountStore(
  account: string,
  open: (dbName: string) => Promise<SyncClient> = openBrowserClient,
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

/**
 * Хранилище того, кто вошёл. Пока сервер не ответил (или нет сети) — последнего
 * вошедшего на этом устройстве; ответил «не вошли» — никакого. Сменился человек —
 * всё под провайдером открывается заново.
 */
export function AccountSyncProvider({
  children,
  open,
}: {
  children: ReactNode;
  open?: ((dbName: string) => Promise<SyncClient>) | undefined;
}) {
  const me = useMe();
  const id = me.data?.id;
  useEffect(() => {
    if (!id) return;
    try {
      localStorage.setItem(LAST_ACCOUNT, id);
    } catch {
      /* без памяти браузера без сети просто ничего не откроется */
    }
  }, [id]);
  useEffect(() => {
    try {
      indexedDB.deleteDatabase(SHARED_DB);
    } catch {
      /* IndexedDB нет — удалять нечего */
    }
  }, []);
  const account = me.data === null ? null : (id ?? rememberedAccount());
  // Пересоздаём всё под провайдером, только когда один человек сменился другим:
  // «пока не знаем → узнали» — то же приложение, иначе пропал бы фокус и набранное.
  const [seen, setSeen] = useState({ account, generation: 0 });
  if (account && account !== seen.account) {
    setSeen({ account, generation: seen.account ? seen.generation + 1 : seen.generation });
  }
  return (
    <SyncProvider key={seen.generation} dbName={account && syncDbName(account)} open={open}>
      {children}
    </SyncProvider>
  );
}

export function SyncProvider({
  children,
  dbName = SHARED_DB,
  open = openBrowserClient,
  live = true,
}: {
  children: ReactNode;
  /** Хранилище в браузере; `null` — не открывать (неизвестно, чьё). */
  dbName?: string | null;
  /** Для тестов — свой клиент (поддельный сервер). */
  open?: ((dbName: string) => Promise<SyncClient>) | undefined;
  /** Слушать WebSocket и событие `online`. */
  live?: boolean;
}) {
  const [client, setClient] = useState<SyncClient | null>(null);
  const [state, setState] = useState<SyncState>({ status: 'synced', pending: 0, problems: 0 });
  const [version, setVersion] = useState(0);
  const opening = useRef<Promise<SyncClient> | null>(null);
  // `ready()` до открытия (ещё неизвестно, чьё хранилище) ждёт, а не падает.
  const [opened] = useState(() => {
    let resolve: (client: SyncClient) => void = () => {};
    const promise = new Promise<SyncClient>((r) => (resolve = r));
    return { promise, resolve };
  });

  useEffect(() => {
    if (dbName === null) {
      opening.current = null;
      return;
    }
    let alive = true;
    let stop = () => {};
    let unsubscribe = () => {};
    const promise = open(dbName);
    opening.current = promise;
    void promise
      .then((c) => {
        if (!alive) {
          c.close();
          return;
        }
        setClient(c);
        opened.resolve(c);
        unsubscribe = c.subscribe((s) => {
          setState(s);
          setVersion((n) => n + 1);
        });
        if (live) stop = watchChanges(c, { url: socketUrl() });
        // Ошибки сети клиент сам кладёт в состояние; а если хранилище закрыли, пока
        // синхронизация шла (ушли со страницы, сменился человек), — ответ уже не нужен.
        c.sync().catch(() => {});
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
  }, [dbName, open, live, opened]);

  const value = useMemo<SyncApi>(
    () => ({
      client,
      ready: () => opening.current ?? opened.promise,
      version,
      state,
    }),
    [client, version, state, opened],
  );
  return <SyncCtx.Provider value={value}>{children}</SyncCtx.Provider>;
}
