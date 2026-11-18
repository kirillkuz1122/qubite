import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { LostBlock } from '@qubite/sync-client';
import { MindMap } from './MindMap';
import { addChild, initMindmap, readTree, ROOT } from './model';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => {} }));

// jsdom не знает ResizeObserver; размеры холста тесту не важны.
const original = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = original;
});

function handle(lost: LostBlock[]) {
  const doc = new Y.Doc();
  initMindmap(doc, 'центр');
  let listeners: ((value: LostBlock[]) => void)[] = [];
  const value = {
    doc,
    loaded: true,
    id: 'page',
    links: [],
    cacheLinks: async () => {},
    onLinks: () => () => {},
    status: 'saved' as const,
    seedMarkdown: null,
    recovered: null,
    lost,
    cleared: 0,
    clearRecovered: async () => {},
    onLost: (callback: (value: LostBlock[]) => void) => {
      listeners.push(callback);
      callback(value.lost);
      return () => {
        listeners = listeners.filter((item) => item !== callback);
      };
    },
    clearLost: async () => {
      value.cleared++;
      value.lost = [];
      listeners.forEach((callback) => callback([]));
    },
    text: () => '',
    sync: async () => {},
    restoreVersion: async () => {},
    markSeeded: async () => {},
    onStatus: () => () => {},
    onReset: () => () => {},
    close: async () => {},
  };
  return value;
}

describe('экран mind map: правки в удалённых узлах', () => {
  it('предлагает вернуть узел и возвращает его под уцелевшего предка', async () => {
    const value = handle([]);
    const branch = addChild(value.doc, ROOT, 'ветка');
    value.lost = [{ text: 'лист — дописка', kind: 'mindmap', after: 'ветка', parent: branch }];
    render(<MindMap handle={value} title="Карта" />);
    expect(await screen.findByText(/«лист — дописка»/)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Вернуть' })));
    await waitFor(() => expect(value.cleared).toBe(1));
    const kids = readTree(value.doc).children.find((n) => n.id === branch)!.children;
    expect(kids.map((n) => n.text)).toEqual(['лист — дописка']);
    await waitFor(() => expect(screen.queryByText(/«лист — дописка»/)).toBeNull());
  });

  it('«Не нужно» убирает предложение и ничего не добавляет', async () => {
    const value = handle([{ text: 'сирота', kind: 'mindmap', after: null }]);
    render(<MindMap handle={value} title="Карта" />);
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Не нужно' })));
    await waitFor(() => expect(value.cleared).toBe(1));
    expect(readTree(value.doc).children).toHaveLength(0);
  });
});
