/*
 * Service worker Qubite (PLAN-004): только push-напоминания. Запросы сайта он не трогает
 * (нет обработчика fetch) — офлайн-кэш сайта появится отдельной задачей.
 *
 * Сервер шлёт зашифрованное сообщение {id, title, body, url}; браузер расшифровывает его
 * сам и будит этот файл, даже если вкладки Qubite закрыты.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Qubite', {
      body: data.body || '',
      // одно сообщение — одно уведомление: повтор с тем же id заменяет прежнее
      tag: data.id || undefined,
      data: { id: data.id || null, url: data.url || '/today' },
    }),
  );
});

/* Нажал на уведомление: открыть Qubite (или вкладку, что уже открыта) — там оно станет прочитанным. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/today', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const tab of tabs) {
        if (new URL(tab.url).origin !== self.location.origin) continue;
        await tab.focus();
        tab.postMessage({ type: 'qubite:notice', id: event.notification.data?.id ?? null });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

/* Прочитано в колокольчике или в Telegram — убрать системное уведомление и здесь. */
self.addEventListener('message', (event) => {
  const ids = event.data && event.data.type === 'qubite:close' ? event.data.ids : null;
  if (!Array.isArray(ids) || ids.length === 0) return;
  event.waitUntil(
    self.registration.getNotifications().then((list) => {
      for (const n of list) if (ids.includes(n.tag)) n.close();
    }),
  );
});
