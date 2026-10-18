import { MASS } from '@qubite/motion';
import { useRef } from 'react';
import { loop, useSpring } from './useSpring';

/**
 * Нажатие: элемент сжимается под пальцем и пружинит обратно.
 * Пишет свойство scale — оно не мешает transform, которым элемент может двигаться.
 * Использование: <button {...usePress()} />.
 */
export function usePress<T extends HTMLElement = HTMLButtonElement>(depth = 0.86) {
  const ref = useRef<T | null>(null);
  const s = useSpring(1, MASS.dot, (x) => {
    if (ref.current) ref.current.style.scale = x === 1 ? '' : x.toFixed(4);
  });
  const L = loop();
  return {
    ref,
    onPointerDown: () => void L.to(s, depth),
    onPointerUp: () => {
      L.to(s, 1);
      L.kick(s, 1.2);
    },
    onPointerLeave: () => {
      if (s.goal !== 1) L.to(s, 1);
    },
  };
}
