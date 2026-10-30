import { render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle } from '@qubite/sync-client';
import { DocEditor } from './Editor';

function handle(seedMarkdown: string | null): DocHandle {
  return {
    doc: new Y.Doc(), status: 'pending', seedMarkdown, text: () => '',
    sync: async () => {}, markSeeded: vi.fn(async () => {}),
    onStatus: (callback) => { callback('pending'); return () => {}; },
    onReset: () => () => {}, close: async () => {},
  };
}

describe('перенос Markdown в связке Lexical + Yjs', () => {
  it.each(['', '# Старое название\nТекст старого документа'])('обрабатывает seed %j и отмечает один раз', async (markdown) => {
    const doc = handle(markdown);
    const view = render(<StrictMode><DocEditor handle={doc} /></StrictMode>);
    await waitFor(() => expect(doc.markSeeded).toHaveBeenCalledTimes(1));
    if (markdown) expect(doc.text()).toContain('Текст старого документа');
    else expect(doc.text().trim()).toBe('');
    view.unmount();
    doc.doc.destroy();
  });

  it('null означает отсутствие переноса', async () => {
    const doc = handle(null);
    const view = render(<DocEditor handle={doc} />);
    await waitFor(() => expect(view.getByRole('textbox', { name: 'Текст документа' })).toBeInTheDocument());
    expect(doc.markSeeded).not.toHaveBeenCalled();
    view.unmount();
    doc.doc.destroy();
  });
});
