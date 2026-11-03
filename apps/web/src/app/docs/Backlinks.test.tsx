import type { DocLinkKind, DocLinkTarget } from '@qubite/sync-client';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BacklinksList } from './Backlinks';
import { linkHref, LINK_LABELS } from './links';

vi.mock('../parts', () => ({
  SecHead: ({ label, children }: { label: string; children?: ReactNode }) => (
    <div>
      <h2>{label}</h2>
      {children}
    </div>
  ),
}));

const links = (count: number): DocLinkTarget[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `source-${index}`,
    type: 'docs.page',
    title: `Документ ${index + 1}`,
  }));

describe('Ссылаются сюда', () => {
  it('ноль ссылок — ничего, даже заголовка и обёртки', () => {
    const view = render(<BacklinksList backlinks={[]} />);
    expect(view.container).toBeEmptyDOMElement();
  });

  it('шесть ссылок — пять строк и «Ещё 1»; после раскрытия фокус на шестой строке', async () => {
    const view = render(<BacklinksList backlinks={links(6)} />);
    expect(view.getAllByRole('link')).toHaveLength(5);
    expect(view.getByText('6')).toBeInTheDocument();
    expect(view.queryByText('Документ 6')).toBeNull();
    const more = view.getByRole('button', { name: 'Ещё 1' });
    act(() => more.focus());
    fireEvent.click(more);
    expect(view.getAllByRole('link')).toHaveLength(6);
    // Кнопка уходит анимацией, фокус не падает в начало страницы.
    expect(view.getByRole('link', { name: /Документ 6/ })).toHaveFocus();
    await waitFor(() => expect(view.queryByRole('button', { name: /Ещё/ })).toBeNull());
  });

  it('стрелки переводят фокус, включая раскрытые строки и границы списка', () => {
    const view = render(<BacklinksList backlinks={links(6)} />);
    fireEvent.click(view.getByRole('button', { name: 'Ещё 1' }));
    const rows = view.getAllByRole('link');
    act(() => rows[0]!.focus());
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
    expect(rows[1]).toHaveFocus();
    fireEvent.keyDown(rows[1]!, { key: 'ArrowUp' });
    expect(rows[0]).toHaveFocus();
    fireEvent.keyDown(rows[0]!, { key: 'ArrowUp' });
    expect(rows[5]).toHaveFocus();
    fireEvent.keyDown(rows[5]!, { key: 'ArrowDown' });
    expect(rows[0]).toHaveFocus();
  });

  it('Enter и Ctrl/⌘-клик сохраняют обычное поведение ссылки, Space нажимает её', () => {
    const view = render(<BacklinksList backlinks={links(1)} />);
    const row = view.getByRole('link');
    expect(fireEvent.keyDown(row, { key: 'Enter' })).toBe(true);
    const clicked = vi.fn();
    const follow = (event: MouseEvent) => {
      clicked(event.defaultPrevented, event.ctrlKey, event.metaKey);
      event.preventDefault();
    };
    row.addEventListener('click', follow);
    fireEvent.keyDown(row, { key: ' ' });
    expect(clicked).toHaveBeenCalledOnce();
    // Наш обработчик не перехватывает модификаторы. Предотвращаем переход только в тесте.
    fireEvent.click(row, { ctrlKey: true });
    expect(clicked).toHaveBeenNthCalledWith(2, false, true, false);
    fireEvent.click(row, { metaKey: true });
    expect(clicked).toHaveBeenNthCalledWith(3, false, false, true);
  });

  it.each(['docs.page', 'planner.task', 'planner.project', 'calendar.event'] as DocLinkKind[])(
    '%s получает linkHref и подпись типа',
    (type) => {
      const view = render(<BacklinksList backlinks={[{ id: 'a /', type, title: 'Источник' }]} />);
      expect(view.getByRole('link')).toHaveAttribute('href', linkHref('a /', type));
      expect(view.getByRole('link')).toHaveTextContent(`Источник · ${LINK_LABELS[type]}`);
    },
  );

  it('обычный клик открывает через переход приложения, Ctrl-клик — как ссылка', () => {
    const open = vi.fn();
    const view = render(
      <BacklinksList backlinks={[{ id: 'doc', type: 'docs.page', title: 'Источник' }]} open={open} />,
    );
    const link = view.getByRole('link');
    fireEvent.click(link, { ctrlKey: true });
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith(linkHref('doc', 'docs.page'));
  });

  it('документ без названия подписан «Без названия»', () => {
    const view = render(
      <BacklinksList backlinks={[{ id: 'doc', type: 'docs.page', title: '   ' }]} />,
    );
    expect(view.getByRole('link', { name: 'Без названия · Документ' })).toBeInTheDocument();
  });

  it('сообщение без ссылок не создаёт пустой заголовок', () => {
    const view = render(<BacklinksList backlinks={[]} message="Загружаю ссылки…" />);
    expect(view.getByRole('status')).toHaveTextContent('Загружаю ссылки…');
    expect(view.queryByRole('heading')).toBeNull();
    expect(view.queryByRole('link')).toBeNull();
  });
});
