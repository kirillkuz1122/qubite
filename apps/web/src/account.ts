/**
 * Граница аккаунта в браузере (SYNC-008, D-894…D-896).
 *
 * Cookie сессии общие на все вкладки, а данные на экране и в памяти — у каждой
 * вкладки свои. Здесь одно место, которое следит, чтобы они не разошлись:
 *
 * - каждый запрос данных называет аккаунт, который вкладка считает своим
 *   (`currentAccount`), — сервер отклонит запрос, если вошёл уже другой;
 * - сменился вошедший (вход, выход, другая вкладка) — всё, что было загружено для
 *   прежнего, выбрасывается из памяти, а остальные вкладки перепроверяют, кто вошёл.
 */
import type { Me } from '@qubite/api-client';
import { QueryClient, type Query } from '@tanstack/react-query';

/** Один кэш запросов на приложение. */
export const queryClient = new QueryClient();

/** Ключ запроса «кто вошёл». */
export const ME = ['me'] as const;

/** Запросы без личных данных: их при смене аккаунта не трогаем. */
const SHARED_KEYS = new Set<unknown>(['me', 'platform', 'oauth-providers']);

/** Канал между вкладками и ключ localStorage, по которым вкладки узнают о смене аккаунта. */
export const ACCOUNT_CHANNEL = 'qubite.account';
/** Чьё хранилище открыть без сети (последний вошедший на этом устройстве). */
export const LAST_ACCOUNT = 'qubite.sync.account';

/** Кого эта вкладка считает вошедшим (`undefined` — никого или ещё не знаем). */
export function currentAccount(client: QueryClient = queryClient): string | undefined {
  return client.getQueryData<Me | null>(ME)?.id;
}

/** Спросить сервер заново, кто вошёл (cookie могла сменить другая вкладка). */
export function recheckAccount(client: QueryClient = queryClient): void {
  void client.invalidateQueries({ queryKey: ME });
}

/**
 * Выбросить всё, что загружено для прежнего аккаунта. Запросы, которые сейчас на
 * экране, сбрасываются в «ещё не загружено» и, если вошёл новый человек, запрашиваются
 * заново уже для него.
 */
export function clearAccountCache(client: QueryClient, refetch: boolean): void {
  const personal = { predicate: (query: Query) => !SHARED_KEYS.has(query.queryKey[0]) };
  void client.cancelQueries(personal);
  client.removeQueries({ ...personal, type: 'inactive' });
  for (const query of client.getQueryCache().findAll({ ...personal, type: 'active' })) {
    query.reset();
  }
  client.getMutationCache().clear();
  if (refetch) void client.refetchQueries({ ...personal, type: 'active' });
}

export interface AccountWatchOptions {
  /** Для тестов: свой канал между вкладками (`null` — без него). */
  channel?:
    | (Pick<BroadcastChannel, 'postMessage' | 'close'> & {
        onmessage: ((event: MessageEvent) => void) | null;
      })
    | null;
  /** Где слушать `storage` (в браузере — `window`). */
  events?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | undefined;
}

function openChannel(): AccountWatchOptions['channel'] {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(ACCOUNT_CHANNEL);
  } catch {
    return null;
  }
}

/**
 * Следить за сменой аккаунта. Возвращает функцию остановки.
 *
 * Срабатывает прямо в момент, когда в кэш попал ответ «кто вошёл», — до того, как
 * экраны перерисуются: новый человек не увидит ни кадра данных прежнего.
 */
export function watchAccount(
  client: QueryClient = queryClient,
  options: AccountWatchOptions = {},
): () => void {
  const channel = options.channel === undefined ? openChannel() : options.channel;
  const events =
    options.events ?? (typeof window === 'undefined' ? undefined : (window as EventTarget));
  // `undefined` — ещё не знаем, кто вошёл; `null` — никто.
  let known: string | null | undefined = client.getQueryState(ME)?.dataUpdatedAt
    ? (currentAccount(client) ?? null)
    : undefined;

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    if (event.query.queryKey.length !== 1 || event.query.queryKey[0] !== ME[0]) return;
    const next = (event.query.state.data as Me | null | undefined)?.id ?? null;
    const previous = known;
    known = next;
    if (previous === undefined || previous === next) return;
    clearAccountCache(client, next !== null);
    try {
      channel?.postMessage({ account: next });
    } catch {
      /* канал закрыт — остаётся событие storage */
    }
  });

  // Другая вкладка вошла или вышла: спрашиваем сервер, кто вошёл теперь.
  const recheck = (account: unknown) => {
    if (account !== (currentAccount(client) ?? null)) recheckAccount(client);
  };
  if (channel) {
    channel.onmessage = (event) => recheck((event.data as { account?: unknown } | null)?.account);
  }
  // Запасной путь для браузеров без BroadcastChannel: запись «кто вошёл последним».
  const onStorage = (event: Event) => {
    const { key, newValue } = event as StorageEvent;
    if (key === LAST_ACCOUNT) recheck(newValue);
  };
  events?.addEventListener('storage', onStorage);

  return () => {
    unsubscribe();
    events?.removeEventListener('storage', onStorage);
    if (channel) channel.onmessage = null;
    channel?.close();
  };
}
