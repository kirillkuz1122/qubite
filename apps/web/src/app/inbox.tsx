/**
 * «Входящие» на настоящих данных (CMD-007): мысль сначала записывается в браузер
 * (IndexedDB, `@qubite/sync-client`) — без сети она не теряется, — потом уходит на
 * сервер. Клиент синхронизации общий для всех экранов (`sync.tsx`). Вид экрана —
 * как в DS-007: строки те же, данные живые.
 *
 * Голосовые записи (CMD-005b) идут своей очередью (`VoiceQueue`, хранилище аккаунта
 * `…-voice`): `POST /api/v1/inbox/voice`, без сети — повтор с тем же ID, когда сеть вернётся.
 * Пока запись на устройстве, она видна в списке как «Голосовая запись — отправится, когда
 * появится сеть». Способ «локально» (CMD-005c): запись сразу ложится в очередь и ждёт текста
 * от Whisper на компьютере (`voice-local.ts`), а уходит уже с ним.
 */
import {
  VoiceQueue,
  archiveThought,
  captureThought,
  inboxItems,
  uuidv7,
  voiceHeld,
  type LocalObject,
  type QueuedVoice,
  type VoiceCapture,
  type VoiceFlush,
  type VoiceResult,
  type VoiceTransport,
} from '@qubite/sync-client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  InboxCtx,
  type InboxApi,
  type NewVoice,
  type Recognized,
  type VoiceSaved,
} from './inbox-context';
import { queuedView, toView } from './inbox-view';
import { useSync } from './sync-context';
import { httpVoiceTransport } from './voice-api';
import { LOCAL_TIMEOUT_MS } from './voice-local';

/** Сколько держать отправленную запись в списке, пока её не принесла синхронизация. */
const LANDING_MS = 5000;
/** Дольше распознавания на устройстве запись не ждёт: вкладку закрыли — уйдёт звуком. */
const RECOGNIZE_HOLD_MS = LOCAL_TIMEOUT_MS + 30_000;

type Landing = QueuedVoice & { landed: number };

export function InboxProvider({
  children,
  voiceTransport = httpVoiceTransport,
}: {
  children: ReactNode;
  /** Для тестов — свой сервер голосовых записей. */
  voiceTransport?: () => VoiceTransport;
}) {
  const { client, ready, version, state } = useSync();
  /* очередь голоса — рядом с хранилищем аккаунта (у каждого своя) */
  const dbName = client?.dbName ?? null;
  const [objects, setObjects] = useState<LocalObject[]>([]);
  const [later, setLater] = useState<string[]>([]);
  /* «сейчас», «9:12» — время списка обновляется с данными и раз в минуту */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  /* ---------- голосовые записи на устройстве ---------- */
  const queue = useRef<Promise<VoiceQueue | null>>(Promise.resolve(null));
  const [queued, setQueued] = useState<QueuedVoice[]>([]);
  const [heard, setHeard] = useState<ReadonlyMap<string, VoiceResult>>(() => new Map());
  const [sending, setSending] = useState(false);
  /* только что дошли до сервера, но синхронизация их ещё не принесла — строка не мигает */
  const [landing, setLanding] = useState<Landing[]>([]);
  const syncClient = useRef(client);
  useEffect(() => {
    syncClient.current = client;
  }, [client]);

  useEffect(() => {
    if (!client) return;
    let alive = true;
    void inboxItems(client, 'new').then((list) => {
      if (!alive) return;
      setObjects(list);
      setLanding((l) => (l.length ? l.filter((x) => !list.some((o) => o.id === x.id)) : l));
      setNow(Date.now());
    });
    return () => {
      alive = false;
    };
  }, [client, version]);

  const capture = useCallback(
    async (thought: string) => {
      const c = await ready();
      await captureThought(c, thought, { source: 'web' });
      void c.sync();
    },
    [ready],
  );

  const done = useCallback(
    async (id: string) => {
      if (!client) return;
      await archiveThought(client, id);
      void client.sync();
    },
    [client],
  );

  /** Отправить всё, что ждёт; дошедшее — подтянуть синхронизацией. */
  const flushVoice = useCallback(async (): Promise<VoiceFlush | null> => {
    const q = await queue.current;
    if (!q) return null;
    const before = (await q.list()).filter((x) => !x.rejected && !voiceHeld(x, Date.now()));
    if (before.length === 0) return { sent: [], left: 0 };
    setSending(true);
    try {
      const out = await q.flush();
      if (out.sent.length > 0) {
        const ids = new Set(out.sent.map((r) => r.id));
        const at = Date.now();
        setLanding((l) => [
          ...l.filter((x) => !ids.has(x.id)),
          ...before.filter((b) => ids.has(b.id)).map((b) => ({ ...b, landed: at })),
        ]);
        setTimeout(
          () => setLanding((l) => l.filter((x) => Date.now() - x.landed < LANDING_MS)),
          LANDING_MS + 100,
        );
        void syncClient.current?.sync().catch(() => {});
      }
      return out;
    } finally {
      setSending(false);
    }
  }, []);

  useEffect(() => {
    if (!dbName) return;
    let alive = true;
    let off = () => {};
    const opening = VoiceQueue.open(`${dbName}-voice`, voiceTransport()).then(
      (q) => {
        if (!alive) {
          q.close();
          return null;
        }
        const reload = () =>
          void Promise.all([q.list(), q.results()])
            .then(([list, results]) => {
              if (!alive) return;
              setQueued(list);
              setHeard(results);
            })
            .catch(() => {});
        off = q.subscribe(reload);
        reload();
        return q;
      },
      // IndexedDB недоступна (старый приватный режим) — запись уходит сразу, без очереди
      () => null,
    );
    queue.current = opening;
    // с прошлого раза что-то осталось — отправить; и каждый раз, когда появляется сеть
    void opening.then(() => flushVoice()).catch(() => {});
    const online = () => void flushVoice().catch(() => {});
    addEventListener('online', online);
    return () => {
      alive = false;
      off();
      removeEventListener('online', online);
      queue.current = Promise.resolve(null);
      void opening.then((q) => q?.close());
    };
  }, [dbName, voiceTransport, flushVoice]);

  /* запись ждала текст от устройства (hold_until_ms): когда срок выйдет, уйдёт одним звуком —
     и после перезагрузки страницы, когда ни сети, ни синхронизации «событий» уже не будет */
  useEffect(() => {
    const next = queued
      .filter((x) => !x.rejected && x.hold_until_ms !== undefined)
      .map((x) => x.hold_until_ms!)
      .filter((t) => t > Date.now())
      .sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const t = setTimeout(() => void flushVoice().catch(() => {}), next - Date.now() + 50);
    return () => clearTimeout(t);
  }, [queued, flushVoice]);

  /* синхронизация только что прошла — сервер отвечает: дошлём ждущие записи (если они есть) */
  const lastStatus = useRef(state.status);
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = state.status;
    if (state.status === 'synced' && was !== 'synced') void flushVoice().catch(() => {});
  }, [state.status, flushVoice]);

  const voice = useCallback(
    async (take: NewVoice, recognize?: () => Promise<Recognized>): Promise<VoiceSaved> => {
      const recording: VoiceCapture = { id: uuidv7(), source: 'web', ...take };
      const q = await queue.current;
      if (!q) {
        // хранилища на устройстве нет — только сразу на сервер (без сети — ошибка человеку)
        const text = recognize ? (await recognize()).text : undefined;
        await voiceTransport().send(text ? { ...recording, text } : recording);
        void syncClient.current?.sync().catch(() => {});
        return { id: recording.id, kept: 'server' };
      }
      if (!recognize) {
        await q.add(recording);
        void flushVoice().catch(() => {});
        return { id: recording.id, kept: 'device' };
      }
      // запись уже на устройстве — кнопка свободна; текст распознаётся в фоне и уйдёт с ней
      await q.add(recording, Date.now(), RECOGNIZE_HOLD_MS);
      void recognize()
        .catch((): Recognized => ({}))
        .then((heard) => q.settle(recording.id, heard))
        .then(() => flushVoice())
        .catch(() => {});
      return { id: recording.id, kept: 'device' };
    },
    [voiceTransport, flushVoice],
  );

  const dropVoice = useCallback(async (id: string) => {
    await (await queue.current)?.remove(id);
  }, []);

  const items = useMemo(() => {
    const onServer = new Set(objects.map((o) => o.id));
    const local = [
      ...queued.map((q) => queuedView(q, now, sending)),
      ...landing
        .filter((l) => !queued.some((q) => q.id === l.id))
        .map((l) => queuedView(l, now, true)),
    ].filter((x) => !onServer.has(x.id));
    const list = [...local, ...objects.map((o) => toView(o, now, heard.get(o.id)))];
    const rank = (id: string) => later.indexOf(id);
    return [...list].sort((a, b) => rank(a.id) - rank(b.id));
  }, [objects, queued, landing, heard, sending, later, now]);

  const value = useMemo<InboxApi>(
    () => ({
      items,
      sync: state,
      capture,
      done,
      later: (id) => setLater((l) => [...l.filter((x) => x !== id), id]),
      voice,
      dropVoice,
    }),
    [items, state, capture, done, voice, dropVoice],
  );
  return <InboxCtx.Provider value={value}>{children}</InboxCtx.Provider>;
}
