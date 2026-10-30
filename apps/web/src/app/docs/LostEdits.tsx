import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import type { DocHandle, LostBlock } from '@qubite/sync-client';
import { Button, Note } from '@qubite/ui';
import { $createTextNode, $getRoot } from 'lexical';
import { useEffect, useState } from 'react';
import { $createBlockNode, $isBlockNode, BLOCK_KINDS, type BlockKind } from './BlockNode';
import type { DocsProvider } from './provider';

/** «В удалённый блок дописали — вернуть?» (Q-87): вставляет текст новым блоком на прежнее место. */
export function LostEdits({ handle, provider }: { handle: DocHandle; provider: DocsProvider }) {
  const [editor] = useLexicalComposerContext();
  const [lost, setLost] = useState<LostBlock[]>([]);
  useEffect(() => provider.watchLost((found) => setLost((now) => [...now, ...found])), [provider]);
  useEffect(
    () =>
      handle.onStatus((status) => {
        if (status === 'saved') provider.confirm();
      }),
    [handle, provider],
  );
  if (lost.length === 0) return null;

  const restore = () => {
    editor.update(() => {
      const root = $getRoot();
      for (const item of lost) {
        const kind = (BLOCK_KINDS as readonly string[]).includes(item.kind)
          ? (item.kind as BlockKind)
          : 'p';
        const block = $createBlockNode(kind).append($createTextNode(item.text));
        const anchor =
          item.after === null
            ? null
            : root
                .getChildren()
                .filter($isBlockNode)
                .findLast((node) => node.getTextContent() === item.after);
        const first = root.getFirstChild();
        if (anchor) anchor.insertAfter(block);
        else if (item.after === null && first) first.insertBefore(block);
        else root.append(block);
      }
    });
    setLost([]);
  };

  const shown = lost.map((item) => item.text).join(' · ');
  return (
    <div className="docs-lost">
      <Note>
        <p>
          На другом устройстве блок удалили, а здесь в него дописали: «
          {shown.length > 120 ? `${shown.slice(0, 120)}…` : shown}». Вернуть?
        </p>
        <div className="docs-lost-actions">
          <Button size="sm" variant="fill" onClick={restore}>
            Вернуть
          </Button>
          <Button size="sm" onClick={() => setLost([])}>
            Не надо
          </Button>
        </div>
      </Note>
    </div>
  );
}
