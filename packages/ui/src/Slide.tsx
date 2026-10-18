import { MASS } from '@qubite/motion';
import { useCallback, useRef } from 'react';
import { loop, useSpring } from './useSpring';

export interface SlideHandle {
  /** подложка едет к строке (top, height) и тянется по пути; jump — сразу */
  to(top: number, height: number, jump?: boolean): void;
  /** спрятать (растаять) */
  hide(jump?: boolean): void;
  /** видна ли сейчас */
  isShown(): boolean;
}

/**
 * Выделение строки, которое перетекает: подложка растягивается на пути и собирается на месте.
 * base — высота, под которую нарисована подложка в CSS (её растягиваем через scaleY).
 */
export function useSlide(base: number, className = 'q-slide') {
  const el = useRef<HTMLDivElement>(null);
  const draw = () => {
    const d = el.current;
    if (!d) return;
    d.style.transform = `translateY(${y.x.toFixed(2)}px) scaleY(${(h.x / base).toFixed(4)})`;
    d.style.opacity = Math.min(1, Math.max(0, o.x)).toFixed(3);
  };
  const y = useSpring(0, MASS.row, draw);
  const h = useSpring(base, MASS.row, draw);
  const o = useSpring(0, MASS.dot + 0.05, draw);
  const shown = useRef(false);

  const to = useCallback<SlideHandle['to']>(
    (top, height, jump) => {
      const L = loop();
      if (jump || !shown.current) {
        L.set(y, top);
        L.set(h, height);
      } else {
        L.kick(h, Math.abs(top - y.x) * 3);
        L.to(y, top);
        L.to(h, height);
      }
      if (jump) L.set(o, 1);
      else L.to(o, 1);
      shown.current = true;
    },
    [y, h, o],
  );
  const hide = useCallback(
    (jump?: boolean) => {
      shown.current = false;
      if (jump) loop().set(o, 0);
      else loop().to(o, 0);
    },
    [o],
  );
  const node = <div ref={el} className={className} aria-hidden="true" style={{ height: base }} />;
  const isShown = useCallback(() => shown.current, []);
  return { node, to, hide, isShown };
}
