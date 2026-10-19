/**
 * «Входящие» на настоящих данных (CMD-007): мысль сначала записывается в браузер
 * (IndexedDB, `@qubite/sync-client`) — без сети она не теряется, — потом уходит на
 * сервер. Клиент синхронизации общий для всех экранов (`sync.tsx`). Вид экрана —
 * как в DS-007: строки те же, данные живые.
 */
import { archiveThought, captureThought, inboxItems, type LocalObject } from '@qubite/sync-client';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { InboxCtx, type InboxApi } from './inbox-context';
import { toView } from './inbox-view';
import { useSync } from './sync-context';

export function InboxProvider({ children }: { children: ReactNode }) {
  const { client, ready, version, state } = useSync();
  const [objects, setObjects] = useState<LocalObject[]>([]);
  const [later, setLater] = useState<string[]>([]);
  /* «сейчас», «9:12» — время списка обновляется с данными и раз в минуту */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!client) return;
    let alive = true;
    void inboxItems(client, 'new').then((list) => {
      if (!alive) return;
      setObjects(list);
      setNow(Date.now());
    });
    return () => {
      alive = false;
    };
  }, [client, version]);

  const capture = useCallback(
    async (thought: string) => {
      const c = await ready();
      await captureThought(c, thought, { source: 'web' });
      void c.sync();
    },
    [ready],
  );

  const done = useCallback(
    async (id: string) => {
      if (!client) return;
      await archiveThought(client, id);
      void client.sync();
    },
    [client],
  );

  const items = useMemo(() => {
    const list = objects.map((o) => toView(o, now));
    const rank = (id: string) => later.indexOf(id);
    return [...list].sort((a, b) => rank(a.id) - rank(b.id));
  }, [objects, later, now]);

  const value = useMemo<InboxApi>(
    () => ({
      items,
      sync: state,
      capture,
      done,
      later: (id) => setLater((l) => [...l.filter((x) => x !== id), id]),
    }),
    [items, state, capture, done],
  );
  return <InboxCtx.Provider value={value}>{children}</InboxCtx.Provider>;
}
