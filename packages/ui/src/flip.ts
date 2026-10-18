import { useLayoutEffect, useRef, type RefObject } from 'react';
import { loop } from './useSpring';

/**
 * Соседи подтягиваются (FLIP): когда в списке что-то появилось, пропало или переехало,
 * остальные строки не прыгают, а доезжают пружиной на новое место.
 * Строки помечаются атрибутом data-flip="ключ"; key — что угодно, что меняется вместе со списком.
 */
export function useFlip(box: RefObject<HTMLElement | null>, key: unknown): void {
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const L = loop();
    const next = new Map<string, number>();
    el.querySelectorAll<HTMLElement>('[data-flip]').forEach((row) => {
      const id = row.dataset.flip ?? '';
      const top = row.offsetTop;
      next.set(id, top);
      const was = tops.current.get(id);
      if (was === undefined || L.reduced) return;
      const dy = was - top;
      if (Math.abs(dy) < 1) return;
      const s = L.spring(dy, 0.9, () => {
        row.style.translate = Math.abs(s.x) < 0.01 ? '' : `0 ${s.x.toFixed(2)}px`;
      });
      s.emit();
      L.to(s, 0);
    });
    tops.current = next;
  }, [box, key]);
}
