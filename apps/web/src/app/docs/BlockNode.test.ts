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
import * as Y from 'yjs';
import { $createBlockNode, $isBlockNode, $orderedNumber, BLOCK_KINDS } from './BlockNode';
import { DOC_NODES, $exportMarkdown, $importMarkdown } from './markdown';
import { DocsProvider } from './provider';
import { renderDocText } from './render';
import { $appendRecovered, $restoreLost } from './restore';

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

describe('DOC-002e1: фоновый текст и возврат дописок', () => {
  it('headless-экспорт видит обе офлайн-копии, виды блоков и Markdown', async () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const first = bind(a);
    const second = bind(b);
    try {
      first.editor.update(() => {
        $importMarkdown('# Заголовок\n- [x] Готово\n> Цитата\n```\nкод\n```');
      }, { discrete: true });
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
      await settle();
      first.editor.update(() => {
        $first().append($createTextNode(' · локально').toggleFormat('bold'));
      }, { discrete: true });
      second.editor.update(() => {
        $getRoot().append($createBlockNode('ul').setIndent(1).append($createTextNode('Другая копия')));
      }, { discrete: true });
      Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
      await settle();
      const before = Y.encodeStateAsUpdate(a);
      const markdown = renderDocText(a);
      expect(markdown).toBe(first.editor.getEditorState().read($exportMarkdown));
      expect(markdown).toContain('локально');
      expect(markdown).toContain('Другая копия');
      expect(markdown).toContain('- [x] Готово');
      expect(markdown).toContain('```');
      expect(Y.encodeStateAsUpdate(a)).toEqual(before);
      expect(renderDocText(a)).toBe(markdown);
    } finally {
      first.close();
      second.close();
      a.destroy();
      b.destroy();
    }
  });

  it.each([null, 'Перед'])('несколько блоков после %j возвращаются в исходном порядке', (after) => {
    const e = editor();
    e.update(() => {
      $getRoot().append(
        $createBlockNode().append($createTextNode('Перед')),
        $createBlockNode().append($createTextNode('После')),
      );
      $restoreLost([
        { text: 'Первая', kind: 'h2', after },
        { text: 'Вторая', kind: 'quote', after },
        { text: 'Третья', kind: 'unknown', after },
      ]);
    }, { discrete: true });
    expect(blocks(e).map((node) => node.text)).toEqual(
      after === null
        ? ['Первая', 'Вторая', 'Третья', 'Перед', 'После']
        : ['Перед', 'Первая', 'Вторая', 'Третья', 'После'],
    );
    expect(blocks(e).find((node) => node.text === 'Третья')?.kind).toBe('p');
  });

  it('разные якоря сохраняют положение, отсутствующий якорь вставляет в конец', () => {
    const e = editor();
    e.update(() => {
      $importMarkdown('A\nB\nC');
      $restoreLost([
        { text: 'a1', kind: 'p', after: 'A' },
        { text: 'a2', kind: 'p', after: 'A' },
        { text: 'b1', kind: 'p', after: 'B' },
        { text: 'b2', kind: 'p', after: 'B' },
        { text: 'tail1', kind: 'p', after: 'gone' },
        { text: 'tail2', kind: 'p', after: 'gone' },
      ]);
    }, { discrete: true });
    expect(blocks(e).map((node) => node.text)).toEqual([
      'A', 'a1', 'a2', 'B', 'b1', 'b2', 'C', 'tail1', 'tail2',
    ]);
  });

  it('запасной Markdown вставляется после существующих блоков с сохранением оформления', () => {
    const e = editor();
    e.update(() => {
      $importMarkdown('Принятый текст\n- первый');
      $appendRecovered('# Свой вариант\n**важно**');
    }, { discrete: true });
    expect(blocks(e).map((node) => node.text)).toEqual([
      'Принятый текст', 'первый', 'Свой вариант', 'важно',
    ]);
    const markdown = e.getEditorState().read($exportMarkdown);
    expect(markdown).toContain('# Свой вариант');
    expect(markdown).toContain('**важно**');
  });
});
