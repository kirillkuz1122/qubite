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
  /** Закреплённая нижняя панель; содержимое окна прокручивается над ней. */
  footer?: ReactNode;
}

const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [contenteditable]:not([contenteditable="false"]), [tabindex]';

/**
 * На что Tab действительно встанет внутри окна: без недоступных, скрытых (`hidden`, `inert`,
 * `display: none`, `visibility: hidden`) и снятых с обхода (`tabindex="-1"`) элементов.
 * Иначе недоступная последняя кнопка считалась «последней», и фокус уходил на страницу (DS-013).
 */
export function tabbable(box: HTMLElement): HTMLElement[] {
  return [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.tabIndex < 0 || (el as HTMLButtonElement).disabled) return false;
    if (el.closest('[hidden], [inert], fieldset:disabled')) return false;
    if (getComputedStyle(el).visibility === 'hidden') return false;
    for (let n: HTMLElement | null = el; n && n !== box; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') return false;
    }
    return true;
  });
}

/** Окно — верхнее из открытых: Tab и возврат фокуса ведёт только оно. */
function isTop(box: HTMLElement): boolean {
  const wraps = document.querySelectorAll('.q-sheet-wrap');
  return wraps[wraps.length - 1] === box.parentElement;
}

/** Элемент лежит на странице под окном (а не в меню, открытом из самого окна). */
function isBehind(box: HTMLElement, el: Element | null): boolean {
  if (!el || el === document.body || !box.parentElement) return true;
  if (box.contains(el)) return false;
  return !!(box.parentElement.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
}

/**
 * Модальное окно «Частиц» (DS-008, D-431): на ПК вырастает в центре экрана, на телефоне —
 * нижний лист. Фон затемняется, Escape и нажатие мимо закрывают, фокус возвращается туда,
 * откуда открыли. Двигаются только opacity и transform.
 */
export function Sheet({ open, onClose, title, className, children, footer }: SheetProps) {
  const wide = useMedia(WIDE);
  const id = useId();
  const veil = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const focus = useRef<{ back: Element | null; inside: HTMLElement | null } | null>(null);
  // До commit: autoFocus у дочернего поля сработает раньше нашего layout-эффекта.
  if (open && !focus.current && typeof document !== 'undefined') {
    focus.current = { back: document.activeElement, inside: null };
  } else if (!open) {
    focus.current = null;
  }
  const returnTo = useRef<Element | null>(null);
  const [alive, setAlive] = useState(open);
  const live = useRef(open);
  const kept = useRef({ children, footer });
  if (open) kept.current = { children, footer };
  const hasFooter = kept.current.footer != null;
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
    const session = focus.current;
    if (!open || !session) {
      // React возвращает фокус на поле, бывшее в фокусе до коммита, уже после
      // очистки прошлого эффекта; поэтому возврат на кнопку делаем здесь, уже после него.
      if (!open && returnTo.current instanceof HTMLElement) {
        returnTo.current.focus({ preventScroll: true });
      }
      returnTo.current = null;
      return;
    }
    returnTo.current = session.back;
    const b = box.current;
    if (b && !b.contains(document.activeElement)) {
      // Сохраняем выбранное поле и при повторном запуске эффекта в StrictMode.
      const first =
        session.inside && b.contains(session.inside)
          ? session.inside
          : (b.querySelector<HTMLElement>('[autofocus]') ?? b);
      first.focus({ preventScroll: true });
    }
    session.inside = b?.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : null;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      } else if (e.key === 'Tab' && b && isTop(b)) {
        const all = tabbable(b);
        const now = document.activeElement;
        const a = all[0];
        const z = all[all.length - 1];
        if (!a || !z) {
          // в окне не на что встать — фокус остаётся на самом окне
          e.preventDefault();
          b.focus({ preventScroll: true });
        } else if (now === b || isBehind(b, now)) {
          e.preventDefault();
          (e.shiftKey ? z : a).focus();
        } else if (e.shiftKey && now === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && now === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    /* Фокус попал на страницу под окном (например, вернулся из адресной строки) — обратно в окно. */
    const pull = (e: FocusEvent) => {
      if (!b || !isTop(b) || !(e.target instanceof Element) || !isBehind(b, e.target)) return;
      const to = session.inside && b.contains(session.inside) ? session.inside : b;
      to.focus({ preventScroll: true });
    };
    const keep = (e: FocusEvent) => {
      if (b && e.target instanceof HTMLElement && b.contains(e.target)) session.inside = e.target;
    };
    document.addEventListener('focusin', pull);
    b?.addEventListener('focusin', keep);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('focusin', pull);
      b?.removeEventListener('focusin', keep);
      if (session.back instanceof HTMLElement) session.back.focus({ preventScroll: true });
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
        className={['q-sheet', hasFooter && 'q-sheet-with-footer', className]
          .filter(Boolean)
          .join(' ')}
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
        <div className="q-sheet-body">{kept.current.children}</div>
        {hasFooter && <div className="q-sheet-footer">{kept.current.footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
