import { act, renderHook, waitFor } from '@testing-library/react';
import type { DocsVersionsTransport, DocVersionItem } from '@qubite/sync-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupVersions, useVersions, versionDay } from './useVersions';

const item = (
  id: string,
  created_at = '2026-11-04T08:00:00Z',
  kind = 'auto',
): DocVersionItem => ({
  id,
  created_at,
  kind,
  name: kind === 'named' ? id : null,
  title: 'Документ',
  preview: 'Текст',
  size: 100,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function transport(listVersions: DocsVersionsTransport['listVersions']): DocsVersionsTransport {
  return {
    listVersions,
    getVersion: vi.fn(),
    createVersion: vi.fn(),
    renameVersion: vi.fn(),
    deleteVersion: vi.fn(),
    listTrash: vi.fn(),
  };
}
afterEach(() => vi.restoreAllMocks());

describe('список версий', () => {
  it('группирует календарные дни и ставит именованные первыми внутри дня', () => {
    const now = new Date(2026, 10, 4, 12);
    const today = new Date(2026, 10, 4, 8).toISOString();
    const yesterday = new Date(2026, 10, 3, 23).toISOString();
    const older = new Date(2026, 10, 1, 10).toISOString();
    expect(versionDay(today, now)).toBe('Сегодня');
    expect(versionDay(yesterday, now)).toBe('Вчера');
    const groups = groupVersions(
      [
        item('old', older),
        item('auto', today),
        item('named', today, 'named'),
        item('restore', yesterday, 'before_restore'),
      ],
      now,
    );
    expect(groups.map((group) => group.day)).toEqual([
      'Сегодня',
      'Вчера',
      versionDay(older, now),
    ]);
    expect(groups[0]!.items.map((version) => version.id)).toEqual(['named', 'auto']);
  });

  it('подгружает следующую страницу с курсором before', async () => {
    const first = Array.from({ length: 50 }, (_, index) =>
      item(String(index), new Date(Date.UTC(2026, 10, 4, 8, 0, 59 - index)).toISOString()),
    );
    const list = vi
      .fn<DocsVersionsTransport['listVersions']>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([item('last', '2026-11-03T10:00:00Z')]);
    const api = transport(list);
    const view = renderHook(() => useVersions('doc', true, api));
    await waitFor(() => expect(view.result.current.versions).toHaveLength(50));
    expect(view.result.current.more).toBe(true);
    await act(() => view.result.current.loadMore());
    expect(list).toHaveBeenLastCalledWith('doc', first.at(-1)!.created_at);
    expect(view.result.current.versions).toHaveLength(51);
    expect(view.result.current.more).toBe(false);
  });

  it('ошибка страницы сохраняет предыдущие строки и позволяет повторить', async () => {
    const first = Array.from({ length: 50 }, (_, index) => item(String(index)));
    const list = vi
      .fn<DocsVersionsTransport['listVersions']>()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce([]);
    const api = transport(list);
    const view = renderHook(() => useVersions('doc', true, api));
    await waitFor(() => expect(view.result.current.versions).toHaveLength(50));
    await act(() => view.result.current.loadMore());
    expect(view.result.current.error).toContain('Не удалось загрузить историю');
    expect(view.result.current.versions).toHaveLength(50);
    await act(() => view.result.current.loadMore());
    expect(view.result.current.error).toBeNull();
  });

  it('игнорирует ответ прежнего документа и закрытого экрана', async () => {
    const first = deferred<DocVersionItem[]>();
    const second = deferred<DocVersionItem[]>();
    const list = vi
      .fn<DocsVersionsTransport['listVersions']>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const api = transport(list);
    const view = renderHook(({ id, open }) => useVersions(id, open, api), {
      initialProps: { id: 'first', open: true },
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    view.rerender({ id: 'second', open: true });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await act(async () => first.resolve([item('stale')]));
    expect(view.result.current.versions).toEqual([]);
    view.rerender({ id: 'second', open: false });
    await act(async () => second.resolve([item('closed')]));
    expect(view.result.current.versions).toEqual([]);
  });

  it('при возвращении сети заново запрашивает сервер', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const list = vi
      .fn<DocsVersionsTransport['listVersions']>()
      .mockResolvedValue([item('fresh')]);
    const api = transport(list);
    const view = renderHook(() => useVersions('doc', true, api));
    expect(list).not.toHaveBeenCalled();
    act(() => {
      online.mockReturnValue(true);
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(view.result.current.versions[0]?.id).toBe('fresh'));
  });
});
