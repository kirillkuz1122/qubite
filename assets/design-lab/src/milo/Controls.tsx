import {
  useContext,
  useLayoutEffect,
  useRef,
  useState,
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
      {...props}
      {...motion.handlers}
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
  const dragging = useRef(false);
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
    dragging.current = false;
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
          e.preventDefault();
          e.currentTarget.focus();
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          point(e);
          physics.to({ grip: c?.quiet ? 0 : 1 });
        }}
        onPointerMove={(e) => {
          if (dragging.current) point(e);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={() => {
          dragging.current = false;
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
  const drag = useRef<{ x: number; moved: boolean; value: number } | null>(
    null,
  );
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
          if (e.button !== 0) return;
          consumed.current = false;
          drag.current = { x: e.clientX, moved: false, value: checked ? 1 : 0 };
          e.currentTarget.setPointerCapture(e.pointerId);
          physics.to({ grip: c?.quiet ? 0 : 1 });
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
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
          if (d?.moved) {
            consumed.current = true;
            onChange(d.value > 0.5);
          }
          cancel();
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
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
  const physics = usePhysics(pill, { pillX: 0, pillWidth: 100, pillPull: 0 });
  const initial = useRef(true);
  const drag = useRef<{
    x: number;
    left: number;
    target: string;
    moved: boolean;
  } | null>(null);
  const consumed = useRef(false);
  function selected() {
    return ref.current?.querySelector<HTMLButtonElement>(
      `button[data-id="${value}"]`,
    );
  }
  function layout(instant = false) {
    const b = selected();
    if (b)
      physics.to(
        { pillX: b.offsetLeft, pillWidth: b.offsetWidth, pillPull: 0 },
        instant,
      );
  }
  useLayoutEffect(() => {
    layout(initial.current);
    initial.current = false;
    const resize = new ResizeObserver(() => layout(true));
    if (ref.current) resize.observe(ref.current);
    return () => resize.disconnect();
  }, [value, items.length]);
  const c = useContext(MotionContext);
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
            if (e.button !== 0) return;
            consumed.current = false;
            const b = selected();
            drag.current = {
              x: e.clientX,
              left: b?.offsetLeft || 0,
              target: value,
              moved: false,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || !ref.current) return;
            const r = ref.current.getBoundingClientRect();
            const dx = e.clientX - d.x;
            d.moved ||= Math.abs(dx) > 8;
            const buttons = Array.from(
              ref.current.querySelectorAll<HTMLButtonElement>("button"),
            );
            const target = buttons.find((b) => {
              const q = b.getBoundingClientRect();
              return e.clientX >= q.left && e.clientX <= q.right;
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
                pillPull: Math.max(-1, Math.min(1, dx / 80)),
              });
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            if (d?.moved) {
              consumed.current = true;
              onChange(d.target);
            }
            drag.current = null;
            layout();
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            consumed.current = true;
            drag.current = null;
            layout();
          }}
          onLostPointerCapture={() => {
            drag.current = null;
            layout();
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
}: {
  children: ReactNode;
  value: string;
  label: string;
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
  useLayoutEffect(() => {
    if (!c) return;
    const layout = (instant = false) => {
      const b = ref.current?.querySelector<HTMLButtonElement>(
        'button[aria-current="page"]',
      );
      physics.to(
        b
          ? {
              navX: b.offsetLeft,
              navY: b.offsetTop,
              navW: b.offsetWidth,
              navH: b.offsetHeight,
              navOpacity: 1,
            }
          : { navOpacity: 0 },
        instant,
      );
    };
    layout(initial.current);
    initial.current = false;
    const resize = new ResizeObserver(() => layout(true));
    if (ref.current) resize.observe(ref.current);
    return () => resize.disconnect();
  }, [value, !!c]);
  return (
    <nav ref={ref} aria-label={label} className={c ? "living-navigation" : ""}>
      {c && (
        <span className="nav-material-pill" ref={pill} aria-hidden="true" />
      )}
      {children}
    </nav>
  );
}
export function ExpandingMenu() {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState("Новая мысль");
  return (
    <div className={`expanding-material ${open ? "expanded" : ""}`}>
      <LivingButton
        aria-expanded={open}
        aria-controls="expanding-actions"
        onClick={() => setOpen(!open)}
      >
        {chosen}
        <span>{open ? "−" : "+"}</span>
      </LivingButton>
      <div
        className="expanding-content"
        id="expanding-actions"
        inert={!open}
        aria-hidden={!open}
      >
        <div>
          {["Заметка", "Задача", "Дневник"].map((s, i) => (
            <LivingButton
              key={s}
              style={{ "--order": i } as React.CSSProperties}
              onClick={() => {
                setChosen(s);
                setOpen(false);
              }}
            >
              {s}
              <span>↗</span>
            </LivingButton>
          ))}
        </div>
      </div>
    </div>
  );
}
