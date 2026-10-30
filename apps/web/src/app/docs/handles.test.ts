import type { DocHandle, DocStore } from '@qubite/sync-client';
import { describe, expect, it, vi } from 'vitest';
import { acquireDocument } from './handles';

const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

it('эффект StrictMode не закрывает общий handle, пока новый редактор его ждёт', async () => {
  let resolve: (handle: DocHandle) => void = () => {};
  const promise = new Promise<DocHandle>((done) => { resolve = done; });
  const close = vi.fn().mockResolvedValue(undefined);
  const handle = { close } as unknown as DocHandle;
  const open = vi.fn(() => promise);
  const store = { open } as unknown as DocStore;
  const first = acquireDocument(store, 'doc');
  first.release();
  const second = acquireDocument(store, 'doc');
  resolve(handle);
  await tick();
  expect(await second.opening).toBe(handle);
  expect(open).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  second.release();
  second.release();
  await tick();
  expect(close).toHaveBeenCalledTimes(1);
});

describe('переоткрытие после сброса', () => {
  it('onReset освобождает старый документ до нового открытия', async () => {
    const firstHandle = { close: vi.fn() } as unknown as DocHandle;
    const secondHandle = { close: vi.fn().mockResolvedValue(undefined) } as unknown as DocHandle;
    const open = vi.fn().mockResolvedValueOnce(firstHandle).mockResolvedValueOnce(secondHandle);
    const store = { open } as unknown as DocStore;
    const first = acquireDocument(store, 'doc');
    await first.opening;
    first.invalidate();
    first.release();
    const second = acquireDocument(store, 'doc');
    expect(await second.opening).toBe(secondHandle);
    await tick();
    expect(firstHandle.close).not.toHaveBeenCalled();
    second.release();
    await tick();
    expect(secondHandle.close).toHaveBeenCalledTimes(1);
  });
});
