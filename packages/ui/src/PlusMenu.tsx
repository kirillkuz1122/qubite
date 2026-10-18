import { MASS } from '@qubite/motion';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DotIcon } from './icons';
import { usePress } from './press';
import type { ColorName } from './tokens';
import { loop, useSpring } from './useSpring';

export interface PlusItem {
  /** что вставить в строку, например «/д » */
  value: string;
  label: string;
  color: ColorName;
  /** подсказка клавиш справа */
  kbd?: string;
}

export interface PlusMenuProps {
  items: PlusItem[];
  onPick: (item: PlusItem) => void;
  /** сообщить наружу, открыто ли меню */
  onOpenChange?: (open: boolean) => void;
}

/**
 * «+» раскрывается в меню: подложка вырастает из самой кнопки, пункты выезжают по очереди,
 * плюс поворачивается в крестик. Закрывается по фону, Escape или выбору.
 */
export function PlusMenu({ items, onPick, onOpenChange }: PlusMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 8, bottom: 80, origin: '20px 100%' });
  const press = usePress(0.84);
  const menu = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const icon = useRef<HTMLSpanElement>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const draw = () => {
    if (menu.current)
      menu.current.style.visibility = mx.x > 0.005 || my.x > 0.005 ? 'visible' : 'hidden';
    if (bg.current)
      bg.current.style.transform = `scale(${Math.max(0, mx.x).toFixed(4)}, ${Math.max(0, my.x).toFixed(4)})`;
    if (icon.current) icon.current.style.transform = `rotate(${(rot.x * 45).toFixed(2)}deg)`;
    if (veil.current) veil.current.style.opacity = Math.min(1, Math.max(0, vo.x)).toFixed(3);
    rows.current.forEach((r, i) => {
      const v = its[i]?.x ?? 0;
      if (!r) return;
      r.style.opacity = Math.min(1, Math.max(0, v)).toFixed(3);
      r.style.transform = `translateY(${((1 - v) * 16).toFixed(2)}px)`;
    });
  };
  const mx = useSpring(0, 0.75, draw);
  const my = useSpring(0, 1.3, draw);
  const rot = useSpring(0, MASS.dot + 0.05, draw);
  const vo = useSpring(0, MASS.dot + 0.05, draw);
  const [its] = useState(() => items.map(() => loop().spring(0, 0.7)));
  useEffect(() => {
    const d = loop().render(draw);
    its.forEach((s) => (s.onChange = d));
    d();
  });

  function set(v: boolean, btn?: HTMLElement | null) {
    if (v === open) return;
    if (v && btn) {
      const r = btn.getBoundingClientRect();
      const left = Math.max(8, r.left - 4);
      setPos({
        left,
        bottom: innerHeight - r.top + 14,
        origin: `${r.left - left + r.width / 2}px calc(100% + ${r.height / 2 + 14}px)`,
      });
    }
    setOpen(v);
    onOpenChange?.(v);
    const L = loop();
    const g = v ? 1 : 0;
    L.to(mx, g);
    L.to(my, g);
    L.to(rot, g);
    L.to(vo, g);
    its.forEach((_, i) => {
      const idx = v ? its.length - 1 - i : i;
      setTimeout(() => L.to(its[idx]!, g), v ? 60 + i * 40 : i * 12);
    });
  }
  const setRef = useRef(set);
  setRef.current = set;
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setRef.current(false);
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [open]);

  return (
    <>
      <button
        {...press}
        type="button"
        className="q-plus"
        aria-label="Создать"
        aria-expanded={open}
        onPointerDown={(e) => {
          e.preventDefault();
          press.onPointerDown(e);
        }}
        onClick={(e) => set(!open, e.currentTarget)}
      >
        <span ref={icon} className="q-plus-ico">
          <DotIcon name="plus" size={18} />
        </span>
      </button>
      {typeof document !== 'undefined' &&
        createPortal(
          <>
            <div
              ref={veil}
              className="q-veil"
              style={{ pointerEvents: open ? 'auto' : 'none' }}
              onClick={() => set(false)}
            />
            <div
              ref={menu}
              className="q-menu"
              role="menu"
              aria-hidden={!open}
              style={{ left: pos.left, bottom: pos.bottom }}
            >
              <div ref={bg} className="q-menu-bg" style={{ transformOrigin: pos.origin }} />
              {items.map((it, i) => (
                <button
                  key={it.value}
                  ref={(el) => void (rows.current[i] = el)}
                  type="button"
                  role="menuitem"
                  tabIndex={open ? 0 : -1}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => {
                    set(false);
                    onPick(it);
                  }}
                >
                  <span className="q-dot" style={{ background: `var(--q-${it.color})` }} />
                  {it.label}
                  {it.kbd && <kbd>{it.kbd}</kbd>}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
