/**
 * Клиент API Qubite.
 *
 * Типы в `schema.ts` генерируются из описания сервера командой `pnpm gen:api`
 * (`qubite openapi` → openapi-typescript). Руками `schema.ts` не правим.
 */
import createClient from 'openapi-fetch';
import type { components, paths } from './schema';

export type { components, paths } from './schema';

export type Health = components['schemas']['Health'];
export type Readiness = components['schemas']['Readiness'];
export type TaskRouteRequest = components['schemas']['TaskRouteRequest'];
export type TaskRouteResponse = components['schemas']['TaskRouteResponse'];
export type RoutePoint = components['schemas']['RoutePoint'];
export type TaskPlaceFields = components['schemas']['TaskPlaceFields'];
export type Me = components['schemas']['Me'];
export type LoginResponse = components['schemas']['LoginResponse'];
export type SessionItem = components['schemas']['SessionItem'];
export type ApiErrorBody = components['schemas']['ApiErrorBody'];
export type CatalogItem = components['schemas']['CatalogItem'];
export type ModuleFlags = components['schemas']['ModuleFlags'];
export type DeviceTokenResponse = components['schemas']['DeviceTokenResponse'];

/** Cookie, в которой сервер передаёт CSRF-токен, и заголовок для него. */
export const CSRF_COOKIE = 'qubite_csrf';
export const CSRF_HEADER = 'X-CSRF-Token';

/** CSRF-токен из `document.cookie` (в браузере), иначе `undefined`. */
export function csrfFromCookie(
  cookie: string = globalThis.document?.cookie ?? '',
): string | undefined {
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CSRF_COOKIE && rest.length > 0) return rest.join('=') || undefined;
  }
  return undefined;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface ClientOptions {
  /** Адрес сервера. Пусто — тот же сайт (запросы на `/api/...`). */
  baseUrl?: string;
  /** Подменить `fetch` (нужно тестам). */
  fetch?: typeof globalThis.fetch;
  /** Откуда брать CSRF-токен. По умолчанию — из cookie `qubite_csrf`. */
  csrfToken?: () => string | undefined;
  /**
   * Кого приложение считает вошедшим (ID аккаунта). Уходит заголовком
   * `X-Qubite-Account`: если в браузере тем временем вошёл другой человек (cookie
   * общие на все вкладки), сервер отклонит запрос (409 `account_mismatch`), а не
   * выполнит его от чужого имени (SYNC-008). Запросы `/api/auth/…` заголовок не
   * получают: ими как раз выясняют и меняют, кто вошёл.
   */
  account?: () => string | undefined;
  /** Сервер ответил «вошёл другой аккаунт» — пора перепроверить, кто вошёл. */
  onAccountMismatch?: () => void;
}

/** Заголовок «от чьего имени сделан запрос» и код отказа при несовпадении. */
export const ACCOUNT_HEADER = 'X-Qubite-Account';
export const ACCOUNT_MISMATCH = 'account_mismatch';

/**
 * Клиент сам добавляет `X-CSRF-Token` ко всем изменяющим запросам
 * (POST, PUT, PATCH, DELETE): без него сервер их отклонит (403 `csrf_failed`).
 */
export function createQubiteClient(options: ClientOptions = {}) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl ?? '',
    credentials: 'include',
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const csrfToken = options.csrfToken ?? (() => csrfFromCookie());
  client.use({
    onRequest({ request }) {
      if (SAFE_METHODS.has(request.method)) return undefined;
      const token = csrfToken();
      if (token) request.headers.set(CSRF_HEADER, token);
      return request;
    },
  });
  client.use({
    onRequest({ request }) {
      // Явно заданный заголовок (очередь конкретного аккаунта) не трогаем.
      if (request.headers.has(ACCOUNT_HEADER)) return undefined;
      if (new URL(request.url).pathname.startsWith('/api/auth/')) return undefined;
      const account = options.account?.();
      if (!account) return undefined;
      request.headers.set(ACCOUNT_HEADER, account);
      return request;
    },
    async onResponse({ response }) {
      if (response.status !== 409 || !options.onAccountMismatch) return undefined;
      try {
        const body = (await response.clone().json()) as { error?: string };
        if (body.error === ACCOUNT_MISMATCH) options.onAccountMismatch();
      } catch {
        // тело не JSON — это не наш отказ
      }
      return undefined;
    },
  });
  return client;
}

export type QubiteClient = ReturnType<typeof createQubiteClient>;
