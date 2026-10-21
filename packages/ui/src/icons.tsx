import { MASS } from '@qubite/motion';
import { useLayoutEffect, useRef } from 'react';
import { loop, useSpring } from './useSpring';

/** Значки из точек: 8–10 точек на 20×20, цвет — currentColor. */
const ICONS = {
  home: [
    [10, 3, 1.5],
    [6.5, 6.5, 1.4],
    [13.5, 6.5, 1.4],
    [3.5, 10, 1.4],
    [16.5, 10, 1.4],
    [5.5, 13.5, 1.4],
    [14.5, 13.5, 1.4],
    [5.5, 17, 1.4],
    [14.5, 17, 1.4],
    [10, 15.5, 2],
  ],
  today: [
    [10, 10, 2.4],
    [10, 3, 1.4],
    [15, 5, 1.4],
    [17, 10, 1.4],
    [15, 15, 1.4],
    [10, 17, 1.4],
    [5, 15, 1.4],
    [3, 10, 1.4],
    [5, 5, 1.4],
  ],
  inbox: [
    [10, 4, 1.7],
    [3, 8, 1.4],
    [3, 12, 1.4],
    [3, 16, 1.4],
    [7, 16, 1.4],
    [10, 13, 1.4],
    [13, 16, 1.4],
    [17, 16, 1.4],
    [17, 12, 1.4],
    [17, 8, 1.4],
  ],
  planner: [
    [4, 4, 1.5],
    [10, 4, 1.5],
    [16, 4, 1.5],
    [4, 10, 1.5],
    [10, 10, 2.2],
    [16, 10, 1.5],
    [4, 16, 1.5],
    [10, 16, 1.5],
    [16, 16, 1.5],
  ],
  /* ветка, как в git: лента действий агента */
  agent: [
    [6, 3, 1.4],
    [6, 8, 1.4],
    [6, 13, 1.4],
    [6, 18, 1.4],
    [10, 5.5, 1.1],
    [14, 4, 1.4],
    [14, 10, 2.2],
    [10, 14.5, 1.1],
  ],
  docs: [
    [4, 4, 1.4],
    [8, 4, 1.4],
    [12, 4, 1.4],
    [16, 4, 1.4],
    [4, 9, 1.4],
    [8, 9, 1.4],
    [12, 9, 1.4],
    [4, 14, 1.4],
    [8, 14, 1.4],
    [4, 18, 1.1],
  ],
  settings: [
    [3, 5, 1.2],
    [7, 5, 1.2],
    [13, 5, 2.3],
    [17, 5, 1.2],
    [3, 15, 1.2],
    [7, 15, 2.3],
    [12, 15, 1.2],
    [17, 15, 1.2],
  ],
  search: [
    [8.5, 3.5, 1.5],
    [12.4, 5.1, 1.5],
    [14, 9, 1.5],
    [12.4, 12.9, 1.5],
    [8.5, 14.5, 1.5],
    [4.6, 12.9, 1.5],
    [3, 9, 1.5],
    [4.6, 5.1, 1.5],
    [16.6, 16.6, 1.7],
  ],
  plus: [
    [10, 3, 1.8],
    [10, 6.5, 1.8],
    [10, 10, 1.8],
    [10, 13.5, 1.8],
    [10, 17, 1.8],
    [3, 10, 1.8],
    [6.5, 10, 1.8],
    [13.5, 10, 1.8],
    [17, 10, 1.8],
  ],
  send: [
    [4, 10, 1.7],
    [8, 10, 1.7],
    [12, 10, 1.7],
    [16, 10, 1.7],
    [12, 6, 1.7],
    [12, 14, 1.7],
    [8.5, 3, 1.4],
    [8.5, 17, 1.4],
  ],
  mic: [
    [5, 10, 1.5],
    [8.3, 7, 1.5],
    [8.3, 13, 1.5],
    [11.6, 4, 1.5],
    [11.6, 10, 1.5],
    [11.6, 16, 1.5],
    [15, 8, 1.5],
    [15, 12, 1.5],
  ],
  back: [
    [4, 10, 1.7],
    [8, 6, 1.5],
    [8, 14, 1.5],
    [12, 10, 1.4],
    [16, 10, 1.4],
  ],
  /** глаз открыт: контур миндалём и зрачок — «показать пароль» */
  eye: [
    [1.2, 10, 1],
    [4.6, 7.4, 1],
    [10, 6.2, 1],
    [15.4, 7.4, 1],
    [18.8, 10, 1],
    [15.4, 12.6, 1],
    [10, 13.8, 1],
    [4.6, 12.6, 1],
    [10, 10, 2.5],
  ],
  /** глаз закрыт: веко дугой и ресницы — «спрятать пароль» */
  'eye-off': [
    [1.2, 8.6, 1],
    [5, 11.2, 1],
    [10, 12.3, 1],
    [15, 11.2, 1],
    [18.8, 8.6, 1],
    [5.2, 15.2, 0.9],
    [10, 16.4, 0.9],
    [14.8, 15.2, 0.9],
  ],
  /** колокольчик: купол из точек, язычок снизу — уведомления (D-421) */
  bell: [
    [10, 2.2, 1.2],
    [7, 4.8, 1.25],
    [13, 4.8, 1.25],
    [5.6, 8.2, 1.25],
    [14.4, 8.2, 1.25],
    [5, 11.6, 1.25],
    [15, 11.6, 1.25],
    [3.2, 14.6, 1.25],
    [6.6, 14.6, 1.25],
    [10, 14.6, 1.25],
    [13.4, 14.6, 1.25],
    [16.8, 14.6, 1.25],
    [10, 17.9, 1.5],
  ],
} as const;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

type Pt = readonly [number, number, number];

/** Точка значка, которой нет в новом виде, сжимается в центр (r = 0). */
const at = (pts: readonly Pt[], i: number): Pt => pts[i] ?? [10, 10, 0];

/**
 * Значок из точек. Сменился `name` — те же точки перетекают в новый вид пружиной
 * (глаз пароля открывается и закрывается, D-430). В покое — обычные точки без трансформаций;
 * пока перетекают, кадр меняет только координаты точек маленького SVG.
 */
export function DotIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const from = useRef<readonly Pt[]>(ICONS[name]);
  const to = useRef<readonly Pt[]>(ICONS[name]);
  const paint = (k: number) => {
    const dots = svg.current?.children;
    if (!dots) return;
    const a = from.current;
    const b = to.current;
    for (let i = 0; i < dots.length; i++) {
      const p = at(a, i);
      const q = at(b, i);
      const x = p[0] + (q[0] - p[0]) * k;
      const y = p[1] + (q[1] - p[1]) * k;
      const r = Math.max(0, p[2] + (q[2] - p[2]) * k);
      const d = dots[i] as SVGCircleElement;
      d.setAttribute('cx', x.toFixed(2));
      d.setAttribute('cy', y.toFixed(2));
      d.setAttribute('r', r.toFixed(3));
    }
  };
  const s = useSpring(1, MASS.dot, paint);
  const prev = useRef(name);
  useLayoutEffect(() => {
    if (prev.current === name) return;
    // перетекание начинается с того места, где точки сейчас
    const k = Math.min(1, Math.max(0, s.x));
    const a = from.current;
    const b = to.current;
    const n = Math.max(a.length, b.length);
    from.current = Array.from({ length: n }, (_, i) => {
      const p = at(a, i);
      const q = at(b, i);
      return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
    });
    to.current = ICONS[name];
    prev.current = name;
    const L = loop();
    L.set(s, 0);
    paint(0); // до первой отрисовки — иначе мелькнёт новый вид
    L.to(s, 1);
  });
  const n = Math.max(from.current.length, to.current.length);
  return (
    <svg
      ref={svg}
      className="q-ico"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      data-icon={name}
    >
      {Array.from({ length: n }, (_, i) => {
        const [x, y, r] = at(to.current, i);
        return <circle key={i} cx={x} cy={y} r={r} />;
      })}
    </svg>
  );
}
