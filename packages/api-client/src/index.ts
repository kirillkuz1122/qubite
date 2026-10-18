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
export type Me = components['schemas']['Me'];
export type LoginResponse = components['schemas']['LoginResponse'];
export type SessionItem = components['schemas']['SessionItem'];
export type ApiErrorBody = components['schemas']['ApiErrorBody'];

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
}

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
  return client;
}

export type QubiteClient = ReturnType<typeof createQubiteClient>;
