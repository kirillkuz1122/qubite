// Graduated from assets/design-lab/src/milo/motion.tsx; approved Flux mechanics.
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
  selectionMs?: number;
  lite?: boolean;
} | null>(null);
// One scheduler for all active controls. Sleeping controls have no frame work.
type FrameJob = (time: number) => boolean;
const jobs = new Set<FrameJob>();
let frame: number | null = null;
function schedule(job: FrameJob) {
  jobs.add(job);
  if (frame === null) frame = requestAnimationFrame(runFrame);
}
function unschedule(job: FrameJob) {
  jobs.delete(job);
  if (!jobs.size && frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
}
function runFrame(time: number) {
  frame = null;
  for (const job of jobs) if (!job(time)) jobs.delete(job);
  if (jobs.size) frame = requestAnimationFrame(runFrame);
}
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
  const painted = useRef<Record<string, number>>({});
  const last = useRef(0);
  const tween = useRef<{
    start: number;
    duration: number;
    from: Record<string, number>;
    to: Record<string, number>;
  } | null>(null);
  function paint() {
    const el = ref.current;
    if (!el) return;
    for (const [key, value] of Object.entries(values.current)) {
      // Round below visual precision; don't invalidate unchanged style values.
      const rounded = Math.round(value * 10000) / 10000;
      if (painted.current[key] !== rounded) {
        el.style.setProperty(`--${key}`, String(rounded));
        painted.current[key] = rounded;
      }
    }
  }
  const tick = useRef<FrameJob>(() => false);
  tick.current = (time) => {
    let unsettled = false;
    if (tween.current) {
      const t = tween.current;
      const progress = Math.min(1, (time - t.start) / t.duration);
      const ease = progress * progress * (3 - 2 * progress);
      for (const [key, target] of Object.entries(t.to))
        values.current[key] = t.from[key] + (target - t.from[key]) * ease;
      // Same stretch on a tap as a drag. Geometry never jumps to its destination.
      if ("pillPull" in t.to)
        values.current.pillPull =
          Math.sin(progress * Math.PI) *
          Math.sign((t.to.pillX || 0) - (t.from.pillX || 0)) *
          0.32;
      unsettled = progress < 1;
      if (!unsettled) {
        Object.assign(values.current, t.to);
        tween.current = null;
      }
    } else {
      const elapsed = Math.min(0.08, Math.max(0, (time - last.current) / 1000));
      const p = config.current?.profile || profiles[0];
      // Small integration steps remain stable at 15/30/60/120 Hz.
      const steps = Math.max(1, Math.ceil(elapsed / (1 / 120))),
        dt = elapsed / steps;
      for (const [key, target] of Object.entries(targets.current)) {
        let current = values.current[key] ?? target,
          v = velocity.current[key] || 0;
        for (let i = 0; i < steps; i++) {
          v += ((target - current) * p.stiffness - v * p.damping) * dt;
          current += v * dt;
        }
        if (Math.abs(target - current) > 0.002 || Math.abs(v) > 0.008) {
          unsettled = true;
          values.current[key] = current;
          velocity.current[key] = v;
        } else {
          values.current[key] = target;
          velocity.current[key] = 0;
        }
      }
    }
    last.current = time;
    paint();
    if (!unsettled) ref.current?.removeAttribute("data-moving");
    return unsettled;
  };
  const job = useRef<FrameJob>((time) => tick.current(time));
  function to(next: Record<string, number>, instant = false) {
    tween.current = null;
    Object.assign(targets.current, next);
    if (instant || config.current?.quiet) {
      Object.assign(values.current, next);
      velocity.current = {};
      paint();
      unschedule(job.current);
      ref.current?.removeAttribute("data-moving");
    } else {
      if (!jobs.has(job.current)) last.current = performance.now();
      ref.current?.setAttribute("data-moving", "true");
      schedule(job.current);
    }
  }
  function flow(
    next: Record<string, number>,
    duration = config.current?.selectionMs || 520,
  ) {
    if (config.current?.quiet) {
      to(next, true);
      return;
    }
    Object.assign(targets.current, next);
    velocity.current = {};
    tween.current = {
      start: performance.now(),
      duration,
      from: { ...values.current },
      to: next,
    };
    last.current = performance.now();
    ref.current?.setAttribute("data-moving", "true");
    schedule(job.current);
  }
  useEffect(() => {
    painted.current = {};
    paint();
    return () => {
      unschedule(job.current);
      tween.current = null;
    };
  }, []);
  useEffect(() => {
    if (context?.quiet) to(targets.current, true);
  }, [context?.quiet]);
  return { to, flow, values };
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
        if (e.button !== 0 || !c || gesture.current) return;
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
        if (g && g.pointer !== e.pointerId) return;
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
        physics.to(
          c.lite || e.pointerType === "touch"
            ? { glow: g ? 1 : 0.25 }
            : { lightX: nx, lightY: ny, glow: g ? 1 : 0.45 },
        );
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
              c.profile.squash *
                c.strength *
                (0.35 + (0.65 * Math.abs(x)) / Math.max(1, limit)),
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
        if (g && g.pointer !== e.pointerId) return;
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
