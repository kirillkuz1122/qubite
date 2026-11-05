/**
 * Голосовой ввод на сервере (CMD-005a): отправка записи во «Входящие» и настройка
 * «как распознавать речь». Очередь без сети — в `@qubite/sync-client` (`VoiceQueue`).
 * Свой ключ распознавания (CMD-005c) — `/api/v1/voice/key`: сервер хранит его зашифрованным
 * и обратно не отдаёт, только последние 4 символа.
 */
import { CSRF_HEADER, csrfFromCookie } from '@qubite/api-client';
import { HttpError, type VoiceTransport } from '@qubite/sync-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { must } from '../auth/client';
import type { VoiceMethod } from './voice-view';

/** `POST /api/v1/inbox/voice`. Обрыв сети — исключение fetch, отказ сервера — `HttpError`. */
export function httpVoiceTransport(): VoiceTransport {
  return {
    async send(capture) {
      const { data, error, response } = await api.POST('/api/v1/inbox/voice', { body: capture });
      if (!response.ok || !data) {
        const body = (error ?? {}) as { error?: string; message?: string };
        throw new HttpError(
          response.status,
          body.error ?? `http_${response.status}`,
          body.message ?? `сервер ответил ${response.status}`,
        );
      }
      return { transcribed: data.transcribed, reason: data.reason ?? null };
    },
  };
}

/** Ключ настройки — с ID человека: при смене аккаунта в одной вкладке чужая настройка не подхватится. */
export const voicePrefsKey = (accountId: string | undefined) => ['voice-prefs', accountId] as const;

/** Способ распознавания этого человека (без входа не спрашиваем). */
export function useVoicePrefs(accountId: string | undefined) {
  return useQuery({
    queryKey: voicePrefsKey(accountId),
    queryFn: () => must(api.GET('/api/v1/voice/prefs')),
    enabled: !!accountId,
    retry: false,
    staleTime: 60_000,
  });
}

/** Выбрать способ: сохраняется на сервере, общий для всех устройств. */
export function useSetVoiceMethod(accountId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (method: VoiceMethod) => must(api.PUT('/api/v1/voice/prefs', { body: { method } })),
    onSuccess: (prefs) => qc.setQueryData(voicePrefsKey(accountId), prefs),
  });
}

/** Что сервер знает о своём ключе человека (сам ключ не возвращается никогда). */
export interface VoiceKey {
  configured: boolean;
  /** адрес OpenAI-совместимого API; `null` — по умолчанию сервера */
  base_url: string | null;
  model: string | null;
  /** последние 4 символа — чтобы узнать свой ключ */
  last4: string | null;
}

/** Сохранить ключ: адрес и модель — у выбранного сервиса. */
export interface VoiceKeyInput {
  api_key: string;
  base_url?: string;
  model?: string;
}

export const NO_VOICE_KEY: VoiceKey = {
  configured: false,
  base_url: null,
  model: null,
  last4: null,
};

const KEY_PATH = '/api/v1/voice/key';

/**
 * Тонкая обёртка над fetch в форме ответа openapi-fetch — дальше её разбирает `must` (тексты
 * ошибок, техработы). Путь появится в `@qubite/api-client` после `gen:api` (CMD-005c-1).
 * Ключ уходит только телом запроса: не в адрес, не в журнал и не в хранилище браузера.
 */
async function keyCall<T>(
  method: 'GET' | 'PUT' | 'DELETE',
  body?: VoiceKeyInput,
): Promise<{ data?: T; error?: unknown; response: Response }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  const csrf = method === 'GET' ? undefined : csrfFromCookie();
  if (csrf) headers[CSRF_HEADER] = csrf;
  const response = await fetch(KEY_PATH, {
    method,
    credentials: 'include',
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) return { error: (await response.json().catch(() => null)) ?? {}, response };
  if (response.status === 204) return { response };
  return { data: (await response.json()) as T, response };
}

export const voiceKeyKey = (accountId: string | undefined) => ['voice-key', accountId] as const;

/** Задан ли свой ключ; `enabled` — спрашивать только когда нужно (выбран «свой ключ»). */
export function useVoiceKey(accountId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: voiceKeyKey(accountId),
    queryFn: () => must(keyCall<VoiceKey>('GET')),
    enabled: !!accountId && enabled,
    retry: false,
    staleTime: 60_000,
  });
}

/**
 * Сохранить ключ. Без `useMutation` нарочно: кэш мутаций держал бы ключ в памяти ещё минуты.
 * Ошибка 400 — сервер не принял адрес или ключ (текст — от сервера).
 */
export function saveVoiceKey(input: VoiceKeyInput): Promise<VoiceKey> {
  return must(keyCall<VoiceKey>('PUT', input));
}

export async function dropVoiceKey(): Promise<VoiceKey> {
  await must(keyCall<undefined>('DELETE'));
  return NO_VOICE_KEY;
}
