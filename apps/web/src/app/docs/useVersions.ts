import type { DocsVersionsTransport, DocVersionItem } from '@qubite/sync-client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

function subscribeOnline(change: () => void) {
  window.addEventListener('online', change);
  window.addEventListener('offline', change);
  return () => {
    window.removeEventListener('online', change);
    window.removeEventListener('offline', change);
  };
}

/** Историю не кэшируем: при каждом открытии и возвращении сети запрашиваем сервер. */
export function useVersions(id: string, enabled: boolean, transport: DocsVersionsTransport) {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => false);
  const [state, setState] = useState<{
    versions: DocVersionItem[];
    loading: boolean;
    more: boolean;
    error: string | null;
  }>({ versions: [], loading: true, more: false, error: null });
  const request = useRef(0);
  const busy = useRef(false);
  const cursor = useRef<string | undefined>(undefined);

  const load = useCallback(
    async (append = false) => {
      if (!enabled || !navigator.onLine || (append && busy.current)) return;
      const ticket = ++request.current;
      busy.current = true;
      const before = append ? cursor.current : undefined;
      setState((old) =>
        append
          ? { ...old, loading: true, error: null }
          : { versions: [], loading: true, more: false, error: null },
      );
      try {
        const page = await transport.listVersions(id, before);
        if (ticket !== request.current) return;
        cursor.current = page.at(-1)?.created_at;
        setState((old) => ({
          versions: append
            ? [...new Map([...old.versions, ...page].map((version) => [version.id, version])).values()]
            : page,
          loading: false,
          more: page.length === 50,
          error: null,
        }));
      } catch {
        if (ticket === request.current)
          setState((old) => ({
            ...old,
            loading: false,
            error: 'Не удалось загрузить историю. Проверьте связь и повторите.',
          }));
      } finally {
        if (ticket === request.current) busy.current = false;
      }
    },
    [enabled, id, transport],
  );

  useEffect(() => {
    let active = true;
    if (online && enabled)
      void Promise.resolve().then(() => {
        if (active) void load();
      });
    return () => {
      active = false;
      request.current++;
      busy.current = false;
    };
  }, [online, enabled, load]);

  return { ...state, online, refresh: () => load(), loadMore: () => load(true) };
}

/** Сравниваем календарные даты, а не 24 часа: учитываем переходы времени. */
export function versionDay(value: string, now = new Date()): string {
  const date = new Date(value);
  if (date.toDateString() === now.toDateString()) return 'Сегодня';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
  return date.toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function groupVersions(versions: readonly DocVersionItem[], now = new Date()) {
  const days = new Map<string, DocVersionItem[]>();
  for (const version of [...versions].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const day = versionDay(version.created_at, now);
    const group = days.get(day) ?? [];
    group.push(version);
    days.set(day, group);
  }
  return [...days].map(([day, items]) => ({
    day,
    items: items.sort((a, b) => Number(b.kind === 'named') - Number(a.kind === 'named')),
  }));
}
