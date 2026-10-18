/**
 * Летящая точка: всё сохранённое долетает до своего раздела. Точка взлетает дугой
 * (лёгкая по горизонтали, тяжелее по вертикали), у цели гаснет, а сама цель коротко «вздрагивает».
 */
import { MASS } from '@qubite/motion';
import type { ColorName } from './tokens';
import { loop } from './useSpring';

export function flyDot(
  from: { x: number; y: number },
  target: Element | null,
  color: ColorName,
  done?: () => void,
): void {
  const L = loop();
  if (!target || L.reduced || typeof document === 'undefined') {
    done?.();
    return;
  }
  const r = target.getBoundingClientRect();
  const tx = r.left + r.width / 2;
  const ty = r.top + r.height / 2;
  const el = document.createElement('i');
  el.className = 'q-fly';
  el.setAttribute('aria-hidden', 'true');
  el.style.background = `var(--q-${color})`;
  document.body.appendChild(el);
  const draw = L.render(() => {
    el.style.transform = `translate(${x.x.toFixed(1)}px, ${y.x.toFixed(1)}px) scale(${Math.max(0, sc.x).toFixed(3)})`;
  });
  const x = L.spring(from.x, 0.9, draw);
  const y = L.spring(from.y, MASS.sheet, draw);
  const sc = L.spring(1.4, MASS.dot, draw);
  draw();
  L.kick(y, -520);
  L.to(x, tx);
  L.to(y, ty);
  L.to(sc, 1);
  setTimeout(() => {
    L.to(sc, 0);
    const t = target as HTMLElement;
    const p = L.spring(1.3, 0.5, () => {
      if (t.style) t.style.scale = p.x.toFixed(3);
    });
    L.to(p, 1);
    setTimeout(() => {
      el.remove();
      if (t.style) t.style.scale = '';
      done?.();
    }, 260);
  }, 520);
}
