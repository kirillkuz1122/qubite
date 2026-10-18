import { loop } from '@qubite/motion';
import { useEffect, useRef } from 'react';
import { feelOf } from './feel';
import { useSpring } from './useSpring';

export interface RingCheckProps {
  done: boolean;
  onToggle: (done: boolean) => void;
  label: string;
}

/**
 * Галочка «Частиц»: кольцо из 12 точек закручивается и стягивается в одну зелёную, а она подпрыгивает.
 * Снял отметку — кольцо разлетается обратно с отскоком. Характер — как у кнопки.
 */
export function RingCheck({ done, onToggle, label }: RingCheckProps) {
  const el = useRef<HTMLButtonElement>(null);
  const parts = useRef<(HTMLElement | null)[]>([]);
  const s = useSpring(done ? 0 : 1, 0.55, (x) => {
    const r = Math.max(0, x) * 10;
    const sc = 1 + (1 - Math.min(1, Math.max(0, x))) * 2.6;
    const twist = (1 - x) * 90;
    parts.current.forEach((p, j) => {
      if (p)
        p.style.transform = `rotate(${(j * 30 + twist).toFixed(2)}deg) translateY(${(-r).toFixed(2)}px) scale(${sc.toFixed(3)})`;
    });
  });
  const pop = useSpring(1, 0.55, (x) => {
    if (el.current) el.current.style.scale = x === 1 ? '' : x.toFixed(4);
  });
  const was = useRef(done);
  useEffect(() => {
    const L = loop();
    const f = feelOf('button');
    L.to(s, done ? 0 : 1, f);
    if (was.current === done) return;
    was.current = done;
    if (!done) return;
    // точка собралась — подпрыгивает
    const id = setTimeout(() => {
      L.to(pop, 1, f);
      L.kick(pop, 5);
    }, 140);
    return () => clearTimeout(id);
  }, [done, s, pop]);
  useEffect(() => s.emit(), [s]);
  return (
    <button
      ref={el}
      type="button"
      className={done ? 'q-ring q-done' : 'q-ring'}
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      onPointerDown={() => loop().to(pop, 0.82, feelOf('button'))}
      onPointerUp={() => loop().to(pop, 1, feelOf('button'))}
      onPointerCancel={() => loop().to(pop, 1, feelOf('button'))}
      onPointerLeave={() => loop().to(pop, 1, feelOf('button'))}
      onClick={() => onToggle(!done)}
    >
      {Array.from({ length: 12 }, (_, j) => (
        <i key={j} ref={(el) => void (parts.current[j] = el)} />
      ))}
    </button>
  );
}
