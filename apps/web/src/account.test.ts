import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_CHANNEL, currentAccount, LAST_ACCOUNT, ME, watchAccount } from './account';

function me(id: string) {
  return { id, email: `${id}@x.ru`, display_name: id, is_owner: false };
}

/** Канал между вкладками: что отправлено и возможность «получить» сообщение. */
function fakeChannel() {
  const channel = {
    sent: [] as unknown[],
    closed: false,
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage(message: unknown) {
      channel.sent.push(message);
    },
    close() {
      channel.closed = true;
    },
    receive(data: unknown) {
      channel.onmessage?.({ data } as MessageEvent);
    },
  };
  return channel;
}

function setup(initial?: ReturnType<typeof me> | null) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (initial !== undefined) qc.setQueryData(ME, initial);
  const channel = fakeChannel();
  const events = new EventTarget();
  const stop = watchAccount(qc, { channel, events });
  return { qc, channel, events, stop };
}

describe('смена аккаунта (SYNC-008, замечание 11)', () => {
  it('данные прежнего аккаунта выбрасываются из памяти в момент смены', () => {
    const { qc, channel } = setup(me('a'));
    qc.setQueryData(['sessions'], [{ ip: '192.0.2.99' }]);
    qc.setQueryData(['voice-prefs', 'a'], { method: 'cloud' });
    qc.setQueryData(['platform'], { maintenance: false });
    qc.setQueryData(['oauth-providers'], [{ id: 'yandex' }]);

    qc.setQueryData(ME, null); // вышли
    expect(qc.getQueryData(['sessions'])).toBeUndefined();
    expect(qc.getQueryData(['voice-prefs', 'a'])).toBeUndefined();
    // Общие для всех сведения остаются.
    expect(qc.getQueryData(['platform'])).toEqual({ maintenance: false });
    expect(qc.getQueryData(['oauth-providers'])).toEqual([{ id: 'yandex' }]);

    qc.setQueryData(['sessions'], [{ ip: 'что-то успело загрузиться' }]);
    qc.setQueryData(ME, me('b')); // вошёл другой
    expect(qc.getQueryData(['sessions'])).toBeUndefined();
    expect(currentAccount(qc)).toBe('b');
    expect(channel.sent).toEqual([{ account: null }, { account: 'b' }]);
  });

  it('запрос на экране сбрасывается и запрашивается заново уже для нового человека', async () => {
    const { qc } = setup(me('a'));
    let calls = 0;
    const observer = new QueryObserver(qc, {
      queryKey: ['sessions'],
      queryFn: async () => `сессии ${currentAccount(qc)} #${(calls += 1)}`,
    });
    const seen: unknown[] = [];
    const off = observer.subscribe((result) => seen.push(result.data));
    await expect.poll(() => qc.getQueryData(['sessions'])).toBe('сессии a #1');

    qc.setQueryData(ME, me('b'));
    // Сразу после смены — пусто, а не данные A.
    expect(qc.getQueryData(['sessions'])).toBeUndefined();
    await expect.poll(() => qc.getQueryData(['sessions'])).toBe('сессии b #2');
    expect(seen.indexOf(undefined, seen.indexOf('сессии a #1'))).toBeGreaterThan(-1);
    off();
  });

  it('первый ответ «кто вошёл» и повтор того же человека ничего не трогают', () => {
    const { qc, channel } = setup();
    qc.setQueryData(['platform'], { maintenance: false });
    qc.setQueryData(['inbox'], ['мысль']);
    qc.setQueryData(ME, me('a')); // узнали, кто вошёл
    qc.setQueryData(ME, { ...me('a'), display_name: 'новое имя' });
    expect(qc.getQueryData(['inbox'])).toEqual(['мысль']);
    expect(channel.sent).toEqual([]);
  });

  it('другая вкладка сменила аккаунт — эта спрашивает сервер, кто вошёл', async () => {
    const { qc, channel, events } = setup(me('a'));
    let asked = 0;
    let onServer: ReturnType<typeof me> | null = me('a');
    const observer = new QueryObserver(qc, {
      queryKey: ME,
      queryFn: async () => {
        asked += 1;
        return onServer;
      },
    });
    const off = observer.subscribe(() => {});
    qc.setQueryData(['sessions'], ['сессии A']);

    // Сообщение о том же аккаунте — не повод.
    channel.receive({ account: 'a' });
    expect(asked).toBe(0);

    onServer = me('b');
    channel.receive({ account: 'b' });
    await expect.poll(() => currentAccount(qc)).toBe('b');
    expect(asked).toBe(1);
    expect(qc.getQueryData(['sessions'])).toBeUndefined();

    // Запасной путь без BroadcastChannel: запись «кто вошёл последним» в localStorage.
    onServer = null;
    const storage = new Event('storage') as Event & { key: string; newValue: string | null };
    storage.key = LAST_ACCOUNT;
    storage.newValue = null;
    events.dispatchEvent(storage);
    await expect.poll(() => qc.getQueryData(ME)).toBeNull();
    expect(asked).toBe(2);
    off();
  });

  it('остановка отпускает канал и подписки', () => {
    const { qc, channel, stop } = setup(me('a'));
    stop();
    expect(channel.closed).toBe(true);
    qc.setQueryData(['sessions'], ['сессии A']);
    qc.setQueryData(ME, me('b'));
    expect(qc.getQueryData(['sessions'])).toEqual(['сессии A']);
    expect(ACCOUNT_CHANNEL).toBe('qubite.account');
  });
});
