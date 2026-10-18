import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { companionSize, DotEngine, type Body, type Mood } from './dots/engine';
import { useLook } from './look';
import { COMPANION_COLOR, type CompanionKind } from './tokens';

export interface CompanionHandle {
  jump(): void;
  setMood(m: Mood, ms?: number): void;
  /** приватность: закрыть глаза и отвернуться */
  turnAway(on: boolean): void;
}

export interface CompanionProps {
  kind: CompanionKind;
  /** шаг точки, px */
  pitch?: number;
  /** при появлении точки слетаются из облака */
  assemble?: boolean;
  label?: string;
}

const NAMES: Record<CompanionKind, string> = {
  elik: 'Элик',
  proto: 'Прото',
  neit: 'Нейт',
  foti: 'Фоти',
};

/** Помощник из точек: дышит, моргает, смотрит на курсор и каретку; по нажатию прыгает. */
export const Companion = forwardRef<CompanionHandle, CompanionProps>(function Companion(
  { kind, pitch = 5, assemble = true, label },
  ref,
) {
  const cv = useRef<HTMLCanvasElement>(null);
  const body = useRef<Body | null>(null);
  const { palette } = useLook();
  const start = useRef({
    color: palette[COMPANION_COLOR[kind]],
    ground: palette.bg,
    ink: palette.ink,
  });

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const sz = companionSize(kind);
    c.style.width = `${Math.ceil((sz.w + 4) * pitch)}px`;
    c.style.height = `${Math.ceil((sz.h + 4) * pitch)}px`;
    const s = start.current;
    const e = new DotEngine(c, { ground: s.ground, light: s.ink, repel: 0 });
    const x = kind === 'elik' ? (sz.w / 2 - 2.5) * pitch : e.W / 2;
    body.current = e.body(kind, { x, y: e.H - pitch, pitch, color: s.color, assemble });
    return () => {
      e.destroy();
      body.current = null;
    };
  }, [kind, pitch, assemble]);

  useImperativeHandle(ref, () => ({
    jump: () => void body.current?.jump(320).setMood('happy', 1200),
    setMood: (m, ms) => void body.current?.setMood(m, ms),
    turnAway: (on) => void body.current?.turnAway(on),
  }));

  return (
    <canvas
      ref={cv}
      className="q-companion"
      role="img"
      aria-label={label ?? NAMES[kind]}
      onPointerDown={() => body.current?.jump(320).setMood('happy', 1200)}
    />
  );
});
