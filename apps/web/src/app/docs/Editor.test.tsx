import { fireEvent, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle } from '@qubite/sync-client';
import { DocEditor } from './Editor';

function handle(seedMarkdown: string | null): DocHandle {
  return {
    doc: new Y.Doc(),
    status: 'pending',
    seedMarkdown,
    recovered: null,
    lost: [],
    clearRecovered: async () => {},
    onLost: (callback) => {
      callback([]);
      return () => {};
    },
    clearLost: async () => {},
    text: () => '',
    sync: async () => {},
    markSeeded: vi.fn(async () => {}),
    onStatus: (callback) => {
      callback('pending');
      return () => {};
    },
    onReset: () => () => {},
    close: async () => {},
  };
}

describe('перенос Markdown в связке Lexical + Yjs', () => {
  it.each(['', '# Старое название\nТекст старого документа'])(
    'обрабатывает seed %j и отмечает один раз',
    async (markdown) => {
      const doc = handle(markdown);
      const view = render(
        <StrictMode>
          <DocEditor handle={doc} />
        </StrictMode>,
      );
      await waitFor(() => expect(doc.markSeeded).toHaveBeenCalledTimes(1));
      if (markdown) expect(doc.text()).toContain('Текст старого документа');
      else expect(doc.text().trim()).toBe('');
      view.unmount();
      doc.doc.destroy();
    },
  );

  it('null означает отсутствие переноса', async () => {
    const doc = handle(null);
    const view = render(<DocEditor handle={doc} />);
    await waitFor(() =>
      expect(view.getByRole('textbox', { name: 'Текст документа' })).toBeInTheDocument(),
    );
    expect(doc.markSeeded).not.toHaveBeenCalled();
    view.unmount();
    doc.doc.destroy();
  });
});

describe('предложения восстановления из хранилища', () => {
  it.each([true, false])('запасной вариант: вставить=%s', async (insert) => {
    const doc = {
      ...handle(null),
      recovered: '# Свой вариант\nСохранённая дописка',
      clearRecovered: vi.fn(async () => {}),
    };
    const view = render(<DocEditor handle={doc} />);
    await waitFor(() =>
      expect(view.getByRole('textbox', { name: 'Текст документа' })).toBeInTheDocument(),
    );
    expect(
      view.getByText('На этом устройстве был свой вариант — вставить в конец?'),
    ).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: insert ? 'Вставить' : 'Не надо' }));
    await waitFor(() => expect(doc.clearRecovered).toHaveBeenCalledOnce());
    if (insert) expect(doc.text()).toContain('Сохранённая дописка');
    else expect(doc.text()).not.toContain('Сохранённая дописка');
    view.unmount();
    doc.doc.destroy();
  });

  it('читает найденные хранилищем блоки и возвращает их в порядке текста', async () => {
    const lost = [
      { text: 'Первая', kind: 'p', after: null },
      { text: 'Вторая', kind: 'p', after: null },
    ];
    const doc = {
      ...handle(null),
      lost,
      onLost: (callback: (value: typeof lost) => void) => {
        callback(lost);
        return () => {};
      },
      clearLost: vi.fn(async () => {}),
    };
    const view = render(<DocEditor handle={doc} />);
    await waitFor(() =>
      expect(view.getByRole('textbox', { name: 'Текст документа' })).toBeInTheDocument(),
    );
    fireEvent.click(view.getByRole('button', { name: 'Вернуть' }));
    await waitFor(() => expect(doc.clearLost).toHaveBeenCalledOnce());
    expect(doc.text().indexOf('Первая')).toBeGreaterThanOrEqual(0);
    expect(doc.text().indexOf('Вторая')).toBeGreaterThan(doc.text().indexOf('Первая'));
    view.unmount();
    doc.doc.destroy();
  });
});
