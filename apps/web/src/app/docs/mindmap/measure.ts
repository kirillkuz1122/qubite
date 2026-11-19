/**
 * Размер узла без замера DOM: Fira Code моноширинный (знак — 0,6 em), поэтому ширина и перенос
 * строк считаются заранее, а CSS получает ту же ширину. Числа совпадают с mindmap.css.
 */
import type { MindNode } from './model';
import type { Size } from './layout';

/** Ширина знака Fira Code: 1200 / 1950 em. Экран уточняет её замером (`probeAdvance`). */
export const ADVANCE = 1200 / 1950;
/** Ширина текста, после которой строка переносится. */
export const MAX_TEXT = 240;

interface Style {
  font: number;
  line: number;
  padX: number;
  padY: number;
  border: number;
}

const STYLES: Style[] = [
  { font: 16, line: 21.6, padX: 20, padY: 12, border: 2 },
  { font: 14, line: 19.6, padX: 12, padY: 8, border: 1 },
  { font: 14, line: 19.6, padX: 10, padY: 6, border: 0 },
];

export const styleOf = (depth: number): Style => STYLES[Math.min(depth, 2)]!;

/**
 * Строки текста при переносе по словам (длинное слово рвётся) — как CSS `overflow-wrap: anywhere`.
 * Длина и разрыв — по Unicode-символам: эмодзи на границе не режется на половинки суррогатной
 * пары (в SVG и PNG они стали бы «�»).
 */
export function wrapText(text: string, perLine: number): string[] {
  if (perLine < 1) return [text];
  const size = (value: string) => [...value].length;
  const lines: string[] = [];
  let line = '';
  // Как `white-space: pre-wrap`: пробелы и табы остаются как есть, строка рвётся перед словом,
  // а пробелы на краю строки «висят» и перенос не вызывают.
  for (const token of text.match(/\s+|\S+/g) ?? []) {
    if (/^\s/.test(token) || size(line + token) <= perLine) {
      line += token;
      continue;
    }
    if (line) lines.push(line);
    let rest = [...token];
    while (rest.length > perLine) {
      lines.push(rest.slice(0, perLine).join(''));
      rest = rest.slice(perLine);
    }
    line = rest.join('');
  }
  lines.push(line);
  return lines;
}

export function wrapLines(text: string, perLine: number): number {
  return wrapText(text, perLine).length;
}

export interface NodeSize extends Size {
  /** Ширина текста — CSS ставит её подписи, чтобы перенос совпал с расчётом. */
  text: number;
}

/** label — что видно в узле (текст, подпись ссылки или подсказка пустого узла). */
export function measureNode(
  node: MindNode,
  label: string,
  foldCount = 0,
  advance = ADVANCE,
): NodeSize {
  const style = styleOf(node.depth);
  const font = node.link ? 13 : style.font;
  const char = font * advance;
  const shown = node.link ? `@ ${label}` : label;
  const perLine = Math.floor(MAX_TEXT / char);
  const chars = Math.max(1, [...shown].length);
  const lines = wrapLines(shown || ' ', perLine);
  const text = Math.ceil(Math.min(chars, perLine) * char);
  const lineHeight = node.link ? 18.85 : style.line;
  // Ссылка — чип с рамкой: внутри 2 × 8 px.
  let w = text + (node.link ? 18 : 0);
  let h = Math.ceil(lines * lineHeight + (node.link ? 6 : 0));
  if (node.depth === 1) w += 16; // точка 8 и зазор 8
  if (foldCount > 0) {
    w += 8 + Math.ceil((1 + String(foldCount).length) * 12 * advance) + 14;
    h = Math.max(h, 20);
  }
  return {
    w: Math.ceil(w + 2 * style.padX + 2 * style.border),
    h: Math.ceil(h + 2 * style.padY + 2 * style.border),
    text,
  };
}

/** Число узлов под свёрнутой веткой — для счётчика «+N». */
export function descendants(node: MindNode): number {
  return node.children.reduce((sum, child) => sum + 1 + descendants(child), 0);
}

/** Настоящая ширина знака шрифта узла (в em); без вёрстки (тесты) — расчётная. */
export function probeAdvance(host: HTMLElement): number {
  const probe = document.createElement('span');
  probe.className = 'mm-probe';
  probe.textContent = 'M'.repeat(100);
  host.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width > 0 ? width / 100 / 100 : ADVANCE;
}
