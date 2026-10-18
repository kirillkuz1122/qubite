import { loop } from '@qubite/motion';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { companionSize, DotEngine, type Body } from './dots/engine';
import { useLook } from './look';
import { COMPANION_COLOR, type CompanionKind } from './tokens';

export interface CrewHandle {
  /** помощник радуется и подпрыгивает (по умолчанию — тот, что на виду) */
  jump(kind?: CompanionKind): void;
}

export interface CrewProps {
  /** кто сейчас на виду; остальные спрятаны под нижний край */
  active: CompanionKind | null;
  /** шаг точки, px */
  pitch: number;
  /** высота холста, px */
  height: number;
  label?: string;
}

const KINDS = Object.keys(COMPANION_COLOR) as CompanionKind[];

/**
 * Четыре помощника в одном холсте (шапка раздела): помощник раздела выпрыгивает снизу,
 * прежний уходит вниз. Касание — прыжок.
 */
export const Crew = forwardRef<CrewHandle, CrewProps>(function Crew(
  { active, pitch, height, label },
  ref,
) {
  const cv = useRef<HTMLCanvasElement>(null);
  const bodies = useRef(new Map<CompanionKind, Body>());
  const { palette } = useLook();
  const start = useRef({ palette });
  const shown = useRef<CompanionKind | null>(null);
  const width = Math.ceil(Math.max(...KINDS.map((k) => companionSize(k).w + 4)) * pitch);

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const P = start.current.palette;
    const e = new DotEngine(c, { ground: P.bg, light: P.ink, repel: 0 });
    const all = bodies.current;
    KINDS.forEach((k) => {
      const sz = companionSize(k);
      const own = (sz.w + 4) * pitch;
      const x = e.W - own + (k === 'elik' ? (sz.w / 2 - 2.5) * pitch : own / 2);
      const b = e.body(k, { x, y: e.H - 6, pitch, color: P[COMPANION_COLOR[k]] });
      loop().set(b.lift, -e.H);
      b.settle();
      all.set(k, b);
    });
    shown.current = null;
    return () => {
      e.destroy();
      all.clear();
    };
  }, [pitch, height]);

  useEffect(() => {
    const H = height;
    const timers: ReturnType<typeof setTimeout>[] = [];
    bodies.current.forEach((b, k) => {
      if (k === active) {
        if (b.lift.goal !== 0) {
          loop().set(b.lift, -H * 0.6);
          timers.push(setTimeout(() => toLift(b, 0), 120));
          timers.push(setTimeout(() => b.jump(240).setMood('happy', 1000), 520));
        } else b.jump(200);
      } else toLift(b, -H);
    });
    shown.current = active;
    return () => timers.forEach(clearTimeout);
  }, [active, height, pitch]);

  useImperativeHandle(ref, () => ({
    jump: (kind) => {
      const b = bodies.current.get(kind ?? shown.current ?? 'elik');
      if (b && (kind == null || kind === shown.current)) b.jump(300).setMood('happy', 1200);
    },
  }));

  return (
    <canvas
      ref={cv}
      className="q-crew"
      role="img"
      aria-label={label ?? 'Помощник'}
      style={{ width, height }}
      onPointerDown={() => {
        const b = shown.current && bodies.current.get(shown.current);
        if (b) b.jump(300).setMood('happy', 1200);
      }}
    />
  );
});

function toLift(b: Body, v: number) {
  loop().to(b.lift, v);
}
