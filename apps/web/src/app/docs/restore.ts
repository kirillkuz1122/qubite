import type { LostBlock } from '@qubite/sync-client';
import { $createTextNode, $getRoot } from 'lexical';
import {
  $createBlockNode,
  $isBlockNode,
  BLOCK_KINDS,
  type BlockKind,
  type BlockNode,
} from './BlockNode';

/** Блоки с одним якорем вставляем цепочкой, сохраняя их исходный порядок. */
export function $restoreLost(lost: readonly LostBlock[]): void {
  const root = $getRoot();
  const anchors = root.getChildren().filter($isBlockNode);
  const restored = new Map<string | null, BlockNode>();
  for (const item of lost) {
    const kind = (BLOCK_KINDS as readonly string[]).includes(item.kind)
      ? (item.kind as BlockKind)
      : 'p';
    const block = $createBlockNode(kind).append($createTextNode(item.text));
    const anchor =
      restored.get(item.after) ??
      (item.after === null
        ? null
        : anchors.findLast((node) => node.getTextContent() === item.after));
    const first = root.getFirstChild();
    if (anchor) anchor.insertAfter(block);
    else if (item.after === null && first) first.insertBefore(block);
    else root.append(block);
    restored.set(item.after, block);
  }
}
