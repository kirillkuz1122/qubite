import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import type { DocTrashItem, LocalObject } from '@qubite/sync-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Trash } from './Trash';

const local = (id: string, deleted = true, pending = true): LocalObject => ({
  id,
  object_type: 'docs.page',
  title: `Локальный ${id}`,
  fields: { preview: '**Текст** на устройстве' },
  revision: 3,
  deleted,
  pending,
  updated_at_ms: Date.parse('2026-11-04T08:00:00Z'),
});
const remote = (id: string): DocTrashItem => ({
  id,
  title: `Сетевой ${id}`,
  preview: '# Текст с сервера',
  revision: 2,
  project_ids: [],
  updated_at: '2026-11-03T08:00:00Z',
  deleted_at: '2026-11-03T08:00:00Z',
});
function setup(objects: LocalObject[] = [], docs: DocTrashItem[] = [], online = true) {
  const transport = { listTrash: vi.fn().mockResolvedValue(docs) };
  const onRestore = vi.fn().mockResolvedValue(undefined);
  const props = { objects, loaded: true, online, version: 0, transport, onRestore };
  return { ...render(<Trash {...props} />), props, transport, onRestore };
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('корзина документов', () => {
  it('объединяет локальные и сетевые документы без дублей; очередь важнее сервера', async () => {
    const restored = local('restored', false);
    const otherModule = { ...local('task'), object_type: 'planner.task' };
    const view = setup([local('both'), restored, otherModule], [remote('both'), remote('server'), remote('restored')]);
    expect(await view.findByText('Сетевой server')).toBeInTheDocument();
    expect(view.getByText('Локальный both')).toBeInTheDocument();
    expect(view.queryByText('Сетевой both')).toBeNull();
    expect(view.queryByText('Сетевой restored')).toBeNull();
    expect(view.queryByText('Локальный task')).toBeNull();
    expect(view.getAllByRole('listitem')).toHaveLength(2);
    expect(view.getByText('Текст на устройстве')).toBeInTheDocument();
    expect(view.getByText('Текст с сервера')).toBeInTheDocument();
    expect(view.getAllByText(/^Удалён /)).toHaveLength(2);
    expect(view.queryByRole('button', { name: /Открыть|Посмотреть|навсегда/ })).toBeNull();
  });

  it('использует более свежую серверную корзину, если локальный pull ещё не дошёл', async () => {
    const view = setup([{ ...local('new', false, false), revision: 1 }], [remote('new')]);
    expect(await view.findByText('Сетевой new')).toBeInTheDocument();
  });

  it('возвращает документ и убирает строку после локальной записи', async () => {
    const object = local('return');
    const view = setup([object]);
    const row = within(view.getByRole('listitem'));
    fireEvent.click(row.getByRole('button', { name: 'Вернуть «Локальный return»' }));
    await waitFor(() => expect(view.onRestore).toHaveBeenCalledWith('return'));
    view.rerender(<Trash {...view.props} objects={[{ ...object, deleted: false }]} version={1} />);
    expect(await view.findByText('Корзина пуста')).toBeInTheDocument();
  });

  it('показывает пустую корзину и объясняет срок хранения', async () => {
    const view = setup();
    expect(await view.findByText('Корзина пуста')).toBeInTheDocument();
    expect(view.getByText('Документы остаются в корзине, пока вы их не вернёте')).toBeInTheDocument();
  });

  it('без сети показывает локальные удаления и позволяет вернуть без запроса', async () => {
    const view = setup([local('offline')], [], false);
    expect(view.getByText(/Без сети/)).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Вернуть «Локальный offline»' }));
    await waitFor(() => expect(view.onRestore).toHaveBeenCalledWith('offline'));
    expect(view.transport.listTrash).not.toHaveBeenCalled();
  });

  it('показывает загрузку, затем ошибку с локальными строками и повторяет запрос', async () => {
    const transport = { listTrash: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([remote('server')]) };
    const props = { objects: [local('here')], loaded: true, online: true, version: 0, transport, onRestore: vi.fn() };
    const view = render(<Trash {...props} />);
    expect(view.getByText('Обновляю корзину…')).toBeInTheDocument();
    expect(await view.findByText(/Не удалось загрузить корзину с сервера/)).toBeInTheDocument();
    expect(view.getByText('Локальный here')).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Повторить загрузку корзины' }));
    expect(await view.findByText('Сетевой server')).toBeInTheDocument();
    expect(view.queryByText(/Не удалось загрузить корзину/)).toBeNull();
  });

  it('не выдаёт ошибку сети за пустую корзину', async () => {
    const view = setup();
    view.transport.listTrash.mockRejectedValue(new Error('offline'));
    expect(await view.findByText(/Не удалось загрузить корзину/)).toBeInTheDocument();
    expect(view.queryByText('Корзина пуста')).toBeNull();
  });

  it('сохраняет строку при ошибке возврата и позволяет повторить', async () => {
    const view = setup([local('retry')], [], false);
    view.onRestore.mockRejectedValueOnce(new Error('disk'));
    fireEvent.click(view.getByRole('button', { name: 'Вернуть «Локальный retry»' }));
    expect(await view.findByRole('alert')).toHaveTextContent('Не удалось вернуть документ');
    expect(view.getByText('Локальный retry')).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Вернуть «Локальный retry»' }));
    await waitFor(() => expect(view.onRestore).toHaveBeenCalledTimes(2));
  });

  it('старый ответ не возвращает в корзину документ, уже восстановленный локально', async () => {
    let resolve!: (docs: DocTrashItem[]) => void;
    const transport = { listTrash: vi.fn(() => new Promise<DocTrashItem[]>((done) => { resolve = done; })) };
    const props = { objects: [local('race')], loaded: true, online: true, version: 0, transport, onRestore: vi.fn() };
    const view = render(<Trash {...props} />);
    await waitFor(() => expect(transport.listTrash).toHaveBeenCalledOnce());
    view.rerender(<Trash {...props} objects={[local('race', false)]} />);
    await act(async () => resolve([remote('race')]));
    expect(view.queryByText('Сетевой race')).toBeNull();
    expect(await view.findByText('Корзина пуста')).toBeInTheDocument();
  });
});
