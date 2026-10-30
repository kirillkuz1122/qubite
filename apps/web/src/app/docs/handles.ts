import type { DocHandle, DocStore } from '@qubite/sync-client';

interface Entry {
  users: number;
  opening: Promise<DocHandle>;
}
const stores = new WeakMap<DocStore, Map<string, Entry>>();

/**
 * StrictMode может снять и тут же вернуть эффект, пока open ждёт сеть.
 * Устаревший эффект не должен закрыть handle нового редактора.
 */
export function acquireDocument(store: DocStore, id: string) {
  let entries = stores.get(store);
  if (!entries) {
    entries = new Map();
    stores.set(store, entries);
  }
  const cache = entries;
  let entry = cache.get(id);
  if (!entry) {
    entry = { users: 0, opening: store.open(id) };
    cache.set(id, entry);
    const created = entry;
    void created.opening.catch(() => {
      if (cache.get(id) === created) cache.delete(id);
    });
  }
  const current = entry;
  current.users++;
  let released = false;
  return {
    opening: current.opening,
    invalidate() {
      // onReset: DocStore уже уничтожил прежний Y.Doc и освободил ID.
      if (cache.get(id) === current) cache.delete(id);
    },
    release() {
      if (released) return;
      released = true;
      current.users--;
      void current.opening
        .then((handle) => {
          queueMicrotask(() => {
            if (current.users || cache.get(id) !== current) return;
            cache.delete(id);
            void handle.close().catch(() => {});
          });
        })
        .catch(() => {});
    },
  };
}
