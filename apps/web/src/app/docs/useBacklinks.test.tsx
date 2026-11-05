import type { DocLinkKind, DocLinkTarget, DocsTransport } from '@qubite/sync-client';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BacklinksContext, createBacklinksSession, useBacklinks } from './useBacklinks';

const links: DocLinkTarget[] = [{ id: 'source', type: 'docs.page', title: 'Конспект' }];
const reply = (backlinks = links) => new Response(JSON.stringify({ backlinks }));

function setup(session = createBacklinksSession('account')) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BacklinksContext.Provider value={session}>{children}</BacklinksContext.Provider>
  );
  const open = (id = 'target', kind: DocLinkKind = 'docs.page') =>
    renderHook(() => useBacklinks(id, kind), { wrapper });
  return { session, wrapper, open };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('обратные ссылки: сеть и память сессии', () => {
  it('загружает ссылки с cookie и сигналом отмены', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(reply());
    vi.stubGlobal('fetch', request);
    const { result } = setup().open('target /');
    expect(result.current.backlinks).toEqual([]);
    expect(result.current.message).toBe('');
    await waitFor(() => expect(result.current.backlinks).toEqual(links));
    expect(request).toHaveBeenCalledWith('/api/v1/docs/target%20%2F/backlinks', {
      credentials: 'include',
      signal: expect.any(AbortSignal),
    });
    expect(result.current.message).toBe('');
  });

  it('показывает медленную загрузку только через 300 мс', async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', () => new Promise<Response>((done) => (resolve = done)));
    const { result } = setup().open();
    await act(async () => vi.advanceTimersByTime(299));
    expect(result.current.message).toBe('');
    await act(async () => vi.advanceTimersByTime(1));
    expect(result.current.message).toBe('Загружаю ссылки…');
    await act(async () => resolve(reply()));
    expect(result.current.backlinks).toEqual(links);
    expect(result.current.message).toBe('');
  });

  it('ошибка тоже ждёт 300 мс, без кэша список пустой', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const { result } = setup().open();
    await act(async () => vi.advanceTimersByTime(299));
    expect(result.current.message).toBe('');
    await act(async () => vi.advanceTimersByTime(1));
    expect(result.current.message).toBe('Без сети — ссылки могут быть не все.');
    expect(result.current.backlinks).toEqual([]);
  });

  it('при повторном открытии сразу отдаёт кэш и снова спрашивает сервер', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(reply());
    vi.stubGlobal('fetch', request);
    const { open } = setup();
    const first = open();
    await waitFor(() => expect(first.result.current.backlinks).toEqual(links));
    first.unmount();
    request.mockRejectedValueOnce(new Error('offline'));
    const second = open();
    expect(second.result.current.backlinks).toEqual(links);
    await waitFor(() => expect(second.result.current.message).toContain('Без сети'));
    expect(second.result.current.backlinks).toEqual(links);
    expect(request).toHaveBeenCalledTimes(2);
    second.unmount();

    request.mockResolvedValueOnce(reply([]));
    const third = open();
    expect(third.result.current.backlinks).toEqual(links);
    await waitFor(() => expect(third.result.current.backlinks).toEqual([]));
  });

  it.each(['planner.task', 'planner.project'] as const)(
    '%s использует маршрут объектов',
    async (kind) => {
      const request = vi.fn<typeof fetch>().mockResolvedValue(reply());
      vi.stubGlobal('fetch', request);
      const { result } = setup().open('object', kind);
      await waitFor(() => expect(result.current.backlinks).toEqual(links));
      expect(request.mock.calls[0]?.[0]).toBe('/api/v1/objects/object/backlinks');
    },
  );

  it('после синка документов и восстановления сети перечитывает список', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => reply());
    vi.stubGlobal('fetch', request);
    const { session, open } = setup();
    const { result } = open();
    await waitFor(() => expect(result.current.backlinks).toEqual(links));
    request.mockImplementation(async () => reply([]));
    await act(async () => session.refresh());
    await waitFor(() => expect(result.current.backlinks).toEqual([]));
    request.mockImplementation(async () => reply());
    await act(async () => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(result.current.backlinks).toEqual(links));
  });

  it('смена цели отменяет запрос и не принимает его поздний ответ', async () => {
    let resolve!: (response: Response) => void;
    const request = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise<Response>((done) => (resolve = done)))
      .mockResolvedValueOnce(reply([]));
    vi.stubGlobal('fetch', request);
    const { wrapper } = setup();
    const { result, rerender } = renderHook(({ id }) => useBacklinks(id, 'docs.page'), {
      initialProps: { id: 'first' },
      wrapper,
    });
    const signal = request.mock.calls[0]?.[1]?.signal;
    rerender({ id: 'second' });
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(reply()));
    expect(result.current.backlinks).toEqual([]);
  });

  it.each([401, 403, 404, 410])('ответ %s убирает прежние названия', async (status) => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(reply());
    vi.stubGlobal('fetch', request);
    const { session, open } = setup();
    const { result } = open();
    await waitFor(() => expect(result.current.backlinks).toEqual(links));
    request.mockResolvedValueOnce(new Response(null, { status }));
    await act(async () => session.refresh());
    await waitFor(() => expect(result.current.backlinks).toEqual([]));
    expect(result.current.message).toBe('');
  });

  it('новая сессия аккаунта не читает кэш прежней', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(reply()));
    const first = setup().open();
    await waitFor(() => expect(first.result.current.backlinks).toEqual(links));
    first.unmount();
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const next = setup(createBacklinksSession('another-account')).open();
    expect(next.result.current.backlinks).toEqual([]);
    next.unmount();
    const guest = setup(createBacklinksSession(null)).open();
    expect(guest.result.current.backlinks).toEqual([]);
  });

  it('транспорт сообщает об окончании pull/push, ошибка не выдаётся за успех', async () => {
    const session = createBacklinksSession('account');
    const changed = vi.fn();
    session.subscribe(changed);
    const source: DocsTransport = {
      listVersions: vi.fn(),
      getVersion: vi.fn(),
      createVersion: vi.fn(),
      renameVersion: vi.fn(),
      deleteVersion: vi.fn(),
      listTrash: vi.fn(),
      pull: vi.fn(async () => ({
        update: new Uint8Array(),
        sv: new Uint8Array(),
        seedMarkdown: null,
      })),
      push: vi.fn(async () => ({ sv: new Uint8Array() })),
    };
    const transport = session.transport(source);
    await transport.pull('doc', new Uint8Array());
    expect(changed).toHaveBeenCalledTimes(1);
    await transport.push('doc', new Uint8Array(), 'text');
    expect(changed).toHaveBeenCalledTimes(2);
    await transport.listVersions('doc', '2026-11-03T20:00:00Z');
    await transport.getVersion('doc', 'version');
    await transport.createVersion('doc', 'Снимок');
    await transport.renameVersion('doc', 'version', 'Новое имя');
    await transport.deleteVersion('doc', 'version');
    await transport.listTrash();
    expect(source.listVersions).toHaveBeenCalledWith('doc', '2026-11-03T20:00:00Z');
    expect(source.getVersion).toHaveBeenCalledWith('doc', 'version');
    expect(source.createVersion).toHaveBeenCalledWith('doc', 'Снимок');
    expect(source.renameVersion).toHaveBeenCalledWith('doc', 'version', 'Новое имя');
    expect(source.deleteVersion).toHaveBeenCalledWith('doc', 'version');
    expect(source.listTrash).toHaveBeenCalledOnce();
    vi.mocked(source.push).mockRejectedValueOnce(new Error('offline'));
    await expect(transport.push('doc', new Uint8Array(), 'text')).rejects.toThrow('offline');
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
