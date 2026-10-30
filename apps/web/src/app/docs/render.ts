import { createYjsBinding, syncYjsChangesToLexical } from '@lexical/yjs';
import { createEditor } from 'lexical';
import * as Y from 'yjs';
import { DOC_NODES, $exportMarkdown } from './markdown';
import { DocsProvider } from './provider';

/** Снимок слитого дерева без React и DOM; исходный документ остаётся неизменным. */
export function renderDocText(source: Y.Doc): string {
  const doc = new Y.Doc();
  const editor = createEditor({
    nodes: DOC_NODES,
    onError: (error) => {
      throw error;
    },
  });
  const provider = new DocsProvider(doc).asProvider();
  const binding = createYjsBinding({
    editor,
    id: 'render',
    doc,
    docMap: new Map([['render', doc]]),
  });
  const root = binding.root.getSharedType();
  const changes: Parameters<typeof root.observeDeep>[0] = (events) => {
    syncYjsChangesToLexical(binding, provider, events, false, () => {});
  };
  root.observeDeep(changes);
  try {
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(source));
    // Применение Yjs планирует Lexical update; закончить его до синхронного экспорта.
    editor.update(() => {}, { discrete: true });
    return editor.getEditorState().read($exportMarkdown);
  } finally {
    root.unobserveDeep(changes);
    binding.root.destroy(binding);
    provider.doc.destroy();
    doc.destroy();
  }
}
