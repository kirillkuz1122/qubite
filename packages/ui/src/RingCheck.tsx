import { loop } from '@qubite/motion';
import { useEffect, useRef } from 'react';
import { useSpring } from './useSpring';

export interface RingCheckProps {
  done: boolean;
  onToggle: (done: boolean) => void;
  label: string;
}

/** Галочка «Частиц»: кольцо из 12 точек стягивается в одну зелёную, когда дело сделано. */
export function RingCheck({ done, onToggle, label }: RingCheckProps) {
  const parts = useRef<(HTMLElement | null)[]>([]);
  const s = useSpring(done ? 0 : 1, 0.55, (x) => {
    const r = Math.max(0, x) * 10;
    const sc = 1 + (1 - Math.min(1, Math.max(0, x))) * 2.6;
    parts.current.forEach((p, j) => {
      if (p)
        p.style.transform = `rotate(${j * 30}deg) translateY(${(-r).toFixed(2)}px) scale(${sc.toFixed(3)})`;
    });
  });
  useEffect(() => {
    loop().to(s, done ? 0 : 1);
  }, [done, s]);
  useEffect(() => s.emit(), [s]);
  return (
    <button
      type="button"
      className={done ? 'q-ring q-done' : 'q-ring'}
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      onClick={() => onToggle(!done)}
    >
      {Array.from({ length: 12 }, (_, j) => (
        <i key={j} ref={(el) => void (parts.current[j] = el)} />
      ))}
    </button>
  );
}
