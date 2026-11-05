import {
  createYjsBinding,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
} from '@lexical/yjs';
import { createEditor } from 'lexical';
import * as Y from 'yjs';
import type { DocLink } from '@qubite/sync-client';
import { DOC_NODES, $exportMarkdown, $extractLinks, $importMarkdown } from './markdown';
import { DocsProvider } from './provider';

/** Markdown слитого дерева без экрана. Исходный документ остаётся неизменным. */
export function renderDocText(source: Y.Doc, links: readonly DocLink[] = []): string {
  return readDoc(source, () => $exportMarkdown(links));
}

export function extractDocLinks(source: Y.Doc): string[] {
  return readDoc(source, $extractLinks);
}

function readDoc<T>(source: Y.Doc, read: () => T): T {
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
    id: 'render',
    doc,
    docMap: new Map([['render', doc]]),
  });
  const root = binding.root.getSharedType();
  const changes: Parameters<typeof root.observeDeep>[0] = (events) => {
    syncYjsChangesToLexical(binding, provider.asProvider(), events, false, () => {});
  };
  root.observeDeep(changes);
  try {
    // Как при подключении редактора: сначала привязка к пустой копии, затем данные.
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(source));
    editor.update(() => {}, { discrete: true });
    return editor.getEditorState().read(read);
  } finally {
    root.unobserveDeep(changes);
    binding.root.destroy(binding);
    provider.doc.destroy();
    doc.destroy();
  }
}

/** Самостоятельное локальное обновление для нового документа, без редактора на экране. */
export function markdownToYUpdate(markdown: string, links: readonly DocLink[] = []): Uint8Array {
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
    id: 'import',
    doc,
    docMap: new Map([['import', doc]]),
  });
  const stop = editor.registerUpdateListener((update) => {
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
    editor.update(() => $importMarkdown(markdown, false, links), { discrete: true });
    return Y.encodeStateAsUpdate(doc);
  } finally {
    stop();
    binding.root.destroy(binding);
    provider.doc.destroy();
    doc.destroy();
  }
}
