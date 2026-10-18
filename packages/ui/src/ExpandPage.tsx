import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { loop, useSpring } from './useSpring';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ExpandPageProps {
  open: boolean;
  /** откуда вырастает страница: прямоугольник строки (меряется при открытии и закрытии) */
  from: () => DOMRect | null;
  /** куда раскрывается */
  dest: () => Rect;
  /** назад: по кнопке или Escape */
  onClose: () => void;
  label: string;
  children: ReactNode;
}

/**
 * Строка раскрывается в страницу: подложка растёт из прямоугольника строки до страницы,
 * содержимое проявляется следом. При закрытии — обратно в ту же строку.
 * Движутся только transform подложки и opacity/transform содержимого.
 */
export function ExpandPage({ open, from, dest, onClose, label, children }: ExpandPageProps) {
  const bg = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLElement>(null);
  const geo = useRef<{ f: DOMRect; d: Rect } | null>(null);
  const [visible, setVisible] = useState(false);
  const draw = () => {
    const g = geo.current;
    const b = bg.current;
    const p = page.current;
    if (!g || !b || !p) return;
    const k = pm.x;
    const a = 1 - k;
    const sx = g.f.width / g.d.w;
    const sy = g.f.height / g.d.h;
    b.style.transform = `translate(${(g.f.left * a + g.d.x * k).toFixed(2)}px, ${(g.f.top * a + g.d.y * k).toFixed(2)}px) scale(${(sx * a + k).toFixed(4)}, ${(sy * a + k).toFixed(4)})`;
    p.style.opacity = Math.min(1, Math.max(0, pc.x)).toFixed(3);
    p.style.transform = `translateY(${((1 - pc.x) * 16).toFixed(2)}px)`;
    if (k < 0.02 && pm.goal === 0 && pc.goal === 0) {
      geo.current = null;
      setVisible(false);
    }
  };
  const pm = useSpring(0, 1.1, draw);
  const pc = useSpring(0, 0.7, draw);

  /* открыли — сразу показываем слой (так React советует менять состояние от пропса) */
  if (open && !visible) setVisible(true);

  useLayoutEffect(() => {
    const L = loop();
    if (open) {
      const f = from();
      if (!f) return;
      const d = dest();
      geo.current = { f, d };
      const b = bg.current;
      const p = page.current;
      if (b) Object.assign(b.style, { width: `${d.w}px`, height: `${d.h}px` });
      if (p) {
        Object.assign(p.style, {
          left: `${d.x}px`,
          top: `${d.y}px`,
          width: `${d.w}px`,
          height: `${d.h}px`,
        });
        p.scrollTop = 0;
      }
      L.set(pm, 0);
      L.set(pc, 0);
      L.to(pm, 1);
      const t = setTimeout(() => L.to(pc, 1), L.reduced ? 0 : 140);
      return () => clearTimeout(t);
    }
    if (!geo.current) return;
    const f = from();
    if (f) geo.current.f = f;
    L.to(pc, 0);
    const t = setTimeout(() => L.to(pm, 0), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [open, onClose]);

  /* в body: предок с transform сломал бы position: fixed */
  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      <div ref={bg} className="q-page-bg" style={{ display: visible ? 'block' : 'none' }} />
      <article
        ref={page}
        className="q-page"
        aria-label={label}
        style={{ display: visible ? 'block' : 'none', opacity: 0 }}
      >
        {visible && children}
      </article>
    </>,
    document.body,
  );
}
