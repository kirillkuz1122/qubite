import { loop, type Spring } from '@qubite/motion';
import { useEffect, useRef, type RefObject } from 'react';
import { useSpring } from './useSpring';

/**
 * Настроение Элика в строке Входящих (CMD-004): `idle` — одна точка, как раньше; `think` — три
 * точки бегут волной (агент обдумывает мысль); `happy` — подпрыгивают (разложил); `ask` — склонил
 * голову (не уверен, спрашивает); `oops` — вздрогнул и осел (откатили — ошибся по-своему).
 */
export type ElikMood = 'idle' | 'think' | 'happy' | 'ask' | 'oops';

const NAMES: Record<ElikMood, string> = {
  idle: 'Элик',
  think: 'Элик думает',
  happy: 'Элик радуется',
  ask: 'Элик спрашивает',
  oops: 'Элик ошибся',
};

type Dots = RefObject<(HTMLSpanElement | null)[]>;

/** Пружина, которая пишет transform одной точки (только transform/opacity). */
function useDot(dots: Dots, i: number, draw: (el: HTMLSpanElement, x: number) => void): Spring {
  return useSpring(0, 0.5, (x) => {
    const el = dots.current[i];
    if (el) draw(el, x);
  });
}

/** Точки Элика: каждая точка — обёртка (появление сбоку) и сама точка (прыжок). */
export function ElikDots({ mood, label }: { mood: ElikMood; label?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const slots = useRef<(HTMLSpanElement | null)[]>([]);
  const dots = useRef<(HTMLSpanElement | null)[]>([]);
  /* боковые точки: 0 — спрятаны в среднюю, 1 — рядом */
  const spread = useSpring(mood === 'idle' ? 0 : 1, 0.8, (p) => {
    const k = Math.min(1, Math.max(0, p));
    [-1, 1].forEach((side) => {
      const el = slots.current[side + 1];
      if (!el) return;
      el.style.opacity = k.toFixed(3);
      el.style.transform =
        k === 1 ? '' : `translateX(${((1 - k) * -7 * side).toFixed(2)}px) scale(${k.toFixed(3)})`;
    });
  });
  const tilt = useSpring(0, 0.9, (t) => {
    if (box.current) box.current.style.transform = t === 0 ? '' : `rotate(${t.toFixed(3)}rad)`;
  });
  const hop = (el: HTMLSpanElement, y: number) => {
    el.style.transform = y === 0 ? '' : `translateY(${y.toFixed(2)}px)`;
  };
  const hops = [useDot(dots, 0, hop), useDot(dots, 1, hop), useDot(dots, 2, hop)];

  useEffect(() => {
    const L = loop();
    spread.emit();
    L.to(spread, mood === 'idle' ? 0 : 1);
    L.to(tilt, mood === 'ask' ? -0.22 : 0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (mood === 'happy') {
      hops.forEach((h, i) => timers.push(setTimeout(() => L.kick(h, -150), i * 70)));
    }
    if (mood === 'oops') {
      L.kick(tilt, 3.2);
      hops.forEach((h) => L.kick(h, 90));
    }
    if (mood === 'think') {
      let i = 0;
      const t = setInterval(() => L.kick(hops[i++ % 3]!, -95), 170);
      return () => clearInterval(t);
    }
    return () => timers.forEach(clearTimeout);
    // пружины живут столько же, сколько компонент
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mood]);

  return (
    <span
      className={`elik-dots ${mood}`}
      ref={box}
      role="img"
      aria-label={label ?? NAMES[mood]}
      data-mood={mood}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="elik-slot"
          ref={(el) => {
            slots.current[i] = el;
          }}
        >
          <span
            ref={(el) => {
              dots.current[i] = el;
            }}
          />
        </span>
      ))}
    </span>
  );
}
