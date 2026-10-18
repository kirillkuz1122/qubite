import { MASS } from '@qubite/motion';
import { useRef, type PointerEvent } from 'react';
import { feelOf } from './feel';
import { loop, useSpring } from './useSpring';

/**
 * Нажатие: элемент сжимается под пальцем и пружинит обратно (характер «Кнопка»).
 * Пишет свойство scale — оно не мешает transform, которым элемент может двигаться.
 * Палец «захватывается» с первого касания: элемент сжался, но отпускание у самого края
 * всё равно считается нажатием на него.
 * Использование: <button {...usePress()} />.
 */
export function usePress<T extends HTMLElement = HTMLButtonElement>(depth = 0.86) {
  const ref = useRef<T | null>(null);
  const s = useSpring(1, MASS.dot, (x) => {
    if (ref.current) ref.current.style.scale = x === 1 ? '' : x.toFixed(4);
  });
  const L = loop();
  const back = (bounce: boolean) => {
    L.to(s, 1, feelOf('button'));
    if (bounce) L.kick(s, 1.2);
  };
  return {
    ref,
    onPointerDown: (e?: PointerEvent<T>) => {
      if (e) {
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          /* без захвата тоже работает */
        }
      }
      L.to(s, depth, feelOf('button'));
    },
    onPointerUp: () => back(true),
    onPointerCancel: () => back(false),
    // палец забрал другой жест (например, подсветку капли тащат) — отпускаем
    onLostPointerCapture: () => {
      if (s.goal !== 1) back(false);
    },
  };
}
