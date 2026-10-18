/** Текст → клетки: надпись набирается пиксельным шрифтом Tiny5 и читается по клеткам 8×12. */
export type Cell = [number, number];
export interface TextCells {
  cells: Cell[];
  cols: number;
  rows: number;
}

export const PIXEL_FONT = 'Qubite Tiny5';

let raster: CanvasRenderingContext2D | null | undefined;
function ctx(): CanvasRenderingContext2D | null {
  if (raster === undefined) {
    raster =
      typeof document === 'undefined'
        ? null
        : document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  }
  return raster;
}

export function textCells(text: string, font = PIXEL_FONT, lineRows = 7): TextCells {
  const r = ctx();
  if (!r) return { cells: [], cols: 0, rows: 0 };
  const P = 4;
  const out: Cell[] = [];
  let cols = 0;
  let minR = Infinity;
  text.split('\n').forEach((line, li) => {
    r.font = `${8 * P}px '${font}'`;
    const w = Math.ceil(r.measureText(line).width / P) + 2;
    r.canvas.width = w * P;
    r.canvas.height = 12 * P;
    r.font = `${8 * P}px '${font}'`;
    r.fillStyle = '#000';
    r.textBaseline = 'alphabetic';
    r.fillText(line, 0, 9 * P);
    const d = r.getImageData(0, 0, w * P, 12 * P).data;
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < w; x++) {
        const a = d[((y * P + 2) * w * P + x * P + 2) * 4 + 3] ?? 0;
        if (a > 140) {
          const row = y + li * lineRows;
          out.push([x, row]);
          cols = Math.max(cols, x + 1);
          minR = Math.min(minR, row);
        }
      }
    }
  });
  out.forEach((c) => (c[1] -= minR));
  return { cells: out, cols, rows: text.split('\n').length * lineRows - 2 };
}
