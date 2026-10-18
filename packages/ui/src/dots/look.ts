/**
 * Форма точки — общая для всех холстов и для CSS (--q-round):
 * round 1 — круг, 0 — квадрат, между ними — квадрат со скруглёнными углами; size — множитель размера.
 */
export const dotLook = { round: 0.5, size: 0.95 };

const TAU = Math.PI * 2;

/** Добавить в текущий путь одну точку (или «овальную» точку rx×ry для моргания). */
export function blob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry = rx,
): void {
  const k = dotLook.round;
  if (k >= 0.995) {
    ctx.moveTo(x + rx, y);
    if (rx === ry) ctx.arc(x, y, rx, 0, TAU);
    else ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
    return;
  }
  const c = Math.min(rx, ry) * k;
  ctx.moveTo(x - rx + c, y - ry);
  ctx.arcTo(x + rx, y - ry, x + rx, y + ry, c);
  ctx.arcTo(x + rx, y + ry, x - rx, y + ry, c);
  ctx.arcTo(x - rx, y + ry, x - rx, y - ry, c);
  ctx.arcTo(x - rx, y - ry, x + rx, y - ry, c);
  ctx.closePath();
}
