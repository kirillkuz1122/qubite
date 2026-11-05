/**
 * Голосовой ввод в вебе (CMD-005b): одна запись на всё приложение — кнопку во «Входящих» и
 * микрофон в строке Command видят одно и то же состояние. Микрофон — `voice-record.ts`,
 * отправка и очередь без сети — `inbox.tsx`, логика состояний — `voice-view.ts`.
 *
 * Способ «встроенное» (`device`): пока идёт запись, речь распознаёт сам браузер, и готовый текст
 * уходит полем `text` вместе со звуком — так его ждёт сервер (`device`/`local`, D-845). Браузер
 * не умеет — звук уходит без текста, сервер сохранит «Голосовая запись» с причиной.
 */
import { HttpError } from '@qubite/sync-client';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Fail, useMe } from '../auth/client';
import { toBase64 } from './english-view';
import { useInbox, type VoiceSaved } from './inbox-context';
import { useVoicePrefs } from './voice-api';
import { VoiceCtx, type VoiceApi, type VoiceOrigin } from './voice-context';
import {
  cannotRecord,
  speechRecognition,
  startVoice,
  type VoiceOptions,
  type VoiceSession,
} from './voice-record';
import { VOICE_IDLE, micError, takeProblem, voiceStep } from './voice-view';

export function VoiceProvider({
  children,
  record = startVoice,
}: {
  children: ReactNode;
  /** Для тестов — поддельный микрофон. */
  record?: (options: VoiceOptions) => Promise<VoiceSession>;
}) {
  const inbox = useInbox();
  const me = useMe();
  const prefs = useVoicePrefs(me.data?.id);
  const method = prefs.data?.method ?? null;
  const speech = method === 'device' && speechRecognition() !== null;
  const [state, dispatch] = useReducer(voiceStep, VOICE_IDLE);
  const [origin, setOrigin] = useState<VoiceOrigin>('inbox');
  const session = useRef<VoiceSession | null>(null);
  /** номер попытки: ответ микрофона на отменённую попытку выбрасывается */
  const attempt = useRef(0);
  const saved = useRef<((s: VoiceSaved) => void) | null>(null);
  const latest = useRef({ phase: state.phase, save: inbox.voice });
  useEffect(() => {
    latest.current = { phase: state.phase, save: inbox.voice };
  });

  const stop = useCallback(() => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    dispatch({ type: 'stop' });
    void (async () => {
      try {
        const take = await s.stop();
        const problem = takeProblem({ ms: take.ms, size: take.audio.size, mime: take.mime });
        if (problem) {
          dispatch({ type: 'fail', error: problem });
          return;
        }
        const audio_base64 = toBase64(new Uint8Array(await take.audio.arrayBuffer()));
        const result = await latest.current.save({
          audio_base64,
          mime: take.mime,
          duration_ms: take.ms,
          ...(take.text ? { text: take.text } : {}),
        });
        dispatch({ type: 'sent' });
        saved.current?.(result);
      } catch (e) {
        dispatch({
          type: 'fail',
          error:
            e instanceof HttpError || e instanceof Fail
              ? `Запись не сохранилась: ${e.message}`
              : 'Запись не сохранилась. Попробуйте ещё раз.',
        });
      }
    })();
  }, []);

  const start = useCallback(
    (from: VoiceOrigin, onSaved?: (s: VoiceSaved) => void) => {
      if (session.current || latest.current.phase !== 'idle') return;
      setOrigin(from);
      if (me.data === null) {
        dispatch({ type: 'fail', error: 'Чтобы записывать голосом, войдите в аккаунт.' });
        return;
      }
      const blocked = cannotRecord();
      if (blocked) {
        dispatch({ type: 'fail', error: micError(blocked) });
        return;
      }
      const token = ++attempt.current;
      saved.current = onSaved ?? null;
      dispatch({ type: 'start' });
      record({
        speech,
        onHeard: (text) => {
          if (token === attempt.current) dispatch({ type: 'heard', text });
        },
        onLimit: () => {
          if (token === attempt.current) stop();
        },
      }).then(
        (s) => {
          if (token !== attempt.current) {
            s.cancel();
            return;
          }
          session.current = s;
          dispatch({ type: 'live', at: performance.now() });
        },
        (e: unknown) => {
          if (token === attempt.current) dispatch({ type: 'fail', error: micError(e) });
        },
      );
    },
    [me.data, speech, record, stop],
  );

  const cancel = useCallback(() => {
    attempt.current += 1;
    session.current?.cancel();
    session.current = null;
    dispatch({ type: 'cancel' });
  }, []);

  // ушли со страницы, вышли из аккаунта — микрофон выключается
  useEffect(() => {
    const current = session;
    const tries = attempt;
    return () => {
      tries.current += 1;
      current.current?.cancel();
    };
  }, []);

  const value = useMemo<VoiceApi>(
    () => ({
      ...state,
      origin,
      method,
      speech,
      start,
      stop,
      cancel,
      dismiss: () => dispatch({ type: 'dismiss' }),
    }),
    [state, origin, method, speech, start, stop, cancel],
  );
  return <VoiceCtx.Provider value={value}>{children}</VoiceCtx.Provider>;
}
