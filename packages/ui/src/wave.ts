/**
 * Смена темы волной: от кнопки расходятся точки нового фона, закрывают экран, тема меняется, слой тает.
 * Двигаем только размер точек на отдельном холсте и его прозрачность.
 */
import { loop } from '@qubite/motion';
import { dotLook } from './dots/look';

export function themeWave(
  color: string,
  origin: { x: number; y: number } | null,
  apply: () => void,
): void {
  if (loop().reduced || typeof document === 'undefined') {
    apply();
    return;
  }
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  if (!ctx) {
    apply();
    return;
  }
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = innerWidth;
  const H = innerHeight;
  c.style.cssText =
    'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:3000;pointer-events:none;transition:opacity .35s';
  c.setAttribute('aria-hidden', 'true');
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  document.body.appendChild(c);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const P = W < 760 ? 14 : 18;
  const ox = origin?.x ?? W / 2;
  const oy = origin?.y ?? 0;
  const far = Math.max(
    Math.hypot(ox, oy),
    Math.hypot(W - ox, oy),
    Math.hypot(ox, H - oy),
    Math.hypot(W - ox, H - oy),
  );
  const t0 = performance.now();
  const dur = 560;
  const spread = 1.3;
  function shape(x: number, y: number, h: number) {
    const cr = h * dotLook.round;
    ctx!.moveTo(x - h + cr, y - h);
    ctx!.arcTo(x + h, y - h, x + h, y + h, cr);
    ctx!.arcTo(x + h, y + h, x - h, y + h, cr);
    ctx!.arcTo(x - h, y + h, x - h, y - h, cr);
    ctx!.arcTo(x - h, y - h, x + h, y - h, cr);
    ctx!.closePath();
  }
  function frame(now: number) {
    const t = (now - t0) / dur;
    let full = true;
    ctx!.clearRect(0, 0, W, H);
    ctx!.fillStyle = color;
    ctx!.beginPath();
    for (let y = P / 2; y < H + P; y += P) {
      for (let x = P / 2; x < W + P; x += P) {
        const k = Math.max(
          0,
          Math.min(1, t * (1 + spread) - (Math.hypot(x - ox, y - oy) / far) * spread),
        );
        if (k < 1) full = false;
        if (k > 0) shape(x, y, P * 0.76 * (1 - Math.pow(1 - k, 3)));
      }
    }
    ctx!.fill();
    if (full) {
      apply();
      requestAnimationFrame(() => {
        c.style.opacity = '0';
        setTimeout(() => c.remove(), 400);
      });
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
