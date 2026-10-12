import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type RefObject,
} from "react";
import { profiles, type Profile } from "./profiles";
export const MotionContext = createContext<{
  profile: Profile;
  strength: number;
  quiet: boolean;
} | null>(null);
export function usePhysics<T extends HTMLElement>(
  ref: RefObject<T | null>,
  initial: Record<string, number>,
) {
  const context = useContext(MotionContext);
  const config = useRef(context);
  config.current = context;
  const values = useRef({ ...initial });
  const targets = useRef({ ...initial });
  const velocity = useRef<Record<string, number>>({});
  const raf = useRef<number | null>(null);
  const last = useRef(0);
  function paint() {
    for (const [key, value] of Object.entries(values.current))
      ref.current?.style.setProperty(`--${key}`, String(value));
  }
  function tick(time: number) {
    const dt = Math.min(
      1 / 30,
      Math.max(1 / 240, (time - last.current) / 1000 || 1 / 60),
    );
    last.current = time;
    const c = config.current;
    const p = c?.profile || profiles[0];
    let unsettled = false;
    for (const [key, target] of Object.entries(targets.current)) {
      const current = values.current[key] ?? target;
      const v =
        (velocity.current[key] || 0) +
        ((target - current) * p.stiffness -
          (velocity.current[key] || 0) * p.damping) *
          dt;
      values.current[key] = current + v * dt;
      velocity.current[key] = v;
      if (Math.abs(target - values.current[key]) > 0.001 || Math.abs(v) > 0.002)
        unsettled = true;
      else {
        values.current[key] = target;
        velocity.current[key] = 0;
      }
    }
    paint();
    raf.current = unsettled ? requestAnimationFrame(tick) : null;
  }
  function to(next: Record<string, number>, instant = false) {
    Object.assign(targets.current, next);
    if (instant || config.current?.quiet) {
      Object.assign(values.current, next);
      velocity.current = {};
      paint();
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    } else if (raf.current === null) {
      last.current = performance.now();
      raf.current = requestAnimationFrame(tick);
    }
  }
  useEffect(() => {
    paint();
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, []);
  useEffect(() => {
    if (context?.quiet) to(targets.current, true);
  }, [context?.quiet]);
  return { to, values };
}
export function useLiving<T extends HTMLElement>(ref: RefObject<T | null>) {
  const c = useContext(MotionContext);
  const physics = usePhysics(ref, {
    dragX: 0,
    dragY: 0,
    stretchX: 1,
    stretchY: 1,
    turn: 0,
    glow: 0,
    lightX: 50,
    lightY: 50,
    edge: 0,
  });
  const gesture = useRef<{
    x: number;
    y: number;
    moved: boolean;
    rect: DOMRect;
    pointer: number;
  } | null>(null);
  const suppress = useRef(false);
  const q = () => !c || c.quiet || c.strength === 0;
  function release() {
    gesture.current = null;
    physics.to({
      dragX: 0,
      dragY: 0,
      stretchX: 1,
      stretchY: 1,
      turn: 0,
      glow: 0,
      edge: 0,
    });
  }
  return {
    active: !!c,
    physics,
    handlers: {
      onPointerDown(e: React.PointerEvent<T>) {
        if (e.button !== 0 || !c) return;
        const rect = e.currentTarget.getBoundingClientRect();
        gesture.current = {
          x: e.clientX,
          y: e.clientY,
          moved: false,
          rect,
          pointer: e.pointerId,
        };
        suppress.current = false;
        e.currentTarget.setPointerCapture(e.pointerId);
        if (!q())
          physics.to({
            stretchX: 1 + c.profile.squash * c.strength,
            stretchY: 1 - c.profile.squash * c.strength,
            glow: 1,
            lightX: ((e.clientX - rect.left) / rect.width) * 100,
            lightY: ((e.clientY - rect.top) / rect.height) * 100,
          });
      },
      onPointerMove(e: React.PointerEvent<T>) {
        const g = gesture.current;
        if (g) g.moved ||= Math.hypot(e.clientX - g.x, e.clientY - g.y) > 9;
        if (!c || q()) return;
        const rect = g?.rect || e.currentTarget.getBoundingClientRect();
        const nx = Math.max(
          0,
          Math.min(100, ((e.clientX - rect.left) / rect.width) * 100),
        );
        const ny = Math.max(
          0,
          Math.min(100, ((e.clientY - rect.top) / rect.height) * 100),
        );
        physics.to({ lightX: nx, lightY: ny, glow: g ? 1 : 0.45 });
        if (g) {
          const dx = e.clientX - g.x,
            dy = e.clientY - g.y;
          g.moved ||= Math.hypot(dx, dy) > 9;
          const limit = c.profile.travel * c.strength;
          const x = Math.tanh(dx / 70) * limit,
            y = Math.tanh(dy / 70) * limit;
          const pull = Math.min(1, Math.hypot(dx, dy) / 90) * c.strength;
          physics.to({
            dragX: x,
            dragY: y,
            stretchX:
              1 +
              (Math.abs(x) / Math.max(1, limit)) *
                c.profile.squash *
                c.strength,
            stretchY: 1 - pull * c.profile.squash * 0.6,
            turn: Math.tanh(dx / 90) * c.profile.twist * c.strength,
            edge: (x / Math.max(1, limit)) * c.strength,
          });
        } else if (c.profile.id === "orbit")
          physics.to({
            dragX: ((nx - 50) / 50) * 5 * c.strength,
            dragY: ((ny - 50) / 50) * 4 * c.strength,
            turn: ((nx - 50) / 50) * 1.4 * c.strength,
          });
      },
      onPointerUp(e: React.PointerEvent<T>) {
        const g = gesture.current;
        if (g) suppress.current = g.moved;
        release();
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      },
      onPointerCancel() {
        suppress.current = true;
        release();
      },
      onLostPointerCapture() {
        if (gesture.current) suppress.current = true;
        release();
      },
      onPointerLeave() {
        if (!gesture.current) release();
      },
      onFocus() {
        if (c && !q()) physics.to({ glow: 0.7 });
      },
      onBlur() {
        release();
      },
    },
    consumeClick() {
      const value = suppress.current;
      suppress.current = false;
      return value;
    },
  };
}
