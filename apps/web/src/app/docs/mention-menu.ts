import {
  $createNodeSelection,
  $createRangeSelection,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type LexicalNode,
} from 'lexical';
import { $isBlockNode } from './BlockNode';
import { $isMentionNode } from './MentionNode';

export interface MentionQuery {
  id: string;
  query: string;
  startKey: string;
  startOffset: number;
  endKey: string;
  endOffset: number;
}

/** Только начало строки/обычный пробел: адрес a@b и код не вызывают меню. */
export function mentionQuery(text: string): { query: string; start: number } | null {
  const match = /(?:^|[ \n])@([^\s@]*)$/.exec(text);
  return match ? { query: match[1]!, start: text.length - match[1]!.length - 1 } : null;
}

export function $mentionQuery(): MentionQuery | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const anchor = selection.anchor.getNode();
  if (!$isTextNode(anchor)) return null;
  const block = anchor.getTopLevelElement();
  if (!$isBlockNode(block) || block.getKind() === 'code') return null;
  const leaves: LexicalNode[] = [];
  const visit = (node: LexicalNode) => {
    if ($isElementNode(node)) node.getChildren().forEach(visit);
    else leaves.push(node);
  };
  visit(block);
  const before: { key: string; text: string }[] = [];
  for (const node of leaves) {
    const text = $isTextNode(node)
      ? node.getTextContent()
      : $isLineBreakNode(node)
        ? '\n'
        : '\ufffc';
    before.push({
      key: node.getKey(),
      text: node === anchor ? text.slice(0, selection.anchor.offset) : text,
    });
    if (node === anchor) break;
  }
  const match = mentionQuery(before.map((part) => part.text).join(''));
  if (!match) return null;
  let start = match.start;
  for (const part of before) {
    if (start < part.text.length) {
      return {
        id: `${part.key}:${start}`,
        query: match.query,
        startKey: part.key,
        startOffset: start,
        endKey: anchor.getKey(),
        endOffset: selection.anchor.offset,
      };
    }
    start -= part.text.length;
  }
  return null;
}

export function $selectMentionQuery(query: MentionQuery): void {
  const selection = $createRangeSelection();
  selection.anchor.set(query.startKey, query.startOffset, 'text');
  selection.focus.set(query.endKey, query.endOffset, 'text');
  $setSelection(selection);
}

/** Возвращает true только для первого/второго Backspace у атомарного чипа. */
export function $backspaceMention(): boolean {
  const selection = $getSelection();
  if ($isNodeSelection(selection)) {
    const nodes = selection.getNodes();
    if (nodes.length !== 1 || !$isMentionNode(nodes[0])) return false;
    const node = nodes[0];
    node.selectPrevious();
    node.remove();
    return true;
  }
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const point = selection.anchor;
  const anchor = point.getNode();
  const previous =
    $isTextNode(anchor) && point.offset === 0
      ? anchor.getPreviousSibling()
      : $isElementNode(anchor) && point.type === 'element' && point.offset > 0
        ? anchor.getChildAtIndex(point.offset - 1)
        : null;
  if (!$isMentionNode(previous)) return false;
  const selected = $createNodeSelection();
  selected.add(previous.getKey());
  $setSelection(selected);
  return true;
}
