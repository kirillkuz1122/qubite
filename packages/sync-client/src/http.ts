/**
 * Настоящий транспорт: `/api/v1/sync/push` и `/pull` сервера Qubite.
 *
 * Браузер шлёт cookie сессии сам; изменяющему запросу нужен заголовок
 * `X-CSRF-Token` со значением cookie `qubite_csrf`. Приложения вместо cookie
 * передают `Authorization: Bearer <access_token>` (функция `token`).
 */
import type { Transport } from './client';
import type { PullResponse, PushRequest, PushResponse } from './protocol';

export interface HttpTransportOptions {
  /** Адрес сервера; пусто — тот же сайт. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** CSRF-токен; по умолчанию — из cookie `qubite_csrf`. */
  csrf?: () => string | undefined;
  /** Токен устройства для приложений (тогда cookie не используются). */
  token?: () => string | undefined;
}

/** Ошибка сервера с кодом из ответа (`unauthenticated`, `csrf_failed`…). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function csrfFromCookie(
  cookie: string = globalThis.document?.cookie ?? '',
): string | undefined {
  for (const part of cookie.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === 'qubite_csrf') return decodeURIComponent(value.join('='));
  }
  return undefined;
}

export function httpTransport(options: HttpTransportOptions = {}): Transport {
  const base = options.baseUrl ?? '';
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const csrf = options.csrf ?? (() => csrfFromCookie());

  async function call<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    const token = options.token?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    else if (init.method && init.method !== 'GET') {
      const value = csrf();
      if (value) headers.set('x-csrf-token', value);
    }
    const response = await doFetch(`${base}${path}`, {
      ...init,
      headers,
      credentials: token ? 'omit' : 'include',
    });
    if (!response.ok) {
      let code = 'http_error';
      let message = `сервер ответил ${response.status}`;
      try {
        const body = (await response.json()) as { error?: string; message?: string };
        code = body.error ?? code;
        message = body.message ?? message;
      } catch {
        // тело не JSON — оставляем общий текст
      }
      throw new HttpError(response.status, code, message);
    }
    return (await response.json()) as T;
  }

  return {
    push: (request: PushRequest) =>
      call<PushResponse>('/api/v1/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      }),
    pull: (cursor: number, limit: number) =>
      call<PullResponse>(`/api/v1/sync/pull?cursor=${cursor}&limit=${limit}`, { method: 'GET' }),
  };
}
