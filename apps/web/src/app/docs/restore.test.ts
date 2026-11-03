import { createYjsBinding, syncLexicalUpdateToYjs } from '@lexical/yjs';
import { watchLostEdits, type DocLinkKind, type LostBlock } from '@qubite/sync-client';
import { $createTextNode, $getRoot, createEditor, SKIP_COLLAB_TAG } from 'lexical';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { $createBlockNode, $isBlockNode } from './BlockNode';
import { $createMentionNode, $isMentionNode } from './MentionNode';
import { DOC_NODES, $extractLinks } from './markdown';
import { DocsProvider } from './provider';
import { $restoreLost } from './restore';

const target = '11111111-1111-4111-8111-111111111111';
const kinds: DocLinkKind[] = ['docs.page', 'planner.task', 'projects.project', 'calendar.event'];

function editor() {
  return createEditor({
    nodes: DOC_NODES,
    onError: (error) => {
      throw error;
    },
  });
}

describe('возврат потерянных упоминаний', () => {
  it.each(kinds)('восстанавливает настоящий MentionNode вида %s без текста', (kind) => {
    const e = editor();
    e.update(
      () =>
        $restoreLost([
          {
            text: '',
            kind: 'quote',
            after: null,
            content: [{ type: 'mention', target, kind }],
          },
        ]),
      { discrete: true },
    );
    e.getEditorState().read(() => {
      const block = $getRoot().getFirstChildOrThrow();
      expect($isBlockNode(block) && block.getKind()).toBe('quote');
      if (!$isBlockNode(block)) throw new Error('Нет блока');
      expect(block.getChildrenSize()).toBe(1);
      const mention = block.getFirstChildOrThrow();
      expect($isMentionNode(mention)).toBe(true);
      if (!$isMentionNode(mention)) throw new Error('Нет упоминания');
      expect(mention.getTarget()).toBe(target);
      expect(mention.getKind()).toBe(kind);
      expect($extractLinks()).toEqual([target]);
    });
  });

  it('сохраняет порядок текста и чипов рядом со старыми записями IndexedDB', () => {
    const e = editor();
    e.update(
      () => {
        const before = $createBlockNode().append(
          $createTextNode('Перед '),
          $createMentionNode(target, 'docs.page'),
        );
        $getRoot().append(before, $createBlockNode().append($createTextNode('После')));
        $restoreLost([
          {
            text: 'до  после',
            kind: 'p',
            after: 'Перед @',
            content: [
              { type: 'text', text: 'до ' },
              { type: 'mention', target, kind: 'planner.task' },
              { type: 'text', text: ' после' },
            ],
          },
          { text: 'Старая запись', kind: 'quote', after: 'Перед @' },
        ]);
      },
      { discrete: true },
    );
    e.getEditorState().read(() => {
      const blocks = $getRoot().getChildren().filter($isBlockNode);
      expect(blocks.map((block) => block.getTextContent())).toEqual([
        'Перед @',
        'до @ после',
        'Старая запись',
        'После',
      ]);
      expect(blocks[1]!.getChildren().map((node) => node.getType())).toEqual([
        'text',
        'qubite-mention',
        'text',
      ]);
      const mention = blocks[1]!.getChildAtIndex(1);
      expect($isMentionNode(mention) && mention.getKind()).toBe('planner.task');
    });
  });

  it.each([false, true])(
    'настоящая привязка Lexical + Yjs обнаруживает и возвращает чип, с текстом=%s',
    (withText) => {
      const doc = new Y.Doc();
      const remote = new Y.Doc();
      const e = editor();
      const provider = new DocsProvider(doc);
      const binding = createYjsBinding({
        editor: e,
        id: 'lost-mention',
        doc,
        docMap: new Map([['lost-mention', doc]]),
      });
      const stop = e.registerUpdateListener((update) => {
        if (update.tags.has(SKIP_COLLAB_TAG)) return;
        syncLexicalUpdateToYjs(
          binding,
          provider.asProvider(),
          update.prevEditorState,
          update.editorState,
          update.dirtyElements,
          update.dirtyLeaves,
          update.normalizedNodes,
          update.tags,
        );
      });
      const origin = Symbol('server');
      const found: LostBlock[][] = [];
      let stopLost = () => {};
      try {
        e.update(
          () => $getRoot().append($createBlockNode().append($createTextNode('Основа'))),
          { discrete: true },
        );
        Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
        stopLost = watchLostEdits(doc, origin, (lost) => found.push(lost));
        e.update(
          () => {
            const block = $getRoot().getFirstChildOrThrow();
            if (!$isBlockNode(block)) throw new Error('Нет блока');
            if (withText) block.append($createTextNode(' до '));
            block.append($createMentionNode(target, 'calendar.event'));
            if (withText) block.append($createTextNode(' после'));
          },
          { discrete: true },
        );
        remote.get('root', Y.XmlText).delete(0, 1);
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), origin);
        expect(found).toEqual([
          [
            {
              text: withText ? ' до  после' : '',
              kind: 'p',
              after: null,
              content: [
                ...(withText ? [{ type: 'text', text: ' до ' }] : []),
                { type: 'mention', target, kind: 'calendar.event' },
                ...(withText ? [{ type: 'text', text: ' после' }] : []),
              ],
            },
          ],
        ]);
        const restored = editor();
        restored.update(() => $restoreLost(found[0]!), { discrete: true });
        restored.getEditorState().read(() => {
          const block = $getRoot().getFirstChildOrThrow();
          if (!$isBlockNode(block)) throw new Error('Нет блока');
          const chips = block.getChildren().filter($isMentionNode);
          expect(chips.map((chip) => [chip.getTarget(), chip.getKind()])).toEqual([
            [target, 'calendar.event'],
          ]);
          expect(block.getTextContent()).toBe(withText ? ' до @ после' : '@');
        });
      } finally {
        stopLost();
        stop();
        binding.root.destroy(binding);
        provider.doc.destroy();
        doc.destroy();
        remote.destroy();
      }
    },
  );
});
