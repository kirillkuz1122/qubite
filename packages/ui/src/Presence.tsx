import { MASS } from '@qubite/motion';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { loop, useSpring } from './useSpring';

export interface PresenceProps {
  /** показывать ли блок; false — блок уходит с анимацией и только потом пропадает из страницы */
  show: boolean;
  /** поменялось содержимое (например, другое дело в подсказке) — блок мягко «переговаривает» его */
  swap?: unknown;
  /** блок только что занял место на странице или освободил его — соседям пора подтянуться (useFlip) */
  onLayout?: () => void;
  className?: string;
  children: ReactNode;
}

/**
 * Появление и уход без рывков: блок проявляется и чуть съезжает на место пружиной, а уходит обратно —
 * и лишь потом удаляется. Пока уходит, показывает последнее содержимое. Двигаются только opacity и transform.
 */
export function Presence({ show, swap, onLayout, className, children }: PresenceProps) {
  const el = useRef<HTMLDivElement>(null);
  const [alive, setAlive] = useState(show);
  const live = useRef(show);
  const kept = useRef<ReactNode>(children);
  if (show) kept.current = children;
  const layout = useRef(onLayout);
  useEffect(() => {
    layout.current = onLayout;
  });
  const was = useRef(alive);
  useLayoutEffect(() => {
    if (was.current === alive) return;
    was.current = alive;
    layout.current?.();
  }, [alive]);
  const s = useSpring(0, MASS.sheet, (v) => {
    const d = el.current;
    if (d) {
      const k = Math.min(1, Math.max(0, v));
      d.style.opacity = k === 1 ? '' : k.toFixed(3);
      d.style.transform =
        v === 1
          ? ''
          : `translateY(${((1 - v) * -10).toFixed(2)}px) scale(${(0.97 + 0.03 * v).toFixed(4)})`;
    }
    if (s.goal === 0 && v < 0.02 && live.current) {
      live.current = false;
      setAlive(false);
    }
  });

  // снова показать, пока блока нет на странице, — сразу возвращаем его (состояние меняется прямо в отрисовке)
  if (show && !alive) {
    live.current = true;
    setAlive(true);
  }
  useEffect(() => {
    if (alive) loop().to(s, show ? 1 : 0);
  }, [show, alive, s]);

  /* другое содержимое: блок чуть приседает и возвращается */
  const prev = useRef(swap);
  useEffect(() => {
    if (prev.current === swap) return;
    prev.current = swap;
    if (!show || !alive) return;
    const L = loop();
    L.hold(s, 0.55);
    L.to(s, 1);
  }, [swap, show, alive, s]);

  if (!alive) return null;
  return (
    <div ref={el} className={className} style={{ opacity: 0 }}>
      {kept.current}
    </div>
  );
}
