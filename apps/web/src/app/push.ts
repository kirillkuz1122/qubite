/**
 * Push в браузере (PLAN-004): подписка этого браузера через service worker (`/sw.js`).
 * Сервер шифрует сообщение ключом браузера и подписывает своим ключом VAPID — сами
 * уведомления показывает service worker, даже когда Qubite закрыт.
 */
import { api } from '../api';
import { deviceName, must } from '../auth/client';

export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Ключ VAPID (base64url) → байты для `applicationServerKey`. */
export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = (key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!pushSupported()) return undefined;
  return navigator.serviceWorker.getRegistration('/');
}

/** Подписка этого браузера (если есть). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Состояние push в этом браузере: есть ли подписка, которую знает сервер. */
export async function pushState(known: string[]): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await currentSubscription();
  return sub && known.includes(sub.endpoint) ? 'on' : 'off';
}

/** Включить: разрешение браузера → подписка → сервер её запоминает. */
export async function enablePush(key: string): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // старая подписка с другим ключом сервера не дойдёт — подписаться заново
  if (sub && sub.options.applicationServerKey) {
    const old = new Uint8Array(sub.options.applicationServerKey);
    const now = keyBytes(key);
    if (old.length !== now.length || old.some((b, i) => b !== now[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(key),
  });
  const json = sub.toJSON();
  await must(
    api.POST('/api/v1/notifications/push', {
      body: {
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
        label: deviceName({
          kind: 'browser',
          user_agent: navigator.userAgent,
        } as Parameters<typeof deviceName>[0]),
      },
    }),
  );
  return 'on';
}

/** Выключить в этом браузере (на сервере и в браузере). */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await must(api.POST('/api/v1/notifications/push/remove', { body: { endpoint: sub.endpoint } }));
  await sub.unsubscribe().catch(() => false);
}

/** Убрать системные уведомления о прочитанном (прочитал в колокольчике или в Telegram). */
export async function closeShown(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const reg = await registration().catch(() => undefined);
  reg?.active?.postMessage({ type: 'qubite:close', ids });
}
