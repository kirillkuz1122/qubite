import type { DocLinkKind, DocLinkTarget, DocsTransport } from '@qubite/sync-client';
import { createContext, useContext, useEffect, useState } from 'react';

const EMPTY: DocLinkTarget[] = [];
const COALESCE_MS = 150;

/** Только память текущей сессии аккаунта; после выхода чужой кэш недоступен. */
export function createBacklinksSession(scope: string | null) {
  const cache = new Map<string, DocLinkTarget[]>();
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let bulk = 0;
  let dirty = false;
  /** Сразу: самостоятельное сохранение открытого документа. */
  const refresh = () => {
    clearTimeout(timer);
    timer = undefined;
    listeners.forEach((listener) => listener());
  };
  /** Серия уведомлений массового обмена сливается в один запрос. */
  const schedule = () => {
    // Внутри массового обмена только помечаем: таймер стартует после его конца.
    if (bulk > 0) {
      dirty = true;
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(refresh, COALESCE_MS);
  };
  return {
    scope,
    cache,
    refresh,
    schedule,
    /** Пока идёт массовый обмен, ответы сервера только откладывают одно обновление. */
    async batch<T>(work: Promise<T>): Promise<T> {
      bulk += 1;
      try {
        return await work;
      } finally {
        bulk -= 1;
        if (bulk === 0 && dirty) {
          dirty = false;
          schedule();
        }
      }
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Сигнал после ответа сервера: упоминания уже записаны, не только поставлены в очередь. */
    transport(source: DocsTransport): DocsTransport {
      return {
        listVersions: (...args) => source.listVersions(...args),
        getVersion: (...args) => source.getVersion(...args),
        createVersion: (...args) => source.createVersion(...args),
        renameVersion: (...args) => source.renameVersion(...args),
        deleteVersion: (...args) => source.deleteVersion(...args),
        listTrash: () => source.listTrash(),
        async pull(...args) {
          const response = await source.pull(...args);
          schedule();
          return response;
        },
        async push(...args) {
          const response = await source.push(...args);
          if (bulk > 0) schedule();
          else refresh();
          return response;
        },
      };
    },
  };
}

export type BacklinksSession = ReturnType<typeof createBacklinksSession>;
export const BacklinksContext = createContext<BacklinksSession | null>(null);

interface Result {
  backlinks: DocLinkTarget[];
  message: string;
}

export function useBacklinks(id: string, kind: DocLinkKind): Result {
  const session = useContext(BacklinksContext);
  const key = `${kind}:${id}`;
  const [state, setState] = useState<Result & { session: typeof session; key: string }>({
    session,
    key,
    backlinks: session?.cache.get(key) ?? EMPTY,
    message: '',
  });

  useEffect(() => {
    if (!session || session.scope === null) return;
    let request: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      request?.abort();
      clearTimeout(timer);
      const abort = new AbortController();
      request = abort;
      let status: 'loading' | 'error' | 'done' = 'loading';
      let delayed = false;
      const publish = () => {
        if (abort.signal.aborted) return;
        setState({
          session,
          key,
          backlinks: session.cache.get(key) ?? EMPTY,
          message:
            status === 'done' || !delayed
              ? ''
              : status === 'error'
                ? 'Без сети — ссылки могут быть не все.'
                : 'Загружаю ссылки…',
        });
      };
      timer = setTimeout(() => {
        delayed = true;
        publish();
      }, 300);
      const path = kind === 'docs.page' ? 'docs' : 'objects';
      void fetch(`/api/v1/${path}/${encodeURIComponent(id)}/backlinks`, {
        credentials: 'include',
        signal: abort.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            // Нет доступа или цель удалена: прежние названия больше не показываем.
            if ([401, 403, 404, 410].includes(response.status)) {
              if (!abort.signal.aborted) session.cache.set(key, EMPTY);
              return EMPTY;
            }
            throw new Error('backlinks unavailable');
          }
          const body = (await response.json()) as { backlinks: DocLinkTarget[] };
          return body.backlinks;
        })
        .then((backlinks) => {
          if (abort.signal.aborted) return;
          session.cache.set(key, backlinks);
          status = 'done';
          clearTimeout(timer);
          publish();
        })
        .catch(() => {
          status = 'error';
          publish();
        });
    };
    const stop = session.subscribe(refresh);
    refresh();
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      request?.abort();
      clearTimeout(timer);
      stop();
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [session, id, kind, key]);

  // Только данные, без служебных полей состояния: их нельзя разложить в пропсы (`key`).
  return state.session === session && state.key === key
    ? { backlinks: state.backlinks, message: state.message }
    : { backlinks: session?.cache.get(key) ?? EMPTY, message: '' };
}
