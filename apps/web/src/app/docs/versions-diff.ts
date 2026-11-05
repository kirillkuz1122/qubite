import * as Y from 'yjs';

export interface VersionBlock {
  kind: string;
  text: string;
  checked?: boolean;
}

export interface WordDiff {
  op: 'equal' | 'add' | 'del';
  text: string;
}

export type BlockDiff =
  | { op: 'equal' | 'added' | 'removed'; block: VersionBlock }
  | { op: 'changed'; oldBlock: VersionBlock; newBlock: VersionBlock; words: WordDiff[] };

/** LCS Хиршберга: память линейная, в том числе для длинных документов. */
const MAX_LCS_CELLS = 4_000_000;

function lcsPairs<T>(
  a: readonly T[],
  b: readonly T[],
  same: (a: T, b: T) => boolean,
  trimEdges = false,
): [number, number][] {
  const pairs: [number, number][] = [];
  function lengths(a0: number, a1: number, b0: number, b1: number, reverse: boolean) {
    const row = new Uint32Array(b1 - b0 + 1);
    for (let i = 0; i < a1 - a0; i++) {
      let diagonal = 0;
      for (let j = 1; j <= b1 - b0; j++) {
        const above = row[j]!;
        row[j] = same(a[reverse ? a1 - 1 - i : a0 + i]!, b[reverse ? b1 - j : b0 + j - 1]!)
          ? diagonal + 1
          : Math.max(above, row[j - 1]!);
        diagonal = above;
      }
    }
    return row;
  }
  function splitAt(a0: number, middle: number, a1: number, b0: number, b1: number): number {
    const left = lengths(a0, middle, b0, b1, false);
    const right = lengths(middle, a1, b0, b1, true);
    let split = 0;
    let best = -1;
    for (let j = 0; j <= b1 - b0; j++) {
      const score = left[j]! + right[b1 - b0 - j]!;
      if (score > best) {
        best = score;
        split = j;
      }
    }
    return b0 + split;
  }
  function visit(a0: number, a1: number, b0: number, b1: number): void {
    if (a0 === a1 || b0 === b1) return;
    if (a1 - a0 === 1) {
      for (let j = b0; j < b1; j++) {
        if (same(a[a0]!, b[j]!)) {
          pairs.push([a0, j]);
          break;
        }
      }
      return;
    }
    const middle = (a0 + a1) >>> 1;
    const split = splitAt(a0, middle, a1, b0, b1);
    visit(a0, middle, b0, split);
    visit(middle, a1, split, b1);
  }
  // Общие края отсекаем сразу: правка одного слова в длинном блоке не должна стоить N·M.
  let start = 0;
  while (trimEdges && start < a.length && start < b.length && same(a[start]!, b[start]!)) {
    pairs.push([start, start]);
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  const tail: [number, number][] = [];
  while (trimEdges && endA > start && endB > start && same(a[endA - 1]!, b[endB - 1]!)) {
    endA--;
    endB--;
    tail.push([endA, endB]);
  }
  // Предел работы: для огромной середины общих мест не ищем, она покажется заменой.
  if ((endA - start) * (endB - start) <= MAX_LCS_CELLS) visit(start, endA, start, endB);
  pairs.push(...tail.reverse());
  return pairs;
}

const tokens = (text: string): string[] =>
  text.match(
    /\s+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/giu,
  ) ?? [];

function diffWords(oldText: string, newText: string): WordDiff[] {
  const oldWords = tokens(oldText);
  const newWords = tokens(newText);
  const result: WordDiff[] = [];
  const append = (op: WordDiff['op'], text: string) => {
    if (!text) return;
    const last = result.at(-1);
    if (last?.op === op) last.text += text;
    else result.push({ op, text });
  };
  let oldIndex = 0;
  let newIndex = 0;
  for (const [oldMatch, newMatch] of lcsPairs(oldWords, newWords, (a, b) => a === b, true)) {
    append('del', oldWords.slice(oldIndex, oldMatch).join(''));
    append('add', newWords.slice(newIndex, newMatch).join(''));
    append('equal', oldWords[oldMatch]!);
    oldIndex = oldMatch + 1;
    newIndex = newMatch + 1;
  }
  append('del', oldWords.slice(oldIndex).join(''));
  append('add', newWords.slice(newIndex).join(''));
  return result;
}

function closeText(a: VersionBlock, b: VersionBlock): boolean {
  if (a.kind !== b.kind) return false;
  if (a.text === b.text) return true;
  const oldWords = tokens(a.text).filter((word) => /[\p{L}\p{N}]/u.test(word));
  const newWords = tokens(b.text).filter((word) => /[\p{L}\p{N}]/u.test(word));
  const shared = lcsPairs(oldWords, newWords, (x, y) => x === y, true).length;
  if (shared > 0 && 2 * shared >= (oldWords.length + newWords.length) / 2) return true;
  // Для опечатки в единственном слове сравнение по словам не найдёт общего.
  if (oldWords.length === 1 && newWords.length === 1) {
    const x = Array.from(a.text);
    const y = Array.from(b.text);
    const common = lcsPairs(x, y, (left, right) => left === right, true).length;
    return 2 * common >= (x.length + y.length) / 2;
  }
  return false;
}

/** Перестановка — удаление + добавление; changed только между соседними якорями LCS. */
export function diffBlocks(
  oldBlocks: readonly VersionBlock[],
  newBlocks: readonly VersionBlock[],
): BlockDiff[] {
  const result: BlockDiff[] = [];
  const changed = (oldBlock: VersionBlock, newBlock: VersionBlock): BlockDiff => ({
    op: 'changed',
    oldBlock,
    newBlock,
    words: diffWords(oldBlock.text, newBlock.text),
  });
  let oldIndex = 0;
  let newIndex = 0;
  const matches = lcsPairs(oldBlocks, newBlocks, (a, b) => a.kind === b.kind && a.text === b.text);
  matches.push([oldBlocks.length, newBlocks.length]);
  for (const [oldMatch, newMatch] of matches) {
    const count = Math.max(oldMatch - oldIndex, newMatch - newIndex);
    for (let i = 0; i < count; i++) {
      const a = oldIndex + i < oldMatch ? oldBlocks[oldIndex + i] : undefined;
      const b = newIndex + i < newMatch ? newBlocks[newIndex + i] : undefined;
      if (a && b && closeText(a, b)) result.push(changed(a, b));
      else {
        if (a) result.push({ op: 'removed', block: a });
        if (b) result.push({ op: 'added', block: b });
      }
    }
    if (oldMatch < oldBlocks.length && newMatch < newBlocks.length) {
      const a = oldBlocks[oldMatch]!;
      const b = newBlocks[newMatch]!;
      result.push(a.checked === b.checked ? { op: 'equal', block: b } : changed(a, b));
    }
    oldIndex = oldMatch + 1;
    newIndex = newMatch + 1;
  }
  return result;
}

function inlineText(node: Y.XmlText | Y.XmlElement): string {
  if (node instanceof Y.XmlElement) {
    if (node.getAttribute('__type') === 'qubite-mention') {
      // UUID отличает чипы; название объекта не является частью версии.
      return `[@](qubite://${String(node.getAttribute('__target') ?? '')})`;
    }
    if (node.getAttribute('__type') === 'linebreak') return '\n';
    return node
      .toArray()
      .map((child) =>
        child instanceof Y.XmlText || child instanceof Y.XmlElement ? inlineText(child) : '',
      )
      .join('');
  }
  return node
    .toDelta()
    .map((part: { insert?: unknown }) => {
      const value: unknown = part.insert;
      if (typeof value === 'string') return value;
      if (value instanceof Y.XmlText || value instanceof Y.XmlElement) return inlineText(value);
      // Y.Map — невидимый маркер TextNode, а не текст «[object Object]».
      return '';
    })
    .join('');
}

/** Только Yjs: не создаёт Lexical/DOM и не меняет исходное дерево. */
export function blocksFromDoc(doc: Y.Doc): VersionBlock[] {
  // get() создал бы пустой корень у совершенно пустой версии.
  if (!doc.share.has('root')) return [];
  const root = doc.get('root', Y.XmlText);
  const blocks: VersionBlock[] = [];
  for (const part of root.toDelta()) {
    const node: unknown = part.insert;
    if (!(node instanceof Y.XmlText) || node.getAttribute('__type') !== 'qubite-block') continue;
    const kind: unknown = node.getAttribute('__kind') ?? node.getAttribute('kind');
    const checked: unknown = node.getAttribute('__checked') ?? node.getAttribute('checked');
    blocks.push({
      kind: typeof kind === 'string' ? kind : 'p',
      text: inlineText(node),
      ...(typeof checked === 'boolean' ? { checked } : {}),
    });
  }
  return blocks;
}
