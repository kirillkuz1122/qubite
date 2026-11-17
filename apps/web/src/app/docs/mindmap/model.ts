/**
 * Mind map в том же Y.Doc, что документ (D-1001): вид — `meta.kind`, узлы — `Y.Map('mindmap')`.
 * Координат нет: раскладку считает экран (D-1005), поэтому разные устройства видят одну структуру.
 */
import * as Y from 'yjs';
import type { DocLinkKind } from '@qubite/sync-client';

export const MINDMAP_KIND = 'mindmap';
export const ROOT = 'root';
export const BRANCH_COLORS = ['sky', 'green', 'orange', 'yellow', 'peach'] as const;
export type BranchColor = (typeof BRANCH_COLORS)[number];
export type Side = 'l' | 'r';
/** Длина подписи узла: карта — короткие мысли, длинный текст — в обычном документе. */
export const MAX_NODE_TEXT = 300;
/** С запасом под лимит обновления Yjs на сервере (512 КиБ, D-751). */
export const MAX_NODES = 2000;

export interface MindLink {
  target: string;
  kind: DocLinkKind;
}

export interface MindNode {
  id: string;
  text: string;
  parent: string | null;
  order: number;
  /** Свой цвет узла; у ветки без своего — цвет предка или авто по номеру ветки. */
  color?: BranchColor;
  side?: Side;
  folded: boolean;
  link?: MindLink;
  depth: number;
  /** Цвет, которым рисуется узел и линия к нему. */
  tone: BranchColor;
  children: MindNode[];
}

type NodeMap = Y.Map<unknown>;

const meta = (doc: Y.Doc) => doc.getMap<unknown>('meta');
const nodes = (doc: Y.Doc) => doc.getMap<NodeMap>('mindmap');

export function isMindmap(doc: Y.Doc): boolean {
  return meta(doc).get('kind') === MINDMAP_KIND;
}

const isColor = (value: unknown): value is BranchColor =>
  (BRANCH_COLORS as readonly string[]).includes(value as string);

function newId(): string {
  return globalThis.crypto.randomUUID();
}

function clip(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').slice(0, MAX_NODE_TEXT);
}

function makeNode(fields: {
  text: string;
  parent: string | null;
  order: number;
  color?: BranchColor | undefined;
  side?: Side | undefined;
  link?: MindLink | undefined;
}): NodeMap {
  const node = new Y.Map<unknown>();
  const text = new Y.Text();
  text.insert(0, clip(fields.text));
  node.set('text', text);
  node.set('parent', fields.parent);
  node.set('order', fields.order);
  if (fields.color) node.set('color', fields.color);
  if (fields.side) node.set('side', fields.side);
  if (fields.link) node.set('link', { target: fields.link.target, kind: fields.link.kind });
  return node;
}

/** Делает документ картой с центром. Повторный вызов на карте ничего не меняет. */
export function initMindmap(doc: Y.Doc, rootText: string, origin?: unknown): void {
  doc.transact(() => {
    meta(doc).set('kind', MINDMAP_KIND);
    if (!nodes(doc).has(ROOT)) nodes(doc).set(ROOT, makeNode({ text: rootText, parent: null, order: 0 }));
  }, origin);
}

interface Raw {
  id: string;
  text: string;
  parent: string | null;
  order: number;
  color?: BranchColor;
  side?: Side;
  folded: boolean;
  link?: MindLink;
}

function readRaw(id: string, node: NodeMap): Raw {
  const text = node.get('text');
  const parent = node.get('parent');
  const order = node.get('order');
  const color = node.get('color');
  const side = node.get('side');
  const link = node.get('link') as Partial<MindLink> | undefined;
  return {
    id,
    text: text instanceof Y.Text ? text.toString() : typeof text === 'string' ? text : '',
    parent: id === ROOT ? null : typeof parent === 'string' ? parent : ROOT,
    order: typeof order === 'number' && Number.isFinite(order) ? order : 0,
    ...(isColor(color) ? { color } : {}),
    ...(side === 'l' || side === 'r' ? { side } : {}),
    folded: node.get('folded') === true,
    ...(link && typeof link.target === 'string' && typeof link.kind === 'string'
      ? { link: { target: link.target, kind: link.kind as DocLinkKind } }
      : {}),
  };
}

const byOrder = (a: { order: number; id: string }, b: { order: number; id: string }) =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Дерево из Yjs. Узел без живого родителя или в цикле (одновременный перенос A в B и B в A)
 * цепляется к центру: правка с другого устройства не пропадает молча (D-1001).
 */
export function readTree(doc: Y.Doc): MindNode {
  const raw = new Map<string, Raw>();
  nodes(doc).forEach((node, id) => {
    if (node instanceof Y.Map) raw.set(id, readRaw(id, node));
  });
  if (!raw.has(ROOT)) raw.set(ROOT, { id: ROOT, text: '', parent: null, order: 0, folded: false });
  const parentOf = (item: Raw): string => {
    if (item.id === ROOT) return '';
    const seen = new Set<string>([item.id]);
    let at = item.parent ?? ROOT;
    for (;;) {
      if (at === ROOT) return item.parent ?? ROOT;
      const next = raw.get(at);
      if (!next || seen.has(at)) return ROOT;
      seen.add(at);
      at = next.parent ?? ROOT;
    }
  };
  const children = new Map<string, Raw[]>();
  for (const item of raw.values()) {
    if (item.id === ROOT) continue;
    const parent = parentOf(item);
    const list = children.get(parent) ?? [];
    list.push(item);
    children.set(parent, list);
  }
  const build = (item: Raw, depth: number, tone: BranchColor, index: number): MindNode => {
    const own =
      depth === 1 ? (item.color ?? BRANCH_COLORS[index % BRANCH_COLORS.length]!) : (item.color ?? tone);
    const kids = (children.get(item.id) ?? []).sort(byOrder);
    return {
      ...item,
      parent: depth === 0 ? null : item.parent,
      depth,
      tone: depth === 0 ? 'orange' : own,
      children: kids.map((kid, i) => build(kid, depth + 1, own, i)),
    };
  };
  return build(raw.get(ROOT)!, 0, 'orange', 0);
}

export function findNode(tree: MindNode, id: string): MindNode | null {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export function parentNode(tree: MindNode, id: string): MindNode | null {
  for (const child of tree.children) {
    if (child.id === id) return tree;
    const found = parentNode(child, id);
    if (found) return found;
  }
  return null;
}

export function countNodes(tree: MindNode): number {
  return 1 + tree.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function node(doc: Y.Doc, id: string): NodeMap {
  const value = nodes(doc).get(id);
  if (!(value instanceof Y.Map)) throw new Error('узла нет');
  return value;
}

/** Порядок между соседями: середина, в конец — +1, в начало — −1. */
function orderAt(siblings: readonly MindNode[], index: number): number {
  const before = siblings[index - 1];
  const after = siblings[index];
  if (before && after) return (before.order + after.order) / 2;
  if (before) return before.order + 1;
  if (after) return after.order - 1;
  return 0;
}

function ensureRoom(doc: Y.Doc): void {
  if (nodes(doc).size >= MAX_NODES) throw new Error('В карте уже 2000 узлов. Разделите её.');
}

export function addChild(doc: Y.Doc, parentId: string, text = '', origin?: unknown): string {
  ensureRoom(doc);
  const tree = readTree(doc);
  const parent = findNode(tree, parentId);
  if (!parent) throw new Error('узла нет');
  const id = newId();
  doc.transact(() => {
    nodes(doc).set(
      id,
      makeNode({ text, parent: parent.id, order: orderAt(parent.children, parent.children.length) }),
    );
    if (parent.folded) node(doc, parent.id).delete('folded');
  }, origin);
  return id;
}

/** Соседний узел сразу после данного; у центра соседей нет — получается дочерний. */
export function addSibling(doc: Y.Doc, id: string, text = '', origin?: unknown): string {
  const tree = readTree(doc);
  const parent = parentNode(tree, id);
  if (!parent) return addChild(doc, ROOT, text, origin);
  ensureRoom(doc);
  const index = parent.children.findIndex((child) => child.id === id);
  const self = parent.children[index]!;
  const next = newId();
  doc.transact(() => {
    nodes(doc).set(
      next,
      makeNode({
        text,
        parent: parent.id,
        order: orderAt(parent.children, index + 1),
        // Соседняя ветка первого уровня встаёт на ту же сторону.
        side: parent.id === ROOT ? self.side : undefined,
      }),
    );
  }, origin);
  return next;
}

/** Меняет только отличающуюся середину: одновременная правка того же узла сливается по буквам. */
export function setText(doc: Y.Doc, id: string, value: string, origin?: unknown): void {
  const text = node(doc, id).get('text');
  if (!(text instanceof Y.Text)) return;
  const next = clip(value);
  const old = text.toString();
  if (old === next) return;
  let start = 0;
  while (start < old.length && start < next.length && old[start] === next[start]) start++;
  let end = 0;
  while (
    end < old.length - start &&
    end < next.length - start &&
    old[old.length - 1 - end] === next[next.length - 1 - end]
  )
    end++;
  doc.transact(() => {
    text.delete(start, old.length - start - end);
    text.insert(start, next.slice(start, next.length - end));
  }, origin);
}

function isInside(tree: MindNode, ancestor: string, id: string): boolean {
  const top = findNode(tree, ancestor);
  return !!top && !!findNode(top, id);
}

/**
 * Переносит узел к новому родителю на место `index` (по умолчанию — в конец).
 * В своё же поддерево перенести нельзя. `side` — для ветки первого уровня.
 */
export function moveNode(
  doc: Y.Doc,
  id: string,
  parentId: string,
  index?: number,
  side?: Side,
  origin?: unknown,
): boolean {
  if (id === ROOT) return false;
  const tree = readTree(doc);
  if (isInside(tree, id, parentId)) return false;
  const parent = findNode(tree, parentId);
  if (!parent) return false;
  const siblings = parent.children.filter((child) => child.id !== id);
  const at = Math.max(0, Math.min(index ?? siblings.length, siblings.length));
  doc.transact(() => {
    const target = node(doc, id);
    target.set('parent', parent.id);
    target.set('order', orderAt(siblings, at));
    if (parent.id === ROOT && side) target.set('side', side);
    else if (parent.id !== ROOT) target.delete('side');
    if (parent.folded) node(doc, parent.id).delete('folded');
  }, origin);
  return true;
}

/** Удаляет узел вместе с веткой. Центр не удаляется. */
export function removeNode(doc: Y.Doc, id: string, origin?: unknown): void {
  if (id === ROOT) return;
  const target = findNode(readTree(doc), id);
  if (!target) return;
  const ids: string[] = [];
  const walk = (item: MindNode) => {
    ids.push(item.id);
    item.children.forEach(walk);
  };
  walk(target);
  doc.transact(() => ids.forEach((value) => nodes(doc).delete(value)), origin);
}

export function setColor(doc: Y.Doc, id: string, color: BranchColor, origin?: unknown): void {
  if (id === ROOT) return;
  doc.transact(() => node(doc, id).set('color', color), origin);
}

export function setFolded(doc: Y.Doc, id: string, folded: boolean, origin?: unknown): void {
  doc.transact(() => {
    if (folded) node(doc, id).set('folded', true);
    else node(doc, id).delete('folded');
  }, origin);
}

export function setLink(doc: Y.Doc, id: string, link: MindLink | null, origin?: unknown): void {
  doc.transact(() => {
    if (link) node(doc, id).set('link', { target: link.target, kind: link.kind });
    else node(doc, id).delete('link');
  }, origin);
}

/** Узел-ссылка без своего текста: подпись берётся из кэша названий документа. */
export function addLinkChild(doc: Y.Doc, parentId: string, link: MindLink, origin?: unknown): string {
  const id = addChild(doc, parentId, '', origin);
  setLink(doc, id, link, origin);
  return id;
}

export interface Outline {
  text: string;
  link?: MindLink;
  color?: BranchColor;
  side?: Side;
  children: Outline[];
}

/** Пишет готовое дерево под узел (импорт списка, шаблон, предложения AI). */
export function appendOutline(
  doc: Y.Doc,
  parentId: string,
  items: readonly Outline[],
  origin?: unknown,
): string[] {
  const tree = readTree(doc);
  const parent = findNode(tree, parentId);
  if (!parent) throw new Error('узла нет');
  const total = items.reduce(function count(sum, item): number {
    return sum + 1 + item.children.reduce(count, 0);
  }, 0);
  if (nodes(doc).size + total > MAX_NODES) throw new Error('В карте будет больше 2000 узлов. Разделите её.');
  const created: string[] = [];
  doc.transact(() => {
    const write = (item: Outline, parent: string, order: number) => {
      const id = newId();
      nodes(doc).set(
        id,
        makeNode({
          text: item.text,
          parent,
          order,
          color: item.color,
          side: parent === ROOT ? item.side : undefined,
          link: item.link,
        }),
      );
      created.push(id);
      item.children.forEach((child, i) => write(child, id, i));
    };
    const start = orderAt(parent.children, parent.children.length);
    items.forEach((item, i) => write(item, parent.id, start + i));
    if (parent.folded) node(doc, parent.id).delete('folded');
  }, origin);
  return created;
}

/** Самостоятельное обновление Yjs новой карты (создание без экрана, как импорт .md). */
export function mindmapUpdate(rootText: string, branches: readonly Outline[] = []): Uint8Array {
  const doc = new Y.Doc();
  try {
    initMindmap(doc, rootText);
    if (branches.length) appendOutline(doc, ROOT, branches);
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/** Все цели ссылок карты — для `links` документа (DOC-003). */
export function mindmapLinks(doc: Y.Doc): string[] {
  const targets = new Set<string>();
  const walk = (item: MindNode) => {
    if (item.link) targets.add(item.link.target);
    item.children.forEach(walk);
  };
  walk(readTree(doc));
  return [...targets];
}
