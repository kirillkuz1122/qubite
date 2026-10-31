import type { LostBlock } from '@qubite/sync-client';
import { $createTextNode, $getRoot } from 'lexical';
import {
  $createBlockNode,
  $isBlockNode,
  BLOCK_KINDS,
  type BlockKind,
  type BlockNode,
} from './BlockNode';
import { $importMarkdown } from './markdown';

/** Следующий блок с тем же якорем идёт после предыдущего возвращённого. */
export function $restoreLost(lost: readonly LostBlock[]): void {
  const root = $getRoot();
  const original = root.getChildren().filter($isBlockNode);
  const restored = new Map<string | null, BlockNode>();
  for (const item of lost) {
    const kind = (BLOCK_KINDS as readonly string[]).includes(item.kind)
      ? (item.kind as BlockKind)
      : 'p';
    const block = $createBlockNode(kind).append($createTextNode(item.text));
    const anchor =
      restored.get(item.after) ??
      (item.after === null
        ? undefined
        : original.findLast((node) => node.getTextContent() === item.after));
    const first = root.getFirstChild();
    if (anchor) anchor.insertAfter(block);
    else if (item.after === null && first) first.insertBefore(block);
    else root.append(block);
    restored.set(item.after, block);
  }
}

export function $appendRecovered(markdown: string): void {
  const root = $getRoot();
  const original = new Set(root.getChildren());
  $importMarkdown(markdown, true);
  const added = root.getChildren().filter((node) => !original.has(node));
  root.append(...added);
}
