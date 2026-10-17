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

export interface ClientOptions {
  /** Адрес сервера. Пусто — тот же сайт (запросы на `/api/...`). */
  baseUrl?: string;
  /** Подменить `fetch` (нужно тестам). */
  fetch?: typeof globalThis.fetch;
}

export function createQubiteClient(options: ClientOptions = {}) {
  return createClient<paths>({
    baseUrl: options.baseUrl ?? '',
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

export type QubiteClient = ReturnType<typeof createQubiteClient>;
