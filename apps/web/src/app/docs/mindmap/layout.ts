/** Авто-раскладка (D-1005): центр в (0, 0), ветки первого уровня справа и слева. */
import type { BranchColor, MindNode, Side } from './model';

export interface Size {
  w: number;
  h: number;
}

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  side: Side | null;
  depth: number;
}

export interface Edge {
  from: string;
  to: string;
  tone: BranchColor;
  /** Толщина: от центра 3 px, дальше 2 px. */
  width: number;
  d: string;
}

export interface Layout {
  boxes: Map<string, Box>;
  edges: Edge[];
  bounds: { x: number; y: number; w: number; h: number };
}

export interface LayoutOptions {
  /** Между уровнями: 40 на ПК, 24 на узком экране. */
  gap?: number;
  /** Между соседями глубже первого уровня. */
  siblingGap?: number;
  /** Между ветками первого уровня. */
  branchGap?: number;
}

const visible = (node: MindNode) => (node.folded ? [] : node.children);

/** Стороны веток: закреплённые — как есть, остальные — на более лёгкую сторону по порядку. */
export function assignSides(tree: MindNode, weight: (node: MindNode) => number): Map<string, Side> {
  const sides = new Map<string, Side>();
  const load = { l: 0, r: 0 };
  for (const child of tree.children) {
    if (!child.side) continue;
    sides.set(child.id, child.side);
    load[child.side] += weight(child);
  }
  for (const child of tree.children) {
    if (child.side) continue;
    const side: Side = load.r <= load.l ? 'r' : 'l';
    sides.set(child.id, side);
    load[side] += weight(child);
  }
  return sides;
}

export function layoutTree(
  tree: MindNode,
  size: (node: MindNode) => Size,
  options: LayoutOptions = {},
): Layout {
  const gap = options.gap ?? 40;
  const siblingGap = options.siblingGap ?? 8;
  const branchGap = options.branchGap ?? 32;
  const sizes = new Map<string, Size>();
  const heights = new Map<string, number>();
  const measure = (node: MindNode): Size => {
    const value = sizes.get(node.id) ?? size(node);
    sizes.set(node.id, value);
    return value;
  };
  const height = (node: MindNode): number => {
    const own = measure(node).h;
    const kids = visible(node);
    const spacing = node.depth === 0 ? branchGap : siblingGap;
    const sum = kids.length
      ? kids.reduce((total, kid) => total + height(kid), 0) + spacing * (kids.length - 1)
      : 0;
    const value = Math.max(own, sum);
    heights.set(node.id, value);
    return value;
  };
  const boxes = new Map<string, Box>();
  const edges: Edge[] = [];
  const edge = (from: Box, to: Box, tone: BranchColor) => {
    const right = to.side === 'r';
    const x0 = right ? from.x + from.w : from.x;
    const y0 = from.y + from.h / 2;
    const x1 = right ? to.x : to.x + to.w;
    const y1 = to.y + to.h / 2;
    const mx = (x0 + x1) / 2;
    const f = (value: number) => Math.round(value * 10) / 10;
    edges.push({
      from: from.id,
      to: to.id,
      tone,
      width: from.depth === 0 ? 3 : 2,
      d: `M ${f(x0)} ${f(y0)} C ${f(mx)} ${f(y0)} ${f(mx)} ${f(y1)} ${f(x1)} ${f(y1)}`,
    });
  };
  const place = (node: MindNode, x: number, cy: number, side: Side, parent: Box) => {
    const { w, h } = measure(node);
    const box: Box = {
      id: node.id,
      x: Math.round(side === 'r' ? x : x - w),
      y: Math.round(cy - h / 2),
      w,
      h,
      side,
      depth: node.depth,
    };
    boxes.set(node.id, box);
    edge(parent, box, node.tone);
    stack(visible(node), side === 'r' ? box.x + w + gap : box.x - gap, cy, side, box, siblingGap);
  };
  const stack = (
    kids: readonly MindNode[],
    x: number,
    cy: number,
    side: Side,
    parent: Box,
    spacing: number,
  ) => {
    if (!kids.length) return;
    const total =
      kids.reduce((sum, kid) => sum + heights.get(kid.id)!, 0) + spacing * (kids.length - 1);
    let y = cy - total / 2;
    for (const kid of kids) {
      const h = heights.get(kid.id)!;
      place(kid, x, y + h / 2, side, parent);
      y += h + spacing;
    }
  };

  const rootSize = measure(tree);
  const root: Box = {
    id: tree.id,
    x: Math.round(-rootSize.w / 2),
    y: Math.round(-rootSize.h / 2),
    w: rootSize.w,
    h: rootSize.h,
    side: null,
    depth: 0,
  };
  boxes.set(tree.id, root);
  const kids = visible(tree);
  kids.forEach(height);
  const sides = assignSides(tree, (node) => heights.get(node.id) ?? 0);
  for (const side of ['r', 'l'] as const) {
    const list = kids.filter((kid) => sides.get(kid.id) === side);
    stack(list, side === 'r' ? root.x + root.w + gap : root.x - gap, 0, side, root, branchGap);
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes.values()) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  return { boxes, edges, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

/** Соседи для стрелок: ближайший по направлению узел, чей центр в нужной полуплоскости. */
export function neighbour(
  layout: Layout,
  from: string,
  direction: 'left' | 'right' | 'up' | 'down',
): string | null {
  const start = layout.boxes.get(from);
  if (!start) return null;
  const cx = start.x + start.w / 2;
  const cy = start.y + start.h / 2;
  let best: string | null = null;
  let score = Infinity;
  for (const box of layout.boxes.values()) {
    if (box.id === from) continue;
    const dx = box.x + box.w / 2 - cx;
    const dy = box.y + box.h / 2 - cy;
    const along =
      direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
    const across = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 0) continue;
    // Поперечное смещение дороже: стрелка вправо идёт к ребёнку, а не к соседу ниже.
    const value = along + across * 3;
    if (value < score) {
      score = value;
      best = box.id;
    }
  }
  return best;
}
