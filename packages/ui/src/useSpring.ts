import { loop, type Spring } from '@qubite/motion';
import { useEffect, useRef, useState } from 'react';

/**
 * Пружина, которая живёт столько же, сколько компонент. Кадры не перерисовывают React:
 * draw(x) вызывается прямо из общего цикла и пишет в стиль только transform и opacity.
 */
export function useSpring(initial: number, mass: number, draw: (x: number) => void): Spring {
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  });
  const [s] = useState(() => {
    const L = loop();
    const spring = L.spring(initial, mass);
    const render = L.render(() => drawRef.current(spring.x));
    spring.onChange = render;
    return spring;
  });
  return s;
}

export { loop };
