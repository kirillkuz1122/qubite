import { useEffect, useRef } from "react";
// One frame per input event burst; no idle animation loop or persistent tracking.
export function useNeighborhood(enabled: boolean, strength: number) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const point = useRef({ x: 0, y: 0 });
  const lit = useRef<HTMLElement[]>([]);
  function clear() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    lit.current.forEach((node) => node.style.removeProperty("--ambient"));
    lit.current = [];
  }
  useEffect(() => {
    clear();
    return clear;
  }, [enabled, strength]);
  return {
    ref,
    handlers: {
      onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (!enabled) return;
        point.current = { x: e.clientX, y: e.clientY };
        if (frame.current !== null) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          lit.current.forEach((node) => node.style.removeProperty("--ambient"));
          lit.current = [];
          ref.current
            ?.querySelectorAll<HTMLElement>(".alive")
            .forEach((node) => {
              const r = node.getBoundingClientRect();
              const distance = Math.hypot(
                Math.max(
                  r.left - point.current.x,
                  0,
                  point.current.x - r.right,
                ),
                Math.max(
                  r.top - point.current.y,
                  0,
                  point.current.y - r.bottom,
                ),
              );
              if (distance < 100 && r.width && r.height) {
                node.style.setProperty(
                  "--ambient",
                  String((1 - distance / 100) * strength),
                );
                lit.current.push(node);
              }
            });
        });
      },
      onPointerLeave: clear,
      onPointerCancel: clear,
    },
  };
}
