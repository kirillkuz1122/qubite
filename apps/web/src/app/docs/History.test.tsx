import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import type { DocHandle, DocVersion, DocsVersionsTransport } from '@qubite/sync-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import * as Y from 'yjs';
import { History } from './History';
import type { VersionBlock } from './versions-diff';

vi.mock('../parts', () => ({
  SecHead: ({ label, children }: { label: string; children?: ReactNode }) => (
    <div>
      <h2>{label}</h2>
      {children}
    </div>
  ),
}));

function document(blocks: VersionBlock[]) {
  const doc = new Y.Doc();
  const root = doc.get('root', Y.XmlText);
  for (const block of blocks) {
    const node = new Y.XmlText();
    root.applyDelta([{ retain: root.length }, { insert: node }]);
    node.setAttribute('__type', 'qubite-block');
    node.setAttribute('__kind', block.kind);
    node.setAttribute('__checked', !!block.checked);
    node.insert(0, block.text);
  }
  return doc;
}
const p = (text: string): VersionBlock => ({ kind: 'p', text });
function version(id: string, blocks = [p('Старый текст')], kind = 'named'): DocVersion {
  const doc = document(blocks);
  const ystate = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return {
    id,
    kind,
    name: kind === 'named' ? 'Черновик' : null,
    created_at: '2026-11-04T08:00:00Z',
    preview: blocks[0]?.text ?? '',
    title: 'Документ',
    size: ystate.length,
    text: blocks.map((block) => block.text).join('\n'),
    ystate,
  };
}
const docs: Y.Doc[] = [];
function setup(versions = [version('v1')], online = true) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  const doc = document([p('Текущий текст')]);
  docs.push(doc);
  const handle: DocHandle = {
    id: 'page',
    doc,
    loaded: true,
    status: 'saved',
    links: [],
    lost: [],
    seedMarkdown: null,
    recovered: null,
    cacheLinks: async () => {},
    onLinks: () => () => {},
    clearRecovered: async () => {},
    onLost: () => () => {},
    clearLost: async () => {},
    text: () => '',
    sync: async () => {},
    restoreVersion: async () => {},
    markSeeded: async () => {},
    onStatus: () => () => {},
    onReset: () => () => {},
    close: async () => {},
  };
  const transport = {
    listVersions: vi.fn<DocsVersionsTransport['listVersions']>().mockResolvedValue(versions),
    getVersion: vi
      .fn<DocsVersionsTransport['getVersion']>()
      .mockImplementation(async (_, vid) => versions.find((item) => item.id === vid)!),
    createVersion: vi.fn<DocsVersionsTransport['createVersion']>(),
    renameVersion: vi
      .fn<DocsVersionsTransport['renameVersion']>()
      .mockImplementation(async (_, vid, name) => ({
        ...versions.find((item) => item.id === vid)!,
        name,
      })),
    deleteVersion: vi.fn<DocsVersionsTransport['deleteVersion']>().mockResolvedValue(undefined),
    listTrash: vi.fn<DocsVersionsTransport['listTrash']>().mockResolvedValue([]),
  };
  const store = {
    restoreVersion: vi.fn().mockResolvedValue(undefined),
    createVersion: vi.fn().mockResolvedValue(version('new')),
  };
  const onClose = vi.fn();
  const onRestored = vi.fn();
  const view = render(
    <History
      id="page"
      open
      handle={handle}
      store={store}
      transport={transport}
      onClose={onClose}
      onRestored={onRestored}
    >
      <div>Живой редактор</div>
    </History>,
  );
  return { ...view, transport, store, handle, onClose, onRestored };
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  docs.splice(0).forEach((doc) => doc.destroy());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('история документа', () => {
  it('показывает виды, превью первой строки и управление только именованными', async () => {
    const named = version('named');
    named.preview = 'Первая строка\nВторая строка';
    const view = setup([
      version('auto', undefined, 'auto'),
      named,
      version('restore', undefined, 'before_restore'),
    ]);
    expect(await view.findByText('Автоснимок')).toBeInTheDocument();
    expect(view.getByText('Черновик · Версия')).toBeInTheDocument();
    expect(view.getByText('Перед восстановлением')).toBeInTheDocument();
    expect(view.getByText('Первая строка')).toBeInTheDocument();
    expect(view.queryByText('Вторая строка')).toBeNull();
    expect(view.getAllByRole('button', { name: /Переименовать версию/ })).toHaveLength(1);
    expect(view.getAllByRole('button', { name: /Удалить версию/ })).toHaveLength(1);
  });

  it('открывает блоки из Yjs-снимка с видами и состоянием дела', async () => {
    const blocks: VersionBlock[] = [
      { kind: 'h1', text: 'Заголовок' },
      { kind: 'h2', text: 'Подзаголовок' },
      { kind: 'ul', text: 'Пункт' },
      { kind: 'ol', text: 'Первый' },
      { kind: 'todo', text: 'Готово', checked: true },
      { kind: 'quote', text: 'Цитата' },
      { kind: 'code', text: 'const x = 1;' },
    ];
    const view = setup([version('v', blocks)]);
    fireEvent.click(await view.findByRole('button', { name: /Черновик · Версия/ }));
    const preview = await view.findByLabelText('Текст версии');
    expect(
      within(preview).getByRole('heading', { name: 'Заголовок', level: 1 }),
    ).toBeInTheDocument();
    for (const block of blocks)
      expect(preview.querySelector(`[data-kind="${block.kind}"]`)).toHaveTextContent(block.text);
    expect(preview.querySelector('[data-kind="todo"]')).toHaveAttribute('data-checked', 'true');
    expect(preview.querySelector('[contenteditable="true"]')).toBeNull();
  });

  it('сравнивает от версии к текущему тексту: знаки, подписи, слова и счётчик', async () => {
    const view = setup([version('v', [p('Привет, старый мир!'), p('Исчезнувшая строка')])]);
    act(() => {
      const root = view.handle.doc.get('root', Y.XmlText);
      view.handle.doc.transact(() => {
        root.delete(0, root.length);
        for (const block of [
          p('Привет, новый мир!'),
          { kind: 'h1', text: 'Добавленный заголовок' },
        ]) {
          const node = new Y.XmlText();
          root.applyDelta([{ retain: root.length }, { insert: node }]);
          node.setAttribute('__type', 'qubite-block');
          node.setAttribute('__kind', block.kind);
          node.insert(0, block.text);
        }
      });
    });
    fireEvent.click(await view.findByRole('button', { name: /Черновик · Версия/ }));
    await view.findByLabelText('Текст версии');
    fireEvent.click(view.getByRole('switch', { name: 'Сравнить с текущей' }));
    expect(view.getByText('+ Добавлено')).toBeInTheDocument();
    expect(view.getByText('− Удалено')).toBeInTheDocument();
    expect(view.getByText('± Изменено')).toBeInTheDocument();
    expect(view.getByText('−старый').tagName).toBe('DEL');
    expect(view.getByText('+новый').tagName).toBe('INS');
    expect(view.getByRole('status')).toHaveTextContent('Изменений: 3');
  });

  it('восстанавливает только после подтверждения; отмена ничего не меняет', async () => {
    const view = setup();
    fireEvent.click(await view.findByRole('button', { name: /Черновик · Версия/ }));
    await view.findByLabelText('Текст версии');
    fireEvent.click(view.getByRole('button', { name: 'Восстановить', exact: true }));
    const dialog = view.getByRole('dialog', { name: 'Восстановить версию' });
    expect(within(dialog).getByText('Текущий текст сохранится в истории')).toBeInTheDocument();
    expect(view.store.restoreVersion).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(view.store.restoreVersion).not.toHaveBeenCalled();
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
    fireEvent.click(view.getByRole('button', { name: 'Восстановить', exact: true }));
    fireEvent.click(
      within(view.getByRole('dialog')).getByRole('button', { name: 'Восстановить', exact: true }),
    );
    await waitFor(() =>
      expect(view.store.restoreVersion).toHaveBeenCalledWith(
        'page',
        expect.objectContaining({ id: 'v1' }),
      ),
    );
    expect(view.onRestored).toHaveBeenCalledOnce();
  });

  it('сохраняет именованную версию через DocStore и обновляет список', async () => {
    const view = setup();
    await view.findByText('Черновик · Версия');
    const save = view.getByRole('button', { name: 'Сохранить версию' });
    expect(save).toBeDisabled();
    fireEvent.change(view.getByLabelText('Имя версии'), {
      target: { value: '  После правок  ' },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(view.store.createVersion).toHaveBeenCalledWith('page', 'После правок'),
    );
    await waitFor(() => expect(view.transport.listVersions).toHaveBeenCalledTimes(2));
    expect(view.transport.createVersion).not.toHaveBeenCalled();
    expect(view.getByText('Версия сохранена')).toBeInTheDocument();
  });

  it('переименовывает и удаляет именованную версию с подтверждением', async () => {
    const view = setup();
    fireEvent.click(await view.findByRole('button', { name: /Переименовать версию/ }));
    fireEvent.change(view.getByLabelText('Новое имя версии'), { target: { value: 'Готово' } });
    fireEvent.click(view.getByRole('button', { name: 'Сохранить имя' }));
    await waitFor(() =>
      expect(view.transport.renameVersion).toHaveBeenCalledWith('page', 'v1', 'Готово'),
    );
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
    fireEvent.click(view.getByRole('button', { name: /Удалить версию/ }));
    expect(view.transport.deleteVersion).not.toHaveBeenCalled();
    fireEvent.click(
      within(view.getByRole('dialog')).getByRole('button', { name: 'Удалить', exact: true }),
    );
    await waitFor(() =>
      expect(view.transport.deleteVersion).toHaveBeenCalledWith('page', 'v1'),
    );
  });

  it('без сети не запрашивает историю и запрещает сохранение', () => {
    const view = setup(undefined, false);
    expect(view.getByText('Нужна связь, чтобы посмотреть историю')).toBeInTheDocument();
    expect(view.getByText('Нужна связь: версия снимается на сервере')).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Сохранить версию' })).toBeDisabled();
    expect(view.transport.listVersions).not.toHaveBeenCalled();
  });

  it('разрешает восстановление уже скачанной версии после потери сети', async () => {
    const view = setup();
    fireEvent.click(await view.findByRole('button', { name: /Черновик · Версия/ }));
    await view.findByLabelText('Текст версии');
    act(() => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
    });
    fireEvent.click(view.getByRole('button', { name: 'Восстановить', exact: true }));
    fireEvent.click(
      within(view.getByRole('dialog')).getByRole('button', { name: 'Восстановить', exact: true }),
    );
    await waitFor(() => expect(view.store.restoreVersion).toHaveBeenCalledOnce());
  });

  it.each(['Документ ещё не загружен', 'Документ слишком большой'])(
    'объясняет ошибку восстановления: %s',
    async (message) => {
      const view = setup();
      view.store.restoreVersion.mockRejectedValueOnce(new Error(message));
      fireEvent.click(await view.findByRole('button', { name: /Черновик · Версия/ }));
      await view.findByLabelText('Текст версии');
      fireEvent.click(view.getByRole('button', { name: 'Восстановить', exact: true }));
      fireEvent.click(
        within(view.getByRole('dialog')).getByRole('button', { name: 'Восстановить', exact: true }),
      );
      await waitFor(() =>
        expect(
          within(view.getByRole('dialog')).getByText(
            new RegExp(message.includes('большой') ? 'слишком большой' : 'не загружен'),
          ),
        ).toBeInTheDocument(),
      );
      expect(view.onRestored).not.toHaveBeenCalled();
    },
  );

  it('пустой список объясняет появление версий', async () => {
    const view = setup([]);
    expect(
      await view.findByText('Версий пока нет — они появляются, когда вы правите документ'),
    ).toBeInTheDocument();
  });

  it('объясняет ошибку загрузки снимка и повторяет запрос', async () => {
    const view = setup();
    view.transport.getVersion.mockRejectedValueOnce(new Error('network'));
    fireEvent.click(await view.findByRole('button', { name: /Черновик · Версия/ }));
    expect(
      await view.findByText('Не удалось открыть версию. Проверьте связь и повторите.'),
    ).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Повторить', exact: true }));
    expect(await view.findByLabelText('Текст версии')).toHaveTextContent('Старый текст');
    expect(view.transport.getVersion).toHaveBeenCalledTimes(2);
  });

  it('на телефоне подтверждение использует одно окно', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const view = setup();
    fireEvent.click(await view.findByRole('button', { name: /Черновик · Версия/ }));
    await view.findByLabelText('Текст версии');
    fireEvent.click(view.getByRole('button', { name: 'Восстановить', exact: true }));
    expect(view.getAllByRole('dialog')).toHaveLength(1);
    expect(view.getByText('Текущий текст сохранится в истории')).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Отмена' }));
    expect(view.store.restoreVersion).not.toHaveBeenCalled();
    expect(view.getByLabelText('Текст версии')).toHaveTextContent('Старый текст');
  });
});
