// Graduated controls, not the prototype application or its permissions.
import {
  useContext,
  useLayoutEffect,
  useRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { MotionContext, useLiving, usePhysics } from "./motion";
export function LivingButton({
  children,
  className = "",
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const ref = useRef<HTMLButtonElement>(null);
  const motion = useLiving(ref);
  if (!motion.active)
    return (
      <button className={className} onClick={onClick} {...props}>
        {children}
      </button>
    );
  return (
    <button
      type="button"
      {...props}
      {...Object.fromEntries(
        Object.entries(motion.handlers).map(([key, handler]) => [
          key,
          (e: never) => {
            handler(e);
            (
              props[key as keyof typeof props] as
                ((event: never) => void) | undefined
            )?.(e);
          },
        ]),
      )}
      ref={ref}
      className={`alive ${className}`}
      onClick={(e) => {
        const consumed = motion.consumeClick();
        if (consumed && e.detail !== 0) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}
export function LivingLink({
  children,
  className = "",
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const ref = useRef<HTMLAnchorElement>(null);
  const motion = useLiving(ref);
  return (
    <a
      {...props}
      {...Object.fromEntries(
        Object.entries(motion.handlers).map(([key, handler]) => [
          key,
          (e: never) => {
            handler(e);
            (
              props[key as keyof typeof props] as
                ((event: never) => void) | undefined
            )?.(e);
          },
        ]),
      )}
      ref={ref}
      className={`${motion.active ? "alive" : ""} ${className}`}
      onClick={(e) => {
        if (motion.consumeClick() && e.detail !== 0) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onClick?.(e);
      }}
    >
      {children}
    </a>
  );
}
export function LivingSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  suffix = "%",
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const ref = useRef<HTMLLabelElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const c = useContext(MotionContext);
  const physics = usePhysics(ref, {
    value: ((value - min) / (max - min)) * 100,
    grip: 0,
    speed: 0,
  });
  const last = useRef(value);
  const dragging = useRef<number | null>(null);
  useLayoutEffect(() => {
    physics.to({
      value: ((value - min) / (max - min)) * 100,
      speed: Math.max(-1, Math.min(1, (value - last.current) / 12)),
    });
    last.current = value;
  }, [value, min, max]);
  function point(e: React.PointerEvent<HTMLInputElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(
      0,
      Math.min(1, (e.clientX - r.left - 18) / Math.max(1, r.width - 36)),
    );
    onChange(Math.round(min + fraction * (max - min)));
  }
  function end(e: React.PointerEvent<HTMLInputElement>) {
    if (dragging.current !== e.pointerId) return;
    dragging.current = null;
    physics.to({ grip: 0, speed: 0 });
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  return (
    <label className="living-slider" ref={ref}>
      <span className="slider-label">
        {label}
        <output>
          {value}
          {suffix}
        </output>
      </span>
      <span className="slider-track">
        <span className="slider-fill" />
        <span className="slider-thumb">
          <i />
        </span>
        <span className="slider-ticks" />
      </span>
      <input
        ref={input}
        aria-label={label}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={(e) => {
          if (e.button !== 0 || dragging.current !== null) return;
          e.preventDefault();
          e.currentTarget.focus();
          dragging.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          point(e);
          physics.to({ grip: c?.quiet ? 0 : 1 });
        }}
        onPointerMove={(e) => {
          if (dragging.current === e.pointerId) point(e);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={() => {
          dragging.current = null;
          physics.to({ grip: 0, speed: 0 });
        }}
      />
    </label>
  );
}
export function LivingSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (n: boolean) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const physics = usePhysics(ref, { position: checked ? 1 : 0, grip: 0 });
  const drag = useRef<{
    x: number;
    moved: boolean;
    value: number;
    pointer: number;
  } | null>(null);
  const consumed = useRef(false);
  const c = useContext(MotionContext);
  useLayoutEffect(() => {
    physics.to({ position: checked ? 1 : 0 });
  }, [checked]);
  function cancel() {
    drag.current = null;
    physics.to({ grip: 0, position: checked ? 1 : 0 });
  }
  return (
    <div className="switch-row">
      <span>{label}</span>
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        className="living-switch"
        data-on={checked}
        onClick={(e) => {
          if (e.detail === 0 || !consumed.current) onChange(!checked);
          consumed.current = false;
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || drag.current) return;
          consumed.current = false;
          drag.current = {
            x: e.clientX,
            moved: false,
            value: checked ? 1 : 0,
            pointer: e.pointerId,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
          physics.to({ grip: c?.quiet ? 0 : 1 });
        }}
        onPointerMove={(e) => {
          if (!drag.current || drag.current.pointer !== e.pointerId) return;
          const dx = e.clientX - drag.current.x;
          drag.current.moved ||= Math.abs(dx) > 7;
          drag.current.value = Math.max(
            0,
            Math.min(1, (checked ? 1 : 0) + dx / 32),
          );
          physics.to({ position: drag.current.value });
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d || d.pointer !== e.pointerId) return;
          if (d.moved) {
            consumed.current = true;
            onChange(d.value > 0.5);
          }
          cancel();
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={(e) => {
          if (drag.current?.pointer !== e.pointerId) return;
          consumed.current = true;
          cancel();
        }}
        onLostPointerCapture={cancel}
      >
        <span />
        <i />
      </button>
    </div>
  );
}
export function LivingTabs({
  items,
  value,
  onChange,
  label,
}: {
  items: { id: string; label: string; icon?: ReactNode }[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const physics = usePhysics(pill, {
    pillX: 0,
    pillY: 4,
    pillWidth: 100,
    pillHeight: 44,
    pillPull: 0,
  });
  const initial = useRef(true);
  const drag = useRef<{
    x: number;
    y: number;
    pointer: number;
    left: number;
    top: number;
    target: string;
    moved: boolean;
  } | null>(null);
  const consumed = useRef(false);
  function selected() {
    return ref.current?.querySelector<HTMLButtonElement>(
      `button[data-id="${value}"]`,
    );
  }
  const c = useContext(MotionContext);
  function layout(instant = false) {
    const b = selected();
    if (!b) return;
    const next = {
      pillX: b.offsetLeft,
      pillY: b.offsetTop,
      pillWidth: b.offsetWidth,
      pillHeight: b.offsetHeight,
      pillPull: 0,
    };
    if (instant) physics.to(next, true);
    else if (c?.profile.id === "flux") physics.flow(next);
    else physics.to(next);
  }
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useLayoutEffect(() => {
    layout(initial.current);
    initial.current = false;
  }, [value, items.length]);
  useLayoutEffect(() => {
    // Observe geometry for the lifetime of the group, not each selection.
    // ResizeObserver's initial notification must not cancel a click animation.
    let first = true;
    const resize = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      layoutRef.current(false);
    });
    if (ref.current) {
      resize.observe(ref.current);
      ref.current.querySelectorAll("button").forEach((b) => resize.observe(b));
    }
    return () => resize.disconnect();
  }, [items.length]);
  return (
    <div className="living-tabs" ref={ref} role="group" aria-label={label}>
      <span className="living-pill" ref={pill} aria-hidden="true" />
      {items.map((item, i) => (
        <button
          type="button"
          data-id={item.id}
          key={item.id}
          aria-pressed={value === item.id}
          onClick={(e) => {
            if (e.detail === 0 || !consumed.current) onChange(item.id);
            consumed.current = false;
          }}
          onKeyDown={(e) => {
            if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
              e.preventDefault();
              const n =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? items.length - 1
                    : (i + (e.key === "ArrowRight" ? 1 : -1) + items.length) %
                      items.length;
              onChange(items[n].id);
              ref.current
                ?.querySelector<HTMLButtonElement>(
                  `button[data-id="${items[n].id}"]`,
                )
                ?.focus();
            }
          }}
          onPointerDown={(e) => {
            if (e.button !== 0 || drag.current) return;
            consumed.current = false;
            const b = selected();
            drag.current = {
              x: e.clientX,
              y: e.clientY,
              pointer: e.pointerId,
              top: b?.offsetTop || 0,
              left: b?.offsetLeft || 0,
              target: value,
              moved: false,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.pointer !== e.pointerId || !ref.current) return;
            const r = ref.current.getBoundingClientRect();
            const dx = e.clientX - d.x,
              dy = e.clientY - d.y;
            d.moved ||= Math.hypot(dx, dy) > 8;
            const buttons = Array.from(
              ref.current.querySelectorAll<HTMLButtonElement>("button"),
            );
            const target = buttons.find((b) => {
              const q = b.getBoundingClientRect();
              return (
                e.clientX >= q.left &&
                e.clientX <= q.right &&
                e.clientY >= q.top &&
                e.clientY <= q.bottom
              );
            });
            if (target) d.target = target.dataset.id!;
            if (!c?.quiet)
              physics.to({
                pillX: Math.max(
                  4,
                  Math.min(
                    r.width - physics.values.current.pillWidth - 4,
                    d.left + dx,
                  ),
                ),
                pillY: Math.max(
                  4,
                  Math.min(
                    r.height - physics.values.current.pillHeight - 4,
                    d.top + dy,
                  ),
                ),
                pillPull: Math.max(-1, Math.min(1, dx / 80)),
              });
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            if (!d || d.pointer !== e.pointerId) return;
            if (d.moved) {
              consumed.current = true;
              onChange(d.target);
            }
            drag.current = null;
            layout();
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={(e) => {
            if (drag.current?.pointer !== e.pointerId) return;
            consumed.current = true;
            drag.current = null;
            layout();
          }}
          onLostPointerCapture={() => {
            if (drag.current) {
              consumed.current = true;
              drag.current = null;
              layout();
            }
          }}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
export function LivingNavigation({
  children,
  value,
  label,
  className = "",
}: {
  children: ReactNode;
  value: string;
  label: string;
  className?: string;
}) {
  const c = useContext(MotionContext);
  const ref = useRef<HTMLElement>(null),
    pill = useRef<HTMLSpanElement>(null);
  const initial = useRef(true);
  const physics = usePhysics(pill, {
    navX: 0,
    navY: 0,
    navW: 0,
    navH: 0,
    navOpacity: 0,
  });
  function layout(instant = false) {
    if (!c) return;
    const b = ref.current?.querySelector<HTMLButtonElement>(
      '[aria-current="page"]',
    );
    const next: Record<string, number> = b
      ? {
          navX: b.offsetLeft,
          navY: b.offsetTop,
          navW: b.offsetWidth,
          navH: b.offsetHeight,
          navOpacity: 1,
        }
      : { navOpacity: 0 };
    if (instant) physics.to(next, true);
    else if (c.profile.id === "flux") physics.flow(next);
    else physics.to(next);
  }
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useLayoutEffect(() => {
    layout(initial.current);
    initial.current = false;
  }, [value, !!c]);
  useLayoutEffect(() => {
    if (!c || !ref.current) return;
    let first = true;
    const resize = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      layoutRef.current(false);
    });
    resize.observe(ref.current);
    ref.current.querySelectorAll("button, a").forEach((b) => resize.observe(b));
    return () => resize.disconnect();
  }, [!!c]);
  return (
    <nav
      ref={ref}
      aria-label={label}
      className={`${className} ${c ? "living-navigation" : ""}`}
    >
      {c && (
        <span className="nav-material-pill" ref={pill} aria-hidden="true" />
      )}
      {children}
    </nav>
  );
}
