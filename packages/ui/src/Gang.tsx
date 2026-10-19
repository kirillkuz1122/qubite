import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { companionSize, DotEngine, type Body, type Mood } from './dots/engine';
import { useLook } from './look';
import { COMPANION_COLOR, type CompanionKind } from './tokens';

export interface GangHandle {
  /** все подпрыгивают и радуются */
  cheer(): void;
  /** настроение всем сразу (на время ms) */
  setMood(m: Mood, ms?: number): void;
}

export interface GangProps {
  /** кто стоит в ряду, слева направо */
  kinds?: CompanionKind[];
  /** шаг точки, px */
  pitch?: number;
  /** закрыли глаза и отвернулись (пароль не подсматривают) */
  away?: boolean;
  label?: string;
}

const ALL = Object.keys(COMPANION_COLOR) as CompanionKind[];

/**
 * Помощники группой в одном холсте (экран входа): стоят в ряд, смотрят на каретку,
 * отворачиваются от пароля. Касание — тот, в кого попали, подпрыгивает.
 */
export const Gang = forwardRef<GangHandle, GangProps>(function Gang(
  { kinds = ALL, pitch = 4, away = false, label },
  ref,
) {
  const cv = useRef<HTMLCanvasElement>(null);
  const bodies = useRef<Body[]>([]);
  const { palette } = useLook();
  const start = useRef(palette);
  const key = kinds.join(',');
  const awayNow = useRef(away);

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const list = key.split(',') as CompanionKind[];
    const sizes = list.map((k) => companionSize(k));
    c.style.width = `${Math.ceil(sizes.reduce((s, z) => s + z.w + 4, 0) * pitch)}px`;
    c.style.height = `${Math.ceil((Math.max(...sizes.map((z) => z.h)) + 6) * pitch)}px`;
    const P = start.current;
    const e = new DotEngine(c, { ground: P.bg, light: P.ink, repel: 0 });
    let left = 0;
    bodies.current = list.map((k, i) => {
      const sz = sizes[i]!;
      const own = (sz.w + 4) * pitch;
      const x = left + (k === 'elik' ? (sz.w / 2 - 2.5) * pitch : own / 2);
      left += own;
      const b = e.body(k, {
        x,
        y: e.H - pitch,
        pitch,
        color: P[COMPANION_COLOR[k]],
        assemble: true,
        delay: i * 0.12,
      });
      if (awayNow.current) b.turnAway(true);
      return b;
    });
    return () => {
      e.destroy();
      bodies.current = [];
    };
  }, [key, pitch]);

  useEffect(() => {
    awayNow.current = away;
    bodies.current.forEach((b) => b.turnAway(away));
  }, [away]);

  useImperativeHandle(ref, () => ({
    cheer: () =>
      bodies.current.forEach((b, i) =>
        setTimeout(() => b.jump(300).setMood('happy', 1400), i * 90),
      ),
    setMood: (m, ms) => bodies.current.forEach((b) => b.setMood(m, ms)),
  }));

  return (
    <canvas
      ref={cv}
      className="q-gang"
      role="img"
      aria-label={label ?? 'Помощники'}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - r.left;
        const hit = bodies.current.reduce<Body | null>(
          (best, b) => (!best || Math.abs(b.x - x) < Math.abs(best.x - x) ? b : best),
          null,
        );
        hit?.jump(320).setMood('happy', 1200);
      }}
    />
  );
});
