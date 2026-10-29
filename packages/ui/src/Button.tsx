import { drag, loop, rubber } from '@qubite/motion';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { feelOf } from './feel';
import { useSpring } from './useSpring';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** fill — оранжевая заливка (главное действие), outline — рамка */
  variant?: 'fill' | 'outline';
  size?: 'md' | 'sm';
  /** точка перед текстом */
  dot?: boolean;
  children: ReactNode;
}

/** Если палец ушёл от кнопки дальше этого — нажатие отменяется. */
const LEAVE = 48;

/**
 * Кнопка: под пальцем сжимается, тянется за пальцем (резинкой) и пружинит обратно.
 * Увёл палец далеко или нажал Escape — нажатие отменяется, кнопка возвращается без щелчка.
 */
export function Button({
  variant = 'outline',
  size = 'md',
  dot = true,
  className,
  children,
  onClickCapture,
  disabled = false,
  'aria-disabled': ariaDisabled,
  ...rest
}: ButtonProps) {
  const unavailable = disabled || ariaDisabled === true || ariaDisabled === 'true';
  const ref = useRef<HTMLButtonElement>(null);
  const draw = () => {
    const el = ref.current;
    if (!el) return;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
      el.style.transform = '';
      return;
    }
    const stretch = Math.min(0.06, Math.abs(tx.x) * 0.006);
    el.style.transform =
      sc.x === 1 && tx.x === 0 && ty.x === 0
        ? ''
        : `translate(${tx.x.toFixed(2)}px, ${ty.x.toFixed(2)}px) scale(${(sc.x * (1 + stretch)).toFixed(4)}, ${(sc.x * (1 - stretch / 2)).toFixed(4)})`;
  };
  const sc = useSpring(1, 0.6, draw);
  const tx = useSpring(0, 0.6, draw);
  const ty = useSpring(0, 0.6, draw);
  const muted = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const L = loop();
    if (unavailable) {
      muted.current = false;
      L.set(sc, 1);
      L.set(tx, 0);
      L.set(ty, 0);
      el.style.transform = '';
      return;
    }
    const home = (bounce: boolean) => {
      const f = feelOf('button');
      L.to(sc, 1, f);
      L.to(tx, 0, f);
      L.to(ty, 0, f);
      if (bounce) L.kick(sc, 1.2);
    };
    const away = () => {
      muted.current = true;
      home(false);
    };
    const h = drag(el, {
      onDown: (_, e) => {
        muted.current = false;
        // палец «захвачен» сразу: кнопка сжимается, но отпускание у края всё равно попадёт в неё
        try {
          el.setPointerCapture?.(e.pointerId ?? 1);
        } catch {
          /* без захвата тоже работает */
        }
        L.to(sc, 0.9, feelOf('button'));
      },
      onMove: ({ dx, dy }) => {
        if (muted.current) return;
        if (Math.hypot(dx, dy) > LEAVE + el.offsetWidth / 2) {
          away();
          return;
        }
        // кнопка тянется за пальцем, но не дальше нескольких пикселей
        L.hold(tx, rubber(dx * 0.2, 0, 0, 6));
        L.hold(ty, rubber(dy * 0.2, 0, 0, 4));
      },
      onEnd: () => home(!muted.current),
      onTap: () => home(true),
      onCancel: away,
    });
    return () => h.destroy();
  }, [sc, tx, ty, unavailable]);

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-disabled={ariaDisabled}
      className={['q-btn', variant === 'fill' && 'q-fill', size === 'sm' && 'q-sm', className]
        .filter(Boolean)
        .join(' ')}
      onClickCapture={(e) => {
        if (unavailable) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // нажатие отменили (увели палец, Escape) — щелчка нет
        if (muted.current && e.detail > 0) {
          muted.current = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onClickCapture?.(e);
      }}
      {...rest}
    >
      {dot && <span className="q-dot" aria-hidden="true" />}
      {children}
    </button>
  );
}
