import 'fake-indexeddb/auto';
import { LookProvider } from '@qubite/ui';
import {
  createDoc,
  DocStore,
  httpDocsTransport,
  SyncClient,
  type Transport,
} from '@qubite/sync-client';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { useEffect, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncCtx } from '../sync-context';
import * as Y from 'yjs';
import * as markdownFile from '../docs/markdown-file';
import { markdownToYUpdate, renderDocText } from '../docs/render';
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
const stores: DocStore[] = [];
const offline: Transport = {
  push: async () => {
    throw new Error('нет сети');
  },
  pull: async () => {
    throw new Error('нет сети');
  },
};
function Harness({ client, docs }: { client: SyncClient; docs?: DocStore }) {
  const [version, setVersion] = useState(0);
  const [, repaint] = useState(0);
  useEffect(() => {
    route.changed = () => repaint((value) => value + 1);
    return client.subscribe(() => setVersion((value) => value + 1));
  }, [client]);
  return (
    <SyncCtx.Provider
      value={{
        client,
        docs: docs ?? null,
        ready: async () => client,
        state: client.state(),
        version,
      }}
    >
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
afterEach(async () => {
  // Без globals Testing Library сам не размонтирует: экраны прошлых тестов держат закрытые хранилища.
  cleanup();
  // Фоновый обмен мог открывать документ в момент закрытия.
  await Promise.all(stores.splice(0).map((store) => store.close().catch(() => {})));
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

async function markdownSetup() {
  const dbName = `docs-markdown-${crypto.randomUUID()}`;
  const client = await SyncClient.open({ dbName, transport: offline });
  clients.push(client);
  const docs = new DocStore({
    dbName: `${dbName}-text`,
    renderText: renderDocText,
    debounceMs: 60_000,
    transport: httpDocsTransport({
      fetch: async () => {
        throw new Error('нет сети');
      },
    }),
  });
  stores.push(docs);
  route.path = '/docs';
  const view = render(<Harness client={client} docs={docs} />);
  await view.findByText('Здесь будут ваши заметки и документы.');
  const input = view.getByLabelText('Импорт Markdown');
  return { ...view, client, docs, input };
}

describe('Markdown-файлы без сети', () => {
  it('создаёт два документа, сохраняет текст после закрытия и остаётся в списке', async () => {
    const view = await markdownSetup();
    expect(view.getAllByRole('button', { name: 'Импорт .md' })).toHaveLength(2);
    fireEvent.change(view.input, {
      target: {
        files: [
          new File(['# Первый\n- [x] готово'], 'первый.md'),
          new File(['> цитата'], 'второй.txt'),
        ],
      },
    });
    await view.findByText('Загружено 2 из 2');
    // Превью видно в списке сразу, не только после открытия документа.
    expect(view.getByText('готово')).toBeInTheDocument();
    expect(view.getByText('цитата')).toBeInTheDocument();
    expect(route.path).toBe('/docs');
    const objects = await view.client.all();
    expect(objects.map((object) => object.title).sort()).toEqual(['Первый', 'второй']);
    for (const object of objects) {
      const handle = await view.docs.open(object.id);
      expect(handle.text()).toBe(object.title === 'Первый' ? '- [x] готово' : '> цитата');
      await handle.close();
    }
  });

  it('показывает причину ошибки одного файла и продолжает следующий', async () => {
    const view = await markdownSetup();
    fireEvent.change(view.input, {
      target: {
        files: [new File(['нет'], 'плохой.pdf'), new File(['текст'], 'хороший.md')],
      },
    });
    await view.findByText('Загружено 1 из 2');
    expect(view.getByText(/плохой.pdf:.*Выберите файл/)).toBeInTheDocument();
    expect((await view.client.all()).map((object) => object.title)).toEqual(['хороший']);
    expect(route.path).toBe('/docs');
  });

  it('один файл открывает и скачивает актуальный handle.text()', async () => {
    const view = await markdownSetup();
    const download = vi.spyOn(markdownFile, 'downloadMarkdown').mockImplementation(() => {});
    fireEvent.change(view.input, {
      target: { files: [new File(['# Заметка\nначало'], 'один.md')] },
    });
    const button = await view.findByRole('button', { name: 'Скачать .md' });
    await waitFor(() => expect(button).toBeEnabled());
    const [object] = await view.client.all();
    expect(route.path).toBe(`/docs/${object!.id}`);
    const handle = await view.docs.open(object!.id);
    act(() => {
      Y.applyUpdate(handle.doc, markdownToYUpdate('свежий текст'));
    });
    const text = handle.text();
    expect(text).toContain('свежий текст');
    fireEvent.click(button);
    expect(download).toHaveBeenCalledWith('Заметка', text);
    view.unmount();
  });

  it('отказывает при выборе больше 20 файлов до создания документов', async () => {
    const view = await markdownSetup();
    fireEvent.change(view.input, {
      target: { files: Array.from({ length: 21 }, (_, i) => new File([''], `${i}.md`)) },
    });
    await view.findByText('Выберите не больше 20 файлов за раз.');
    expect(await view.client.all()).toEqual([]);
  });

  it('отказывает файлу с 201 разным упоминанием', async () => {
    const view = await markdownSetup();
    const text = Array.from(
      { length: 201 },
      (_, i) => `[@Док](qubite://${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000)`,
    ).join('\n\n');
    fireEvent.change(view.input, { target: { files: [new File([text], 'ссылки.md')] } });
    await view.findByText(/ссылки.md:.*больше 200 разных ссылок/);
    expect(await view.client.all()).toEqual([]);
  });

  it('помечает импортированный документ как прошедший seed', async () => {
    const view = await markdownSetup();
    const open = view.docs.open.bind(view.docs);
    const marked = vi.fn();
    vi.spyOn(view.docs, 'open').mockImplementation(async (id) => {
      const handle = await open(id);
      const original = handle.markSeeded.bind(handle);
      handle.markSeeded = async () => {
        marked();
        await original();
      };
      return handle;
    });
    fireEvent.change(view.input, { target: { files: [new File(['# Один\nтекст'], 'один.md')] } });
    await view.findByRole('button', { name: 'Скачать .md' });
    // Закрытый документ иначе не отправит текст: сервер ждёт seed (D-753).
    expect(marked).toHaveBeenCalled();
    view.unmount();
  });

  it('отказывает файлу, чьё обновление Yjs не примет сервер', async () => {
    const view = await markdownSetup();
    const big = '漢'.repeat(190_000);
    fireEvent.change(view.input, { target: { files: [new File([big], 'большой.md')] } });
    await view.findByText(/большой.md:.*слишком большой/);
    expect(await view.client.all()).toEqual([]);
  });

  it('не даёт скачать документ до загрузки handle', async () => {
    const view = await setup();
    expect(view.getByRole('button', { name: 'Скачать .md' })).toBeDisabled();
  });
});
