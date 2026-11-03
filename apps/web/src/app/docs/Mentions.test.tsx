import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import type { DocHandle, DocLink } from '@qubite/sync-client';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { $createTextNode, $getRoot, type LexicalEditor } from 'lexical';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { $createBlockNode } from './BlockNode';
import { $createMentionNode } from './MentionNode';
import { Mentions } from './Mentions';
import { DOC_NODES, $extractLinks } from './markdown';
import { httpLinkSource, linkHref, mentionLabel, type LinkSource } from './links';

const first = { id: '11111111-1111-4111-8111-111111111111', type: 'docs.page' as const, title: 'Графы' };
const second = { id: '22222222-2222-4222-8222-222222222222', type: 'planner.task' as const, title: 'Решить задачу' };
const source = (): LinkSource => ({
  search: vi.fn(async () => [first, second]),
  links: vi.fn(async () => []),
});

function Capture({ ready }: { ready: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => ready(editor), [editor, ready]);
  return null;
}

function setup(linkSource = source(), cached: DocLink[] = []) {
  let editor!: LexicalEditor;
  const listeners = new Set<() => void>();
  const handle: DocHandle = {
    id: 'page', doc: new Y.Doc(), status: 'saved', seedMarkdown: null,
    recovered: null, lost: [], links: cached,
    async cacheLinks(links) {
      Object.assign(handle, { links: [...new Map([...handle.links, ...links].map((link) => [link.id, link])).values()] });
      listeners.forEach((callback) => callback());
    },
    onLinks(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    onStatus: () => () => {}, onReset: () => () => {}, onLost: () => () => {},
    clearLost: async () => {}, clearRecovered: async () => {}, markSeeded: async () => {},
    sync: async () => {}, close: async () => {}, text: () => '',
  };
  const view = render(
    <LexicalComposer initialConfig={{
      namespace: 'mention-test', nodes: DOC_NODES,
      onError: (error) => { throw error; },
      editorState: () => { $getRoot().append($createBlockNode()); },
    }}>
      <RichTextPlugin contentEditable={<ContentEditable aria-label="Текст" />} ErrorBoundary={LexicalErrorBoundary} />
      <Capture ready={(value) => { editor = value; }} />
      <Mentions handle={handle} source={linkSource} />
    </LexicalComposer>,
  );
  const type = async (text: string) => {
    await act(async () => {
      editor.update(() => {
        const node = $createTextNode(text);
        $getRoot().clear().append($createBlockNode().append(node));
        node.selectEnd();
      }, { discrete: true });
    });
  };
  const readLinks = () => editor.getEditorState().read($extractLinks);
  return { ...view, editor, handle, type, readLinks, textbox: view.getByRole('textbox', { name: 'Текст' }) };
}

beforeEach(() => {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  });
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [],
  });
});
afterEach(() => vi.restoreAllMocks());

describe('меню упоминаний', () => {
  it('почта не открывает меню; начало строки и пробел открывают', async () => {
    const fake = source();
    const view = setup(fake);
    await view.type('a@b');
    expect(view.queryByRole('listbox')).not.toBeInTheDocument();
    expect(fake.search).not.toHaveBeenCalled();
    await view.type('Текст @');
    await waitFor(() => expect(fake.search).toHaveBeenCalledWith('', expect.any(AbortSignal)));
    expect(await view.findByRole('option', { name: /Графы/ })).toBeVisible();
    await view.type('@Гра');
    await waitFor(() => expect(fake.search).toHaveBeenCalledWith('Гра', expect.any(AbortSignal)));
  });

  it.each(['Enter', 'Tab'])('стрелки и %s выбирают цель; подпись не попадает в узел', async (key) => {
    const view = setup();
    await view.type('Перед @');
    await view.findByRole('option', { name: /Графы/ });
    fireEvent.keyDown(view.textbox, { key: 'ArrowDown' });
    fireEvent.keyDown(view.textbox, { key: 'ArrowUp' });
    fireEvent.keyDown(view.textbox, { key: 'ArrowDown' });
    fireEvent.keyDown(view.textbox, { key });
    await waitFor(() => expect(view.readLinks()).toEqual([second.id]));
    expect(JSON.stringify(view.editor.getEditorState().toJSON())).not.toContain(second.title);
    await waitFor(() => expect(view.handle.links[0]?.title).toBe(second.title));
  });

  it('Esc оставляет набранное и не открывает то же меню повторно', async () => {
    const view = setup();
    await view.type('Перед @Гра');
    await view.findByRole('option', { name: /Графы/ });
    fireEvent.keyDown(view.textbox, { key: 'Escape' });
    await waitFor(() => expect(view.queryByRole('listbox')).not.toBeInTheDocument());
    expect(view.textbox).toHaveTextContent('Перед @Гра');
    await act(async () => { view.editor.update(() => {}); });
    expect(view.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('отменяет старый запрос и игнорирует его поздний ответ', async () => {
    let finish!: (targets: typeof first[]) => void;
    let oldSignal!: AbortSignal;
    const fake: LinkSource = {
      links: async () => [],
      search: vi.fn((query, signal) => {
        if (query === '') {
          oldSignal = signal;
          return new Promise<typeof first[]>((resolve) => { finish = resolve; });
        }
        return Promise.resolve([second]);
      }),
    };
    const view = setup(fake);
    await view.type('@');
    await waitFor(() => expect(fake.search).toHaveBeenCalledTimes(1));
    await view.type('@зада');
    expect(oldSignal.aborted).toBe(true);
    await view.findByRole('option', { name: /Решить задачу/ });
    await act(async () => finish([first]));
    expect(view.queryByRole('option', { name: /Графы/ })).not.toBeInTheDocument();
  });

  it('сам документ в меню не предлагается', async () => {
    const own = { id: 'page', type: 'docs.page' as const, title: 'Этот документ' };
    const fake: LinkSource = {
      search: vi.fn(async () => [own, first]),
      links: vi.fn(async () => []),
    };
    const view = setup(fake);
    await view.type('@');
    expect(await view.findByRole('option', { name: /Графы/ })).toBeVisible();
    expect(view.queryByRole('option', { name: /Этот документ/ })).not.toBeInTheDocument();
  });

  it('без сети ищет сохранённые названия', async () => {
    const fake: LinkSource = { search: async () => { throw new Error('offline'); }, links: async () => [] };
    const view = setup(fake, [{ ...first, deleted: false }]);
    await view.type('@Гра');
    expect(await view.findByRole('option', { name: /Графы/ })).toBeVisible();
  });

  it('удалённая цель не открывается; восстановление меняет подпись без изменения Yjs', async () => {
    const view = setup(source(), [{ ...first, deleted: true }]);
    await act(async () => view.editor.update(() => {
      $getRoot().clear().append($createBlockNode().append($createMentionNode(first.id, first.type)));
    }, { discrete: true }));
    const chip = view.getByRole('link', { name: 'Документ: Удалено' });
    expect(chip).toHaveAttribute('aria-disabled', 'true');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    fireEvent.click(chip, { ctrlKey: true });
    fireEvent.keyDown(chip, { key: 'Enter', ctrlKey: true });
    expect(open).not.toHaveBeenCalled();
    const before = view.editor.getEditorState().toJSON();
    await act(async () => view.handle.cacheLinks([{ ...first, deleted: false }]));
    expect(chip).toHaveTextContent('Графы');
    expect(view.editor.getEditorState().toJSON()).toEqual(before);
    fireEvent.click(chip, { metaKey: true });
    expect(open).toHaveBeenCalledWith(`/docs/${first.id}`, '_blank', 'noopener,noreferrer');
    fireEvent.keyDown(chip, { key: 'Enter', ctrlKey: true });
    expect(open).toHaveBeenCalledTimes(2);
  });
});

it('LinkSource использует тонкий HTTP-контракт и передаёт отмену', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) => new Response(JSON.stringify(
    String(url).includes('link-targets') ? { targets: [first] } : { links: [{ ...first, deleted: true }] },
  )));
  const client = httpLinkSource(fetch);
  const abort = new AbortController();
  expect(await client.search('два слова', abort.signal)).toEqual([first]);
  expect(fetch).toHaveBeenCalledWith('/api/v1/docs/link-targets?q=%D0%B4%D0%B2%D0%B0%20%D1%81%D0%BB%D0%BE%D0%B2%D0%B0', {
    credentials: 'include', signal: abort.signal,
  });
  expect((await client.links('page', abort.signal))[0]?.deleted).toBe(true);
  expect(mentionLabel(undefined)).toBe('…');
  expect(linkHref(first.id, 'planner.task')).toBe(`/planner?task=${first.id}`);
  expect(linkHref(first.id, 'planner.project')).toBe(`/planner/project/${first.id}`);
  expect(linkHref(first.id, 'calendar.event')).toBe(`/calendar?event=${first.id}`);
});
