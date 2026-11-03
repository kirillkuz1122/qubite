// @vitest-environment node
import { createYjsBinding, syncLexicalUpdateToYjs } from '@lexical/yjs';
import { DocStore, httpDocsTransport, restoreDocVersion, type DocLink } from '@qubite/sync-client';
import { IDBFactory } from 'fake-indexeddb';
import { $createTextNode, $getRoot, createEditor, SKIP_COLLAB_TAG } from 'lexical';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { $createBlockNode } from './BlockNode';
import { $createMentionNode } from './MentionNode';
import { DOC_NODES } from './markdown';
import { DocsProvider } from './provider';
import { extractDocLinks, renderDocText } from './render';
import { blocksFromDoc, diffBlocks, type VersionBlock } from './versions-diff';

const paragraph = (text: string): VersionBlock => ({ kind: 'p', text });

describe('сравнение блоков', () => {
  it('пустые документы и неизменившиеся блоки', () => {
    expect(diffBlocks([], [])).toEqual([]);
    const block = paragraph('Без изменений');
    expect(diffBlocks([block], [block])).toEqual([{ op: 'equal', block }]);
    expect(diffBlocks([], [block])).toEqual([{ op: 'added', block }]);
    expect(diffBlocks([block], [])).toEqual([{ op: 'removed', block }]);
  });

  it('добавление и удаление между общими блоками', () => {
    const a = paragraph('Первый');
    const b = paragraph('Второй');
    const c = paragraph('Третий');
    expect(diffBlocks([a, c], [a, b, c])).toEqual([
      { op: 'equal', block: a },
      { op: 'added', block: b },
      { op: 'equal', block: c },
    ]);
    expect(diffBlocks([a, b, c], [a, c])).toEqual([
      { op: 'equal', block: a },
      { op: 'removed', block: b },
      { op: 'equal', block: c },
    ]);
  });

  it('правка слова сохраняет пробелы и пунктуацию', () => {
    const oldBlock = paragraph('Привет, старый мир!');
    const newBlock = paragraph('Привет, новый мир!');
    expect(diffBlocks([oldBlock], [newBlock])).toEqual([
      {
        op: 'changed',
        oldBlock,
        newBlock,
        words: [
          { op: 'equal', text: 'Привет, ' },
          { op: 'del', text: 'старый' },
          { op: 'add', text: 'новый' },
          { op: 'equal', text: ' мир!' },
        ],
      },
    ]);
  });

  it('перестановка и повторы сохраняют LCS', () => {
    const a = paragraph('Альфа');
    const b = paragraph('Бета');
    const moved = diffBlocks([a, b], [b, a]);
    expect(moved.filter((part) => part.op === 'equal')).toHaveLength(1);
    expect(moved.filter((part) => part.op === 'added')).toHaveLength(1);
    expect(moved.filter((part) => part.op === 'removed')).toHaveLength(1);
    expect(moved.filter((part) => part.op === 'changed')).toHaveLength(0);
    const repeated = diffBlocks([a, a, b], [a, b]);
    expect(repeated.map((part) => part.op)).toEqual(['removed', 'equal', 'equal']);
  });

  it('разные виды и несвязанные тексты не склеиваются в changed', () => {
    const kind = diffBlocks([paragraph('Текст')], [{ kind: 'h1', text: 'Текст' }]);
    const text = diffBlocks([paragraph('Луна')], [paragraph('Небо')]);
    expect(kind.map((part) => part.op)).toEqual(['removed', 'added']);
    expect(text.map((part) => part.op)).toEqual(['removed', 'added']);
  });

  it('изменение галочки и опечатка в одном слове видны', () => {
    expect(
      diffBlocks(
        [{ kind: 'todo', text: 'Сделать', checked: false }],
        [{ kind: 'todo', text: 'Сделать', checked: true }],
      )[0]?.op,
    ).toBe('changed');
    expect(diffBlocks([paragraph('кот')], [paragraph('кит')])[0]?.op).toBe('changed');
  });

  it('словесная разница восстанавливает оба исходных текста, включая пробелы', () => {
    const before = paragraph('один  два, три\nчетыре');
    const after = paragraph('один два, новый три\nчетыре!');
    const result = diffBlocks([before], [after]);
    expect(result).toHaveLength(1);
    const part = result[0]!;
    if (part.op !== 'changed') throw new Error('Нет изменённого блока');
    expect(
      part.words
        .filter((word) => word.op !== 'add')
        .map((word) => word.text)
        .join(''),
    ).toBe(before.text);
    expect(
      part.words
        .filter((word) => word.op !== 'del')
        .map((word) => word.text)
        .join(''),
    ).toBe(after.text);
  });
});

/** Настоящее дерево Lexical, включая маркеры текстового форматирования. */
function documentVersion(target: string) {
  const doc = new Y.Doc();
  const editor = createEditor({
    nodes: DOC_NODES,
    onError: (error) => {
      throw error;
    },
  });
  const provider = new DocsProvider(doc);
  const binding = createYjsBinding({
    editor,
    id: 'version',
    doc,
    docMap: new Map([['version', doc]]),
  });
  const stop = editor.registerUpdateListener((update) => {
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
  try {
    editor.update(
      () => {
        $getRoot().append(
          $createBlockNode('h1').append($createTextNode('Заголовок')),
          $createBlockNode('todo')
            .setChecked(true)
            .setIndent(2)
            .append(
              $createTextNode('Готово ').toggleFormat('bold'),
              $createMentionNode(target, 'planner.task'),
              $createTextNode(' после'),
            ),
          $createBlockNode('quote').append($createTextNode('Цитата')),
        );
      },
      { discrete: true },
    );
    return { doc, ystate: Y.encodeStateAsUpdate(doc) };
  } catch (error) {
    doc.destroy();
    throw error;
  } finally {
    stop();
    binding.root.destroy(binding);
    provider.doc.destroy();
  }
}

describe('версии настоящего документа Lexical без DOM', () => {
  const target = '11111111-1111-4111-8111-111111111111';
  const links: DocLink[] = [{ id: target, type: 'planner.task', title: 'Дело', deleted: false }];

  it('читает свойства, пропускает маркеры, отличает UUID чипов, не меняет документ', () => {
    const source = documentVersion(target);
    const other = documentVersion('22222222-2222-4222-8222-222222222222');
    const empty = new Y.Doc();
    try {
      const before = Y.encodeStateAsUpdate(source.doc);
      expect(blocksFromDoc(source.doc)).toEqual([
        { kind: 'h1', text: 'Заголовок', checked: false },
        { kind: 'todo', text: `Готово [@](qubite://${target}) после`, checked: true },
        { kind: 'quote', text: 'Цитата', checked: false },
      ]);
      const decoded = new Y.Doc();
      try {
        Y.applyUpdate(decoded, source.ystate);
        expect(blocksFromDoc(decoded)).toEqual(blocksFromDoc(source.doc));
      } finally {
        decoded.destroy();
      }
      const comparison = diffBlocks(blocksFromDoc(source.doc), blocksFromDoc(other.doc));
      expect(comparison[1]?.op).toBe('changed');
      expect(Y.encodeStateAsUpdate(source.doc)).toEqual(before);
      expect(blocksFromDoc(empty)).toEqual([]);
      expect(empty.share.size).toBe(0);
    } finally {
      source.doc.destroy();
      other.doc.destroy();
      empty.destroy();
    }
  });

  it('копирует форматирование, свойства и упоминания для headless-экспорта', () => {
    const source = documentVersion(target);
    const current = new Y.Doc();
    try {
      current.get('root', Y.XmlText).insert(0, 'Новый текст');
      restoreDocVersion(current, source, null);
      expect(blocksFromDoc(current)).toEqual(blocksFromDoc(source.doc));
      expect(renderDocText(current, links)).toBe(renderDocText(source.doc, links));
      expect(renderDocText(current, links)).toContain('**Готово');
      expect(extractDocLinks(current)).toEqual([target]);
      const block: unknown = current.get('root', Y.XmlText).toDelta()[1]?.insert;
      expect(block instanceof Y.XmlText && block.getAttribute('__indent')).toBe(2);
    } finally {
      source.doc.destroy();
      current.destroy();
    }
  });

  it('restoreVersion отправляет text, snapshot и links из восстановленного дерева', async () => {
    const source = documentVersion(target);
    const remote = new Y.Doc();
    const bodies: Record<string, unknown>[] = [];
    let online = false;
    const store = new DocStore({
      indexedDB: new IDBFactory(),
      dbName: 'lexical-restore',
      debounceMs: 60_000,
      renderText: renderDocText,
      extractLinks: extractDocLinks,
      transport: httpDocsTransport({
        csrf: () => '',
        fetch: async (_url, init) => {
          if (!online) throw new TypeError('нет сети');
          if (init?.method === 'GET') {
            return Response.json({
              update: btoa(String.fromCharCode(...Y.encodeStateAsUpdate(remote))),
              sv: btoa(String.fromCharCode(...Y.encodeStateVector(remote))),
              seed_markdown: null,
            });
          }
          const body = JSON.parse(init!.body as string) as Record<string, unknown>;
          bodies.push(body);
          Y.applyUpdate(
            remote,
            Uint8Array.from(atob(body.update as string), (char) => char.charCodeAt(0)),
          );
          return Response.json({ sv: btoa(String.fromCharCode(...Y.encodeStateVector(remote))) });
        },
      }),
    });
    try {
      const handle = await store.open('page');
      await handle.cacheLinks(links);
      handle.text = () => 'Экран ещё не обновился';
      await handle.restoreVersion({ id: 'version', ystate: source.ystate });
      online = true;
      await handle.sync();
      expect(handle.status).toBe('saved');
      expect(bodies[0]).toMatchObject({
        text: renderDocText(source.doc, links),
        links: [target],
        reason: 'restore',
        restore_of: 'version',
        snapshot: expect.any(String),
      });
      expect(renderDocText(remote, links)).toBe(renderDocText(source.doc, links));
    } finally {
      await store.close();
      source.doc.destroy();
      remote.destroy();
    }
  });
});
