/**
 * Один клиент синхронизации на всё приложение: «Входящие», «Сегодня» и Planner
 * читают одно хранилище в браузере (IndexedDB) и одну очередь отправки. Сервер по
 * WebSocket подсказывает «есть новое» — клиент забирает изменения сам.
 *
 * Хранилище — своё у каждого аккаунта: иначе после «Выйти» и входа другим человеком
 * в том же браузере он увидел бы чужие дела, а неотправленные мысли прежнего ушли бы
 * на сервер в его аккаунт.
 */
import {
  DocStore,
  SyncClient,
  httpDocsTransport,
  httpTransport,
  watchChanges,
  type SyncState,
} from '@qubite/sync-client';
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
  const [docs, setDocs] = useState<DocStore | null>(null);
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
      setClient(null);
      setDocs(null);
      return;
    }
    const documents = new DocStore({
      dbName: `${dbName}-docs`,
      transport: httpDocsTransport(),
    });
    setDocs(documents);
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
          // Включая WebSocket «есть новое»: сначала метаданные, затем Yjs.
          // Это также дошлёт текст документа, созданного без сети.
          if (s.status === 'synced' || s.status === 'conflict' || s.status === 'error') {
            void documents.syncAll().catch(() => {});
          }
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
      void documents.close().catch(() => {});
      void promise.then((c) => c.close()).catch(() => {});
    };
  }, [dbName, open, live, opened]);

  const value = useMemo<SyncApi>(
    () => ({
      client,
      ready: () => opening.current ?? opened.promise,
      version,
      state,
      docs,
    }),
    [client, version, state, docs, opened],
  );
  return <SyncCtx.Provider value={value}>{children}</SyncCtx.Provider>;
}
