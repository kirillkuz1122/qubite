import {
  $createNodeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isElementNode,
  $setSelection,
  createEditor,
  SKIP_COLLAB_TAG,
} from 'lexical';
import { createYjsBinding, syncLexicalUpdateToYjs } from '@lexical/yjs';
import type { DocLink } from '@qubite/sync-client';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { $createBlockNode } from './BlockNode';
import { $createMentionNode, $isMentionNode } from './MentionNode';
import { $backspaceMention, $mentionQuery, mentionQuery } from './mention-menu';
import { DOC_NODES, $exportMarkdown, $extractLinks, $importMarkdown } from './markdown';
import { DocsProvider } from './provider';
import { extractDocLinks, renderDocText } from './render';

const target = '11111111-1111-4111-8111-111111111111';
const link: DocLink = { id: target, type: 'planner.task', title: 'План [на завтра]', deleted: false };
const editor = () => createEditor({ nodes: DOC_NODES, onError: (error) => { throw error; } });

describe('MentionNode', () => {
  it('атомарный inline-узел хранит UUID и kind, без названия', () => {
    const e = editor();
    e.update(() => {
      const mention = $createMentionNode(target, 'planner.task');
      $getRoot().append($createBlockNode().append(mention));
      expect(mention.isInline()).toBe(true);
      expect(mention.getTextContent()).toBe('@');
      expect(mention.exportJSON()).toMatchObject({
        type: 'qubite-mention', target, kind: 'planner.task',
      });
      expect(mention.exportJSON()).not.toHaveProperty('title');
      expect($extractLinks()).toEqual([target]);
    }, { discrete: true });
    const copy = editor();
    copy.setEditorState(copy.parseEditorState(JSON.stringify(e.getEditorState().toJSON())));
    expect(copy.getEditorState().read($extractLinks)).toEqual([target]);
  });

  it('Markdown qubite:// туда и обратно, подпись берётся только из кэша', () => {
    const a = editor();
    a.update(() => {
      $getRoot().append($createBlockNode().append(
        $createTextNode('Смотри '), $createMentionNode(target, 'planner.task'),
      ));
    }, { discrete: true });
    const markdown = a.getEditorState().read(() => $exportMarkdown([link]));
    expect(markdown).toBe(`Смотри [@План \\[на завтра\\]](qubite://${target})`);
    const b = editor();
    b.update(() => $importMarkdown(markdown, false, [link]), { discrete: true });
    expect(b.getEditorState().read($extractLinks)).toEqual([target]);
    expect(b.getEditorState().read(() => $exportMarkdown([link]))).toBe(markdown);
    expect(b.getEditorState().read(() => $exportMarkdown())).toBe(`Смотри [@](qubite://${target})`);
    expect(JSON.stringify(b.getEditorState().toJSON())).not.toContain(link.title);
    b.getEditorState().read(() => {
      const node = $getRoot().getFirstChildOrThrow();
      expect(node.getTextContent()).toBe('Смотри @');
    });
  });

  it('в коде Markdown-упоминание остаётся буквальным', () => {
    const e = editor();
    e.update(() => $importMarkdown(`\`\`\`\n[@Имя](qubite://${target})\n\`\`\``), { discrete: true });
    expect(e.getEditorState().read($extractLinks)).toEqual([]);
  });

  it('первый Backspace выделяет, второй удаляет чип целиком', () => {
    const e = editor();
    e.update(() => {
      const mention = $createMentionNode(target, 'docs.page');
      const after = $createTextNode(' после');
      $getRoot().append($createBlockNode().append($createTextNode('До '), mention, after));
      after.select(0, 0);
      expect($backspaceMention()).toBe(true);
      const selection = $getSelection();
      expect($isNodeSelection(selection) && selection.has(mention.getKey())).toBe(true);
      expect($extractLinks()).toEqual([target]);
      expect($backspaceMention()).toBe(true);
      expect($extractLinks()).toEqual([]);
      expect($getRoot().getTextContent()).toBe('До  после');
    }, { discrete: true });
  });

  it('Backspace работает также сразу после чипа в конце блока', () => {
    const e = editor();
    e.update(() => {
      const block = $createBlockNode().append($createMentionNode(target, 'docs.page'));
      $getRoot().append(block);
      block.selectEnd();
      expect($backspaceMention()).toBe(true);
      expect($backspaceMention()).toBe(true);
      expect($extractLinks()).toEqual([]);
      const selected = $createNodeSelection();
      selected.add(block.getKey());
      $setSelection(selected);
      expect($backspaceMention()).toBe(false);
    }, { discrete: true });
  });

  it('настоящий Yjs хранит узел без названия; фоновый экспорт видит ссылки', () => {
    const doc = new Y.Doc();
    const e = editor();
    const provider = new DocsProvider(doc);
    const binding = createYjsBinding({ editor: e, id: 'mention', doc, docMap: new Map([['mention', doc]]) });
    const stop = e.registerUpdateListener((update) => {
      if (!update.tags.has(SKIP_COLLAB_TAG)) syncLexicalUpdateToYjs(
        binding, provider.asProvider(), update.prevEditorState, update.editorState,
        update.dirtyElements, update.dirtyLeaves, update.normalizedNodes, update.tags,
      );
    });
    try {
      e.update(() => {
        $getRoot().append($createBlockNode().append(
          $createMentionNode(target, 'planner.task'), $createTextNode(' и '),
          $createMentionNode(target, 'planner.task'),
        ));
      }, { discrete: true });
      expect(extractDocLinks(doc)).toEqual([target]);
      expect(renderDocText(doc, [link])).toContain(`qubite://${target}`);
      expect(renderDocText(doc, [link])).toContain('@План');
      expect(new TextDecoder().decode(Y.encodeStateAsUpdate(doc))).not.toContain(link.title);
      e.update(() => {
        const block = $getRoot().getFirstChildOrThrow();
        if ($isElementNode(block)) {
          block.getChildren().filter($isMentionNode).forEach((node) => node.remove());
        }
      }, { discrete: true });
      expect(extractDocLinks(doc)).toEqual([]);
    } finally {
      stop();
      binding.root.destroy(binding);
      provider.doc.destroy();
      doc.destroy();
    }
  });
});

describe('триггер меню @', () => {
  it.each(['@', ' @', 'текст @', 'строка\n@', ' @Графы'])(
    'открывается в %j', (text) => expect(mentionQuery(text)).not.toBeNull(),
  );
  it.each(['a@b', 'слово@', '\t@', '(@', '@один два', '@@'])(
    'не открывается в %j', (text) => expect(mentionQuery(text)).toBeNull(),
  );
  it('проверяет границу через несколько текстовых узлов', () => {
    const e = editor();
    e.update(() => {
      const before = $createTextNode('почта');
      const after = $createTextNode('@домен').toggleFormat('bold');
      const block = $createBlockNode().append(before, after);
      $getRoot().append(block);
      after.selectEnd();
      expect($mentionQuery()).toBeNull();
      before.setTextContent('Смотри ');
      expect($mentionQuery()?.query).toBe('домен');
      block.setKind('code');
      expect($mentionQuery()).toBeNull();
    }, { discrete: true });
  });
});
