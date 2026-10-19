/**
 * «Входящие» на настоящих данных (CMD-007): мысль сначала записывается в браузер
 * (IndexedDB, `@qubite/sync-client`) — без сети она не теряется, — потом уходит на
 * сервер. Сервер по WebSocket подсказывает «есть новое» (с телефона, из Telegram),
 * и список обновляется сам. Вид экрана — как в DS-007: строки те же, данные живые.
 */
import {
  SyncClient,
  archiveThought,
  captureThought,
  httpTransport,
  inboxItems,
  watchChanges,
  type LocalObject,
  type SyncState,
} from '@qubite/sync-client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { InboxCtx, type InboxApi } from './inbox-context';
import { toView } from './inbox-view';

function socketUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/api/v1/sync/ws`;
}

/** Открыть клиент синхронизации браузера. */
async function openBrowserClient(): Promise<SyncClient> {
  return SyncClient.open({ dbName: 'qubite-sync', transport: httpTransport() });
}

export function InboxProvider({
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
  const [objects, setObjects] = useState<LocalObject[]>([]);
  const [sync, setSync] = useState<SyncState>({ status: 'synced', pending: 0, problems: 0 });
  const [later, setLater] = useState<string[]>([]);
  /* «сейчас», «9:12» — время списка обновляется с данными и раз в минуту */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const ready = useRef<Promise<SyncClient> | null>(null);

  useEffect(() => {
    let alive = true;
    let stop = () => {};
    let unsubscribe = () => {};
    const opening = open();
    ready.current = opening;
    void opening
      .then(async (c) => {
        if (!alive) {
          c.close();
          return;
        }
        setClient(c);
        const refresh = async () => {
          const list = await inboxItems(c, 'new');
          if (!alive) return;
          setObjects(list);
          setNow(Date.now());
        };
        unsubscribe = c.subscribe((s) => {
          setSync(s);
          void refresh();
        });
        await refresh();
        if (live) stop = watchChanges(c, { url: socketUrl() });
        void c.sync();
      })
      .catch((error: unknown) => {
        // IndexedDB недоступна (приватный режим старого браузера) — экран пустой, без падения.
        console.warn('Входящие: хранилище на устройстве недоступно', error);
      });
    return () => {
      alive = false;
      stop();
      unsubscribe();
      void opening.then((c) => c.close()).catch(() => {});
    };
  }, [open, live]);

  const reload = useCallback(async (c: SyncClient) => {
    setObjects(await inboxItems(c, 'new'));
    setNow(Date.now());
  }, []);

  const capture = useCallback(
    async (thought: string) => {
      const c = await (ready.current ?? Promise.reject(new Error('хранилище не открыто')));
      await captureThought(c, thought, { source: 'web' });
      await reload(c);
      void c.sync();
    },
    [reload],
  );

  const done = useCallback(
    async (id: string) => {
      if (!client) return;
      await archiveThought(client, id);
      await reload(client);
      void client.sync();
    },
    [client, reload],
  );

  const items = useMemo(() => {
    const list = objects.map((o) => toView(o, now));
    const rank = (id: string) => later.indexOf(id);
    return [...list].sort((a, b) => rank(a.id) - rank(b.id));
  }, [objects, later, now]);

  const value = useMemo<InboxApi>(
    () => ({
      items,
      sync,
      capture,
      done,
      later: (id) => setLater((l) => [...l.filter((x) => x !== id), id]),
    }),
    [items, sync, capture, done],
  );
  return <InboxCtx.Provider value={value}>{children}</InboxCtx.Provider>;
}
