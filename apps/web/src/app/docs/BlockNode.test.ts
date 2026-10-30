import { createYjsBinding, syncLexicalUpdateToYjs, syncYjsChangesToLexical } from '@lexical/yjs';
import {
  $createTextNode,
  $getRoot,
  $isTextNode,
  createEditor,
  SKIP_COLLAB_TAG,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { DocStore, type DocsTransport } from '@qubite/sync-client';
import * as Y from 'yjs';
import { $createBlockNode, $isBlockNode, $orderedNumber, BLOCK_KINDS } from './BlockNode';
import { DOC_NODES, $exportMarkdown, $importMarkdown } from './markdown';
import { attachMarkdownExport, DocsProvider } from './provider';
import { renderDocText } from './render';

function editor() {
  return createEditor({
    nodes: DOC_NODES,
    onError: (error) => {
      throw error;
    },
  });
}

function blocks(e: LexicalEditor) {
  return e.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .filter($isBlockNode)
      .map((node) => ({
        kind: node.getKind(),
        checked: node.getChecked(),
        indent: node.getIndent(),
        text: node.getTextContent(),
      })),
  );
}

function $first() {
  const first = $getRoot().getFirstChild();
  if (!$isBlockNode(first)) throw new Error('нет блока');
  return first;
}

describe('BlockNode', () => {
  it('все виды меняют свойство, сохраняя ключ и текст', () => {
    const e = editor();
    e.update(
      () => {
        const node = $createBlockNode().append($createTextNode('Общий текст'));
        $getRoot().append(node);
        const key = node.getKey();
        const textKey = node.getFirstChild()!.getKey();
        for (const kind of BLOCK_KINDS) {
          node.setKind(kind);
          expect(node.getKind()).toBe(kind);
          expect(node.getKey()).toBe(key);
          expect(node.getFirstChild()!.getKey()).toBe(textKey);
          expect(node.getTextContent()).toBe('Общий текст');
        }
      },
      { discrete: true },
    );
  });

  it('ограничивает отступ и считает соседние нумерованные блоки', () => {
    const e = editor();
    e.update(
      () => {
        const a = $createBlockNode('ol');
        const nested = $createBlockNode('ul').setIndent(1);
        const b = $createBlockNode('ol');
        const stop = $createBlockNode();
        const c = $createBlockNode('ol');
        $getRoot().append(a, nested, b, stop, c);
        expect($orderedNumber(a)).toBe(1);
        expect($orderedNumber(b)).toBe(2);
        expect($orderedNumber(c)).toBe(1);
        expect(b.setIndent(10).getIndent()).toBe(4);
        expect(b.setIndent(-2).getIndent()).toBe(0);
      },
      { discrete: true },
    );
  });

  it('Markdown туда и обратно: все виды, форматирование, отступы и код', () => {
    const a = editor();
    const b = editor();
    const markdown =
      '# Заголовок\n## Подзаголовок\n**жирный** и *курсив* и ~~нет~~ и `x`\n- пункт\n  1. вложенный\n- [x] готово\n> цитата\n```ts\nconst x = 1;\n\n// строка\n```';
    a.update(() => $importMarkdown(markdown), { discrete: true });
    const exported = a.getEditorState().read($exportMarkdown);
    b.update(() => $importMarkdown(exported), { discrete: true });
    expect(blocks(b)).toEqual(blocks(a));
    expect(blocks(a).map((node) => node.kind)).toEqual([
      'h1',
      'h2',
      'p',
      'ul',
      'ol',
      'todo',
      'quote',
      'code',
    ]);
    expect(blocks(a).at(-1)?.text).toBe('const x = 1;\n\n// строка');
    expect(b.getEditorState().read($exportMarkdown)).toBe(exported);
    expect(exported).toContain('**жирный**');
    expect(exported).toContain('- [x] готово');
  });

  it('пустой seed создаёт пустой блок, поздний seed сохраняет офлайн-текст', () => {
    const e = editor();
    e.update(() => $importMarkdown(''), { discrete: true });
    expect(blocks(e)).toEqual([{ kind: 'p', checked: false, indent: 0, text: '' }]);
    e.update(
      () => {
        $first().append($createTextNode('без сети'));
      },
      { discrete: true },
    );
    e.update(() => $importMarkdown('', true), { discrete: true });
    expect(blocks(e)[0]?.text).toBe('без сети');
    e.update(() => $importMarkdown('# старый документ', true), { discrete: true });
    expect(blocks(e).map((block) => block.text)).toEqual(['старый документ', 'без сети']);
  });

  it('JSON сохраняет свойства и формат текста', () => {
    const a = editor();
    a.update(
      () => {
        $getRoot().append(
          $createBlockNode('todo')
            .setChecked(true)
            .setIndent(4)
            .append($createTextNode('важно').toggleFormat('bold')),
        );
      },
      { discrete: true },
    );
    const b = editor();
    b.setEditorState(b.parseEditorState(JSON.stringify(a.getEditorState().toJSON())));
    expect(blocks(b)).toEqual(blocks(a));
    expect(b.getEditorState().read($exportMarkdown)).toContain('**важно**');
  });
});

/** Настоящая привязка Lexical ↔ Yjs, без React и экрана. */
function bind(doc: Y.Doc) {
  const e = editor();
  const provider = new DocsProvider(doc).asProvider();
  const binding = createYjsBinding({
    editor: e,
    id: 'test',
    doc,
    docMap: new Map([['test', doc]]),
  });
  const stop = e.registerUpdateListener((update) => {
    if (update.tags.has(SKIP_COLLAB_TAG)) return;
    syncLexicalUpdateToYjs(
      binding,
      provider,
      update.prevEditorState,
      update.editorState,
      update.dirtyElements,
      update.dirtyLeaves,
      update.normalizedNodes,
      update.tags,
    );
  });
  const root = binding.root.getSharedType();
  const changes: Parameters<typeof root.observeDeep>[0] = (events, transaction) => {
    if (transaction.origin !== binding)
      syncYjsChangesToLexical(binding, provider, events, false, () => {});
  };
  root.observeDeep(changes);
  return {
    editor: e,
    close() {
      stop();
      root.unobserveDeep(changes);
      binding.root.destroy(binding);
    },
  };
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('BlockNode через две копии Yjs', () => {
  it.each(BLOCK_KINDS)(
    'смена kind на %s и дописывание без сети сохраняют весь текст',
    async (kind) => {
      const a = new Y.Doc();
      const b = new Y.Doc();
      const first = bind(a);
      const second = bind(b);
      try {
        first.editor.update(
          () => $getRoot().append($createBlockNode().append($createTextNode('начало'))),
          { discrete: true },
        );
        Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
        await settle();
        first.editor.update(
          () => {
            $first().setKind(kind);
          },
          { discrete: true },
        );
        second.editor.update(
          () => {
            const text = $first().getFirstChildOrThrow();
            if (!$isTextNode(text)) throw new Error('нет текста');
            text.setTextContent('начало и продолжение');
          },
          { discrete: true },
        );
        const left = Y.encodeStateAsUpdate(a);
        const right = Y.encodeStateAsUpdate(b);
        Y.applyUpdate(a, right);
        Y.applyUpdate(b, left);
        await settle();
        expect(blocks(first.editor)).toEqual([
          { kind, checked: false, indent: 0, text: 'начало и продолжение' },
        ]);
        expect(blocks(second.editor)).toEqual(blocks(first.editor));
        Y.applyUpdate(a, right);
        Y.applyUpdate(b, left);
        await settle();
        expect(blocks(second.editor)).toEqual(blocks(first.editor));
      } finally {
        first.close();
        second.close();
        a.destroy();
        b.destroy();
      }
    },
  );
});

describe('Markdown без экрана', () => {
  it('читает настоящий Yjs Lexical синхронно и не меняет исходный документ', () => {
    const doc = new Y.Doc();
    const bound = bind(doc);
    try {
      const markdown = '# Заголовок\n**Важное**\n- [x] готово\n> цитата\n```\nкод\n```';
      bound.editor.update(() => $importMarkdown(markdown), { discrete: true });
      const before = Y.encodeStateAsUpdate(doc);
      const expected = bound.editor.getEditorState().read($exportMarkdown);
      expect(renderDocText(doc)).toBe(expected);
      expect(renderDocText(doc)).toBe(expected);
      expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    } finally {
      bound.close();
      doc.destroy();
    }
  });

  it('syncAll после отключения редактора отправляет слитый Markdown обоих устройств', async () => {
    const remote = new Y.Doc();
    const serverEditor = bind(remote);
    let sent = '';
    const transport: DocsTransport = {
      async pull(_id, sv) {
        return {
          update: Y.encodeStateAsUpdate(remote, sv),
          sv: Y.encodeStateVector(remote),
          seedMarkdown: null,
        };
      },
      async push(_id, update, text) {
        Y.applyUpdate(remote, update);
        sent = text;
        return { sv: Y.encodeStateVector(remote) };
      },
    };
    const store = new DocStore({
      transport,
      indexedDB: new IDBFactory(),
      renderText: renderDocText,
      debounceMs: 60_000,
    });
    try {
      serverEditor.editor.update(() => $importMarkdown('Общая основа'), { discrete: true });
      const handle = await store.open('page');
      // Экран подключил экспорт, затем отсоединился: возвращается headless-экспорт.
      const detach = attachMarkdownExport(handle, () => 'последний текст экрана');
      detach();
      const view = new Y.Doc();
      const local = bind(view);
      Y.applyUpdate(view, Y.encodeStateAsUpdate(handle.doc));
      await settle();
      local.editor.update(
        () => $getRoot().append($createBlockNode().append($createTextNode('С ноутбука'))),
        { discrete: true },
      );
      Y.applyUpdate(handle.doc, Y.encodeStateAsUpdate(view));
      local.close();
      view.destroy();
      await handle.close();
      serverEditor.editor.update(
        () => $getRoot().append($createBlockNode('h2').append($createTextNode('С телефона'))),
        { discrete: true },
      );
      await store.syncAll();
      expect(sent).toContain('С ноутбука');
      expect(sent).toContain('## С телефона');
      expect(sent).toContain('Общая основа');
      expect(sent).toBe(renderDocText(remote));
    } finally {
      await store.close();
      serverEditor.close();
      remote.destroy();
    }
  });
});
