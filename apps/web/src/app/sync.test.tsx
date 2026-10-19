import 'fake-indexeddb/auto';
import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SyncClient, type Transport } from '@qubite/sync-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { ME } from '../auth/client';
import { useEffect } from 'react';
import { useSync } from './sync-context';
import { AccountSyncProvider } from './sync';
import { forgetSyncAccount, syncDbName } from './sync-context';

const offline: Transport = {
  push: () => Promise.reject(new Error('нет сети')),
  pull: () => Promise.reject(new Error('нет сети')),
};

function me(id: string) {
  return { id, email: `${id}@x.ru`, display_name: id, is_owner: false };
}

function setup(data: ReturnType<typeof me> | null | undefined) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (data !== undefined) qc.setQueryData(ME, data);
  const opened: string[] = [];
  const open = (dbName: string) => {
    opened.push(dbName);
    return SyncClient.open({ dbName, transport: offline });
  };
  const view = () => (
    <QueryClientProvider client={qc}>
      <AccountSyncProvider open={open}>
        <span>разделы</span>
      </AccountSyncProvider>
    </QueryClientProvider>
  );
  return { qc, opened, view };
}

describe('хранилище в браузере — своё у каждого аккаунта', () => {
  beforeEach(() => forgetSyncAccount());

  it('другой человек после выхода открывает своё хранилище, не чужое', async () => {
    const a = setup(me('a'));
    const { rerender } = render(a.view());
    await waitFor(() => expect(a.opened).toEqual([syncDbName('a')]));
    await act(async () => a.qc.setQueryData(ME, me('b')));
    rerender(a.view());
    await waitFor(() => expect(a.opened).toEqual([syncDbName('a'), syncDbName('b')]));
  });

  it('гостю хранилище не открывается', async () => {
    const guest = setup(null);
    render(guest.view());
    await new Promise((r) => setTimeout(r, 20));
    expect(guest.opened).toEqual([]);
  });

  it('без ответа сервера — хранилище последнего вошедшего, а после «Выйти» — никакое', async () => {
    const first = setup(me('a'));
    const { unmount } = render(first.view());
    await waitFor(() => expect(first.opened).toEqual([syncDbName('a')]));
    unmount();

    const offlineVisit = setup(undefined);
    const second = render(offlineVisit.view());
    await waitFor(() => expect(offlineVisit.opened).toEqual([syncDbName('a')]));
    second.unmount();

    forgetSyncAccount();
    const afterLogout = setup(undefined);
    render(afterLogout.view());
    await new Promise((r) => setTimeout(r, 20));
    expect(afterLogout.opened).toEqual([]);
  });

  it('«ещё не знаем, кто вошёл» → «узнали» не пересоздаёт экран, а ready() дожидается хранилища', async () => {
    const unknown = setup(undefined);
    let mounts = 0;
    let ready: Promise<SyncClient> | null = null;
    function Probe() {
      const sync = useSync();
      useEffect(() => {
        mounts += 1;
        ready ??= sync.ready();
      }, [sync]);
      return null;
    }
    const view = () => (
      <QueryClientProvider client={unknown.qc}>
        <AccountSyncProvider
          open={(dbName) => {
            unknown.opened.push(dbName);
            return SyncClient.open({ dbName, transport: offline });
          }}
        >
          <Probe />
        </AccountSyncProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(view());
    await new Promise((r) => setTimeout(r, 20));
    expect(unknown.opened).toEqual([]);
    await act(async () => unknown.qc.setQueryData(ME, me('a')));
    rerender(view());
    await waitFor(() => expect(unknown.opened).toEqual([syncDbName('a')]));
    const client = await ready!;
    expect(client).toBeInstanceOf(SyncClient);
    expect(mounts).toBe(1);
  });
});
