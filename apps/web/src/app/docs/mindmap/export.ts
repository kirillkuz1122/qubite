/**
 * Экспорт карты в SVG и PNG (D-1007): та же раскладка и размеры, что на экране, цвета —
 * токены текущей темы. Один список фигур рисуется в SVG-строку или на <canvas>.
 */
import type { DocLink } from '@qubite/sync-client';
import { layoutTree } from './layout';
import { ADVANCE, descendants, MAX_TEXT, measureNode, styleOf, wrapText } from './measure';
import { BRANCH_COLORS, type BranchColor, type MindNode } from './model';
import { nodeLabel } from './text';

type Shape =
  | {
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      r: number;
      fill?: string;
      stroke?: string;
      width?: number;
    }
  | { kind: 'path'; d: string; stroke: string; width: number }
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      size: number;
      weight: number;
      fill: string;
    };

export interface Palette {
  bg: string;
  panel: string;
  ink: string;
  dim: string;
  line2: string;
  orange: string;
  skyInk: string;
  tones: Record<BranchColor, { line: string; ink: string }>;
}

export interface Drawing {
  w: number;
  h: number;
  dx: number;
  dy: number;
  bg: string;
  shapes: Shape[];
}

const FONT = "'Qubite Fira', 'Fira Code', ui-monospace, monospace";

/** Значения токенов темы: custom property читается через цвет пробного элемента. */
export function readPalette(host: HTMLElement = document.body): Palette {
  const probe = document.createElement('span');
  host.appendChild(probe);
  const read = (token: string) => {
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color;
  };
  try {
    const ink = read('--q-ink');
    const tone = (color: BranchColor) => ({
      line: read(`--q-${color}`),
      ink: color === 'peach' ? read('--q-mute') : read(`--q-${color}-ink`),
    });
    return {
      bg: read('--q-bg'),
      panel: read('--q-panel'),
      ink,
      dim: read('--q-dim'),
      line2: read('--q-line-2'),
      orange: read('--q-orange'),
      skyInk: read('--q-sky-ink'),
      tones: Object.fromEntries(BRANCH_COLORS.map((c) => [c, tone(c)])) as Palette['tones'],
    };
  } finally {
    probe.remove();
  }
}

export function drawMindmap(
  tree: MindNode,
  links: readonly DocLink[],
  palette: Palette,
  advance = ADVANCE,
): Drawing {
  const label = (node: MindNode) =>
    nodeLabel(node, links) || (node.depth === 0 ? 'Центральная тема' : '');
  const fold = (node: MindNode) => (node.folded ? descendants(node) : 0);
  const layout = layoutTree(tree, (node) => measureNode(node, label(node), fold(node), advance));
  const byId = new Map<string, MindNode>();
  const walk = (node: MindNode) => {
    byId.set(node.id, node);
    node.children.forEach(walk);
  };
  walk(tree);
  const shapes: Shape[] = [];
  for (const edge of layout.edges)
    shapes.push({
      kind: 'path',
      d: edge.d,
      stroke: palette.tones[edge.tone].line,
      width: edge.width,
    });
  for (const box of layout.boxes.values()) {
    const node = byId.get(box.id)!;
    const style = styleOf(node.depth);
    const tone = palette.tones[node.tone];
    if (node.depth === 0)
      shapes.push({
        kind: 'rect',
        ...box,
        r: 12,
        fill: palette.panel,
        stroke: palette.orange,
        width: 2,
      });
    else if (node.depth === 1)
      shapes.push({
        kind: 'rect',
        ...box,
        r: 10,
        fill: palette.panel,
        stroke: palette.line2,
        width: 1,
      });
    else shapes.push({ kind: 'rect', ...box, r: 8, fill: palette.bg });
    let x = box.x + style.border + style.padX;
    const top = box.y + style.border + style.padY;
    const text = label(node);
    const size = node.link ? 13 : style.font;
    const line = node.link ? 18.85 : style.line;
    const lines = wrapText(node.link ? `@ ${text}` : text, Math.floor(MAX_TEXT / (size * advance)));
    const height = lines.length * line + (node.link ? 6 : 0);
    const inner = box.h - 2 * style.border - 2 * style.padY;
    const y0 = top + (inner - height) / 2;
    if (node.depth === 1) {
      shapes.push({ kind: 'rect', x, y: box.y + box.h / 2 - 4, w: 8, h: 8, r: 2, fill: tone.line });
      x += 16;
    }
    if (node.link) {
      const w =
        Math.ceil(
          Math.min(text.length + 2, Math.floor(MAX_TEXT / (size * advance))) * size * advance,
        ) + 18;
      shapes.push({ kind: 'rect', x, y: y0, w, h: height, r: 4, stroke: palette.line2, width: 1 });
    }
    lines.forEach((value, i) =>
      shapes.push({
        kind: 'text',
        x: x + (node.link ? 9 : 0),
        y: y0 + (node.link ? 3 : 0) + i * line + (line - size) / 2 + size * 0.8,
        text: value,
        size,
        weight: node.depth === 0 ? 600 : node.depth === 1 ? 500 : 400,
        fill: text || node.depth > 0 ? palette.ink : palette.dim,
      }),
    );
    const folded = fold(node);
    if (folded) {
      const w = Math.ceil((1 + String(folded).length) * 12 * advance) + 14;
      const fx = box.x + box.w - style.border - style.padX - w;
      shapes.push({
        kind: 'rect',
        x: fx,
        y: box.y + box.h / 2 - 10,
        w,
        h: 20,
        r: 4,
        stroke: tone.line,
        width: 1,
      });
      shapes.push({
        kind: 'text',
        x: fx + 7,
        y: box.y + box.h / 2 + 4.5,
        text: `+${folded}`,
        size: 12,
        weight: 400,
        fill: tone.ink,
      });
    }
  }
  const pad = 32;
  const b = layout.bounds;
  return {
    w: Math.ceil(b.w + 2 * pad),
    h: Math.ceil(b.h + 2 * pad),
    dx: pad - b.x,
    dy: pad - b.y,
    bg: palette.bg,
    shapes,
  };
}

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function toSvg(drawing: Drawing): string {
  const parts = drawing.shapes.map((shape) => {
    if (shape.kind === 'path')
      return `<path d="${shape.d}" fill="none" stroke="${shape.stroke}" stroke-width="${shape.width}" stroke-linecap="round"/>`;
    if (shape.kind === 'rect') {
      const inset = shape.width ? shape.width / 2 : 0;
      return `<rect x="${shape.x + inset}" y="${shape.y + inset}" width="${shape.w - 2 * inset}" height="${shape.h - 2 * inset}" rx="${shape.r}" fill="${shape.fill ?? 'none'}"${shape.stroke ? ` stroke="${shape.stroke}" stroke-width="${shape.width}"` : ''}/>`;
    }
    return `<text x="${shape.x}" y="${shape.y.toFixed(1)}" font-size="${shape.size}" font-weight="${shape.weight}" fill="${shape.fill}" xml:space="preserve">${escape(shape.text)}</text>`;
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${drawing.w}" height="${drawing.h}" viewBox="0 0 ${drawing.w} ${drawing.h}" font-family="${escape(FONT)}">`,
    `<rect width="100%" height="100%" fill="${drawing.bg}"/>`,
    `<g transform="translate(${drawing.dx} ${drawing.dy})">`,
    ...parts,
    '</g></svg>',
  ].join('\n');
}

/** PNG рисуется шрифтом страницы на <canvas> в 2× — текст совпадает с экраном. */
/** Пределы canvas: сторона 32 767 px (Chromium, Firefox), площадь — 16 777 216 px (Safari на iOS). */
const MAX_SIDE = 32_767;
const MAX_AREA = 16_777_216;
export const PNG_TOO_BIG = 'Карта слишком большая для картинки PNG — скачайте рисунок SVG.';

/** Масштаб PNG: чётче (2×), пока картинка влезает в пределы canvas; иначе мельче. */
export function pngScale(w: number, h: number, wanted = 2): number {
  return Math.min(wanted, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)));
}

export async function toPng(drawing: Drawing, wanted = 2): Promise<Blob> {
  const scale = pngScale(drawing.w, drawing.h, wanted);
  // Мельче четверти подписи уже не прочитать — честно говорим и предлагаем SVG.
  if (scale < 0.25) throw new Error(PNG_TOO_BIG);
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(drawing.w * scale);
  canvas.height = Math.floor(drawing.h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Браузер не умеет рисовать картинку');
  ctx.scale(scale, scale);
  ctx.fillStyle = drawing.bg;
  ctx.fillRect(0, 0, drawing.w, drawing.h);
  ctx.translate(drawing.dx, drawing.dy);
  for (const shape of drawing.shapes) {
    if (shape.kind === 'path') {
      ctx.strokeStyle = shape.stroke;
      ctx.lineWidth = shape.width;
      ctx.lineCap = 'round';
      ctx.stroke(new Path2D(shape.d));
    } else if (shape.kind === 'rect') {
      const inset = shape.width ? shape.width / 2 : 0;
      ctx.beginPath();
      ctx.roundRect(
        shape.x + inset,
        shape.y + inset,
        shape.w - 2 * inset,
        shape.h - 2 * inset,
        shape.r,
      );
      if (shape.fill) {
        ctx.fillStyle = shape.fill;
        ctx.fill();
      }
      if (shape.stroke) {
        ctx.strokeStyle = shape.stroke;
        ctx.lineWidth = shape.width ?? 1;
        ctx.stroke();
      }
    } else {
      ctx.font = `${shape.weight} ${shape.size}px ${FONT}`;
      ctx.fillStyle = shape.fill;
      ctx.fillText(shape.text, shape.x, shape.y);
    }
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(PNG_TOO_BIG))), 'image/png'),
  );
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
