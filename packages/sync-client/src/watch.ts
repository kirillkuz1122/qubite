/**
 * Живая синхронизация: WebSocket `/api/v1/sync/ws` говорит «есть новое» —
 * клиент сразу делает `sync()`. Плюс синхронизация при появлении сети.
 *
 * Если связь оборвалась, переподключение — с растущей паузой (до 30 с).
 * Код закрытия 4403 — права отозваны: дальше не стучимся.
 */
import type { SyncClient } from './client';

export interface WatchOptions {
  /** Адрес WebSocket, например `wss://qubite.ru/api/v1/sync/ws`. */
  url: string;
  WebSocket?: typeof WebSocket;
  /** Где слушать `online` (в браузере — `window`). */
  events?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  /** Права отозваны или сессия закрыта. */
  onDenied?: () => void;
  /** Для тестов: таймер. */
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export const CLOSE_FORBIDDEN = 4403;

/** Начать слушать. Возвращает функцию остановки. */
export function watchChanges(client: SyncClient, options: WatchOptions): () => void {
  const Socket = options.WebSocket ?? globalThis.WebSocket;
  const events = options.events ?? (globalThis as unknown as Window);
  const later = options.setTimeout ?? ((callback, ms) => globalThis.setTimeout(callback, ms));
  const cancel = options.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as number));
  let socket: WebSocket | null = null;
  let retry: unknown = null;
  let attempt = 0;
  let stopped = false;

  const sync = () => {
    void client.sync();
  };

  function connect() {
    if (stopped) return;
    socket = new Socket(options.url);
    socket.onmessage = (event: MessageEvent) => {
      let type: unknown;
      try {
        type = (JSON.parse(String(event.data)) as { type?: unknown }).type;
      } catch {
        return;
      }
      if (type === 'ready') attempt = 0;
      if (type === 'ready' || type === 'changed') sync();
    };
    socket.onclose = (event: CloseEvent) => {
      socket = null;
      if (stopped) return;
      if (event.code === CLOSE_FORBIDDEN) {
        stopped = true;
        options.onDenied?.();
        return;
      }
      const delay = Math.min(30_000, 1000 * 2 ** attempt);
      attempt += 1;
      retry = later(connect, delay);
    };
  }

  events.addEventListener('online', sync);
  connect();

  return () => {
    stopped = true;
    events.removeEventListener('online', sync);
    if (retry !== null) cancel(retry);
    socket?.close();
  };
}
