import 'fake-indexeddb/auto';
import { LookProvider } from '@qubite/ui';
import { createDoc, SyncClient, type Transport } from '@qubite/sync-client';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { useEffect, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncCtx } from '../sync-context';
import { DocsScreen } from './Docs';

const route = vi.hoisted(() => ({ path: '/docs', changed: () => {} }));
vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => route.path,
  useNavigate:
    () =>
    async ({ to, params }: { to: string; params?: { id: string } }) => {
      route.path = params ? `/docs/${params.id}` : to;
      route.changed();
    },
}));
vi.mock('../docs/History', () => ({
  History: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../docs/Editor', () => ({ DocEditor: () => null }));
vi.mock('../docs/Backlinks', () => ({ DocumentBacklinks: () => null }));

const clients: SyncClient[] = [];
const offline: Transport = {
  push: async () => {
    throw new Error('нет сети');
  },
  pull: async () => {
    throw new Error('нет сети');
  },
};
function Harness({ client }: { client: SyncClient }) {
  const [version, setVersion] = useState(0);
  const [, repaint] = useState(0);
  useEffect(() => {
    route.changed = () => repaint((value) => value + 1);
    return client.subscribe(() => setVersion((value) => value + 1));
  }, [client]);
  return (
    <SyncCtx.Provider value={{ client, ready: async () => client, state: client.state(), version }}>
      <LookProvider>
        <DocsScreen />
      </LookProvider>
    </SyncCtx.Provider>
  );
}
async function setup() {
  const dbName = `docs-trash-${crypto.randomUUID()}`;
  const client = await SyncClient.open({ dbName, transport: offline });
  clients.push(client);
  const doc = await createDoc(client, 'Заметка для корзины');
  route.path = `/docs/${doc.id}`;
  const view = render(<Harness client={client} />);
  await view.findByRole('textbox', { name: 'Название документа' });
  return { ...view, client, doc, dbName };
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.close());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('удаление документа', () => {
  it('просит подтверждение; отмена сохраняет документ и возвращает фокус', async () => {
    const view = await setup();
    const remove = view.getByRole('button', { name: 'Удалить' });
    act(() => remove.focus());
    fireEvent.click(remove);
    const dialog = view.getByRole('dialog', { name: 'Удалить документ' });
    expect(
      within(dialog).getByText('Документ уйдёт в корзину. Его можно вернуть'),
    ).toBeInTheDocument();
    expect((await view.client.get(view.doc.id))?.deleted).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
    expect(remove).toHaveFocus();
    expect((await view.client.get(view.doc.id))?.deleted).toBe(false);
  });

  it('удаляет без сети, переходит к списку и возвращает из заметки с фокусом на документе', async () => {
    const view = await setup();
    fireEvent.click(view.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: 'Удалить' }));
    const undo = await view.findByRole('button', { name: 'Вернуть' });
    await waitFor(() => expect(undo).toHaveFocus());
    expect(route.path).toBe('/docs');
    expect((await view.client.get(view.doc.id))?.deleted).toBe(true);
    expect(view.queryByRole('textbox', { name: 'Название документа' })).toBeNull();
    expect(view.queryByRole('button', { name: /Заметка для корзины/ })).toBeNull();
    fireEvent.click(undo);
    const row = await view.findByRole('button', { name: /Заметка для корзины/ });
    await waitFor(() => expect(row).toHaveFocus());
    expect((await view.client.get(view.doc.id))?.deleted).toBe(false);
    expect(view.client.state().pending).toBe(3); // create, delete, restore в IndexedDB
    fireEvent.click(row);
    expect(await view.findByRole('textbox', { name: 'Название документа' })).toHaveValue(
      'Заметка для корзины',
    );
  });

  it('хранит удаление после повторного открытия базы и возвращает из офлайн-корзины', async () => {
    const view = await setup();
    await act(async () => {
      await view.client.remove(view.doc.id);
    });
    view.unmount();
    view.client.close();
    const reopened = await SyncClient.open({ dbName: view.dbName, transport: offline });
    clients.push(reopened);
    route.path = '/docs';
    const next = render(<Harness client={reopened} />);
    fireEvent.click(next.getByRole('radio', { name: 'Корзина' }));
    const restore = await next.findByRole('button', { name: 'Вернуть «Заметка для корзины»' });
    expect(next.getByText(/Без сети/)).toBeInTheDocument();
    expect(next.queryByRole('textbox', { name: 'Название документа' })).toBeNull();
    fireEvent.click(restore);
    const row = await next.findByRole('button', { name: /^Заметка для корзины/ });
    await waitFor(() => expect(row).toHaveFocus());
    expect(next.getByRole('radio', { name: 'Документы' })).toHaveAttribute('aria-checked', 'true');
    expect((await reopened.get(view.doc.id))?.deleted).toBe(false);
  });

  it('объясняет ошибку локального удаления и сохраняет открытый документ', async () => {
    const view = await setup();
    vi.spyOn(view.client, 'remove').mockRejectedValueOnce(new Error('диск'));
    fireEvent.click(view.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: 'Удалить' }));
    await waitFor(() =>
      expect(view.getAllByRole('alert').map((alert) => alert.textContent)).toContainEqual(
        expect.stringContaining('Не удалось удалить документ на устройстве'),
      ),
    );
    expect((await view.client.get(view.doc.id))?.deleted).toBe(false);
    expect(route.path).toBe(`/docs/${view.doc.id}`);
  });
});
