/**
 * Голосовой ввод на сервере (CMD-005a): отправка записи во «Входящие» и настройка
 * «как распознавать речь». Очередь без сети — в `@qubite/sync-client` (`VoiceQueue`).
 */
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

export const VOICE_PREFS = ['voice-prefs'] as const;

/** Способ распознавания этого человека (без входа не спрашиваем). */
export function useVoicePrefs(enabled: boolean) {
  return useQuery({
    queryKey: VOICE_PREFS,
    queryFn: () => must(api.GET('/api/v1/voice/prefs')),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

/** Выбрать способ: сохраняется на сервере, общий для всех устройств. */
export function useSetVoiceMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (method: VoiceMethod) => must(api.PUT('/api/v1/voice/prefs', { body: { method } })),
    onSuccess: (prefs) => qc.setQueryData(VOICE_PREFS, prefs),
  });
}
