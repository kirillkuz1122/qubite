import { MASS } from '@qubite/motion';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { loop, useSpring } from './useSpring';

export interface SwapProps<T extends string> {
  /** что сейчас открыто (вкладка, вид) */
  view: T;
  /** порядок вкладок: новое въезжает с той стороны, где стоит его вкладка */
  order: readonly T[];
  className?: string;
  children: ReactNode;
}

/**
 * Смена вкладки без рывка (DS-008, D-432): новое содержимое въезжает с той стороны,
 * где его вкладка, и проявляется пружиной. Двигаются только opacity и transform.
 */
export function Swap<T extends string>({ view, order, className, children }: SwapProps<T>) {
  const el = useRef<HTMLDivElement>(null);
  const paint = (v: number) => {
    const d = el.current;
    if (!d) return;
    d.style.opacity = v === 0 ? '' : Math.min(1, Math.max(0, 1 - Math.abs(v))).toFixed(3);
    d.style.transform = v === 0 ? '' : `translateX(${(v * 26).toFixed(2)}px)`;
  };
  const s = useSpring(0, MASS.pill, paint);
  const prev = useRef(view);
  useLayoutEffect(() => {
    if (prev.current === view) return;
    const dir = order.indexOf(view) > order.indexOf(prev.current) ? 1 : -1;
    prev.current = view;
    const L = loop();
    L.set(s, dir);
    paint(dir); // до первой отрисовки нового содержимого
    L.to(s, 0);
  });
  return (
    <div ref={el} className={className} data-view={view}>
      {children}
    </div>
  );
}
