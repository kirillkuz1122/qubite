import { MASS } from '@qubite/motion';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { WIDE, useMedia } from './media';
import { loop, useSpring } from './useSpring';

export interface SheetProps {
  /** открыто ли окно; false — окно уходит пружиной и только потом пропадает */
  open: boolean;
  /** закрыть: крестик, Escape, нажатие мимо окна */
  onClose: () => void;
  /** заголовок окна (он же подпись для экранного диктора) */
  title: string;
  className?: string;
  children: ReactNode;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Модальное окно «Частиц» (DS-008, D-431): на ПК вырастает в центре экрана, на телефоне —
 * нижний лист. Фон затемняется, Escape и нажатие мимо закрывают, фокус возвращается туда,
 * откуда открыли. Двигаются только opacity и transform.
 */
export function Sheet({ open, onClose, title, className, children }: SheetProps) {
  const wide = useMedia(WIDE);
  const id = useId();
  const veil = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [alive, setAlive] = useState(open);
  const live = useRef(open);
  const kept = useRef<ReactNode>(children);
  if (open) kept.current = children;
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  const s = useSpring(0, MASS.sheet, (v) => {
    const k = Math.min(1, Math.max(0, v));
    if (veil.current) veil.current.style.opacity = k === 1 ? '' : k.toFixed(3);
    const b = box.current;
    if (b) {
      b.style.opacity = k === 1 ? '' : k.toFixed(3);
      b.style.transform =
        v === 1
          ? ''
          : b.dataset.wide
            ? `translateY(${((1 - v) * 16).toFixed(2)}px) scale(${(0.95 + 0.05 * v).toFixed(4)})`
            : `translateY(${((1 - v) * 100).toFixed(2)}%)`;
    }
    if (s.goal === 0 && v < 0.02 && live.current) {
      live.current = false;
      setAlive(false);
    }
  });

  if (open && !alive) {
    live.current = true;
    setAlive(true);
  }
  useEffect(() => {
    if (alive) loop().to(s, open ? 1 : 0);
  }, [open, alive, s]);

  /* фокус внутрь окна и обратно; Escape и Tab по кругу */
  useLayoutEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    const b = box.current;
    const first = b?.querySelector<HTMLElement>('[autofocus]') ?? b;
    first?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      } else if (e.key === 'Tab' && b) {
        const all = [...b.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hidden);
        if (!all.length) return;
        const a = all[0]!;
        const z = all[all.length - 1]!;
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      back?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!alive || typeof document === 'undefined') return null;
  return createPortal(
    <div className={wide ? 'q-sheet-wrap q-wide' : 'q-sheet-wrap'}>
      <div
        ref={veil}
        className="q-sheet-veil"
        style={{ opacity: 0 }}
        onPointerDown={() => close.current()}
      />
      <div
        ref={box}
        className={['q-sheet', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        data-wide={wide ? '1' : undefined}
        style={{ opacity: 0 }}
      >
        <div className="q-sheet-head">
          <h2 id={id}>{title}</h2>
          <button
            type="button"
            className="q-sheet-x"
            aria-label="Закрыть"
            onClick={() => close.current()}
          >
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              {[3, 6.5, 10, 13.5, 17].map((p) => (
                <g key={p}>
                  <circle cx={p} cy={p} r={1.3} />
                  {p !== 10 && <circle cx={p} cy={20 - p} r={1.3} />}
                </g>
              ))}
            </svg>
          </button>
        </div>
        <div className="q-sheet-body">{kept.current}</div>
      </div>
    </div>,
    document.body,
  );
}
