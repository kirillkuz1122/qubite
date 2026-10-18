import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useFlow } from './Flow';
import { DotIcon, type IconName } from './icons';
import { usePress } from './press';
import { loop, useSpring } from './useSpring';

export interface NavItem<T extends string = string> {
  id: T;
  label: string;
  icon: IconName;
  /** число справа (ПК) или точка-метка (телефон); 0 — ничего */
  count?: number;
  /** на телефоне показывать метку только у этих пунктов */
  badge?: boolean;
}

export interface DockProps<T extends string> {
  items: NavItem<T>[];
  current: T;
  onGo: (id: T) => void;
  /** раскрыта ли строка Command */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** содержимое строки Command (плюс, поле, микрофон) */
  children: ReactNode;
}

const H = 60;
const GAP = 8;
const ITEM = 52;

/**
 * Нижняя «капля» на телефоне: разделы и кнопка Command — две пилюли в одном слое.
 * По нажатию на Command строка вытекает влево, разделы догоняют и сжимаются в точку текущего раздела.
 */
export function Dock<T extends string>({
  items,
  current,
  onGo,
  open,
  onOpenChange,
  children,
}: DockProps<T>) {
  const host = useRef<HTMLElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const cmdBtn = useRef<HTMLButtonElement>(null);
  const btns = useRef(new Map<T, HTMLButtonElement>());
  const [W, setW] = useState(0);
  const nav = useFlow(H, 0, { className: 'q-dock-body' });
  const cmd = useFlow(H, 0, { className: 'q-dock-body' });
  const ind = useFlow(44, 8, { className: 'q-dock-ind' });
  const cmdPress = usePress(0.84);

  const closed = { na: 0, nb: W - H - GAP, ca: W - H, cb: W };
  const opened = { na: 0, nb: H, ca: H + GAP, cb: W };
  const step = closed.nb / Math.max(1, items.length);
  const x0 = (i: number) => step * (i + 0.5) - ITEM / 2;
  const geo = useRef({ x0, current, opened });
  geo.current = { x0, current, opened };

  const fo = useSpring(open ? 1 : 0, 0.7, (x) => {
    const v = Math.min(1, Math.max(0, x));
    if (field.current) {
      field.current.style.opacity = v.toFixed(3);
      field.current.style.transform = `translateX(${((1 - v) * 30).toFixed(1)}px)`;
    }
    if (cmdBtn.current) cmdBtn.current.style.opacity = Math.max(0, 1 - v * 1.6).toFixed(3);
    items.forEach((it, i) => {
      const b = btns.current.get(it.id);
      if (!b) return;
      const keep = it.id === geo.current.current;
      b.style.opacity = keep ? '1' : Math.max(0, 1 - v * 1.8).toFixed(3);
      b.style.pointerEvents = v > 0.5 && !keep ? 'none' : '';
      const x = keep ? geo.current.x0(i) * (1 - v) + 4 * v : geo.current.x0(i);
      b.style.transform = `translateX(${x.toFixed(2)}px)`;
    });
  });

  /* ширина капли — от экрана */
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setW(el.getBoundingClientRect().width);
    measure();
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, []);

  /* новая ширина: всё ставим на места сразу */
  useLayoutEffect(() => {
    if (!W) return;
    const g = open ? opened : closed;
    nav.to(g.na, g.nb, true);
    cmd.to(g.ca, g.cb, true);
    fo.emit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W]);

  /* подсветка — к текущему разделу */
  const first = useRef(true);
  useLayoutEffect(() => {
    if (!W) return;
    const i = items.findIndex((it) => it.id === current);
    const cx = (open ? 4 : x0(i)) + ITEM / 2;
    ind.to(cx - 24, cx + 24, first.current);
    first.current = false;
    fo.emit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, W]);

  /* раскрытие и закрытие строки */
  const was = useRef(open);
  useEffect(() => {
    if (was.current === open || !W) return;
    was.current = open;
    const L = loop();
    const { A: nA, B: nB } = nav.edges;
    const { A: cA, B: cB } = cmd.edges;
    if (open) {
      cA.m = 0.55;
      L.to(cA, opened.ca);
      L.to(cB, opened.cb);
      setTimeout(() => {
        nB.m = 1.1;
        L.to(nA, opened.na);
        L.to(nB, opened.nb);
        ind.to(8, 52);
      }, 40);
    } else {
      nB.m = 0.6;
      L.to(nB, closed.nb);
      setTimeout(() => {
        cA.m = 1.1;
        L.to(cA, closed.ca);
        L.to(cB, closed.cb);
      }, 40);
      const i = items.findIndex((it) => it.id === current);
      const cx = x0(i) + ITEM / 2;
      ind.to(cx - 24, cx + 24);
    }
    L.to(fo, open ? 1 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, W]);

  return (
    <nav ref={host} className={open ? 'q-dock q-open' : 'q-dock'} aria-label="Разделы">
      {nav.node}
      {cmd.node}
      {ind.node}
      {items.map((it) => (
        <DockButton
          key={it.id}
          item={it}
          on={it.id === current}
          setRef={(el) => {
            if (el) btns.current.set(it.id, el);
            else btns.current.delete(it.id);
          }}
          onClick={() => (open ? onOpenChange(false) : onGo(it.id))}
        />
      ))}
      <button
        {...cmdPress}
        ref={(el) => {
          cmdPress.ref.current = el;
          cmdBtn.current = el;
        }}
        className="q-dock-cmd"
        type="button"
        aria-label="Открыть Command"
        tabIndex={open ? -1 : 0}
        onClick={() => onOpenChange(true)}
      >
        <DotIcon name="search" />
      </button>
      <div
        ref={field}
        className="q-dock-field"
        style={{ left: opened.ca, width: Math.max(0, opened.cb - opened.ca), opacity: 0 }}
        aria-hidden={!open}
      >
        {children}
      </div>
    </nav>
  );
}

function DockButton<T extends string>({
  item,
  on,
  setRef,
  onClick,
}: {
  item: NavItem<T>;
  on: boolean;
  setRef: (el: HTMLButtonElement | null) => void;
  onClick: () => void;
}) {
  const press = usePress(0.84);
  return (
    <button
      {...press}
      ref={(el) => {
        press.ref.current = el;
        setRef(el);
      }}
      type="button"
      className={on ? 'q-navb q-on' : 'q-navb'}
      aria-label={item.label}
      aria-current={on ? 'page' : undefined}
      data-nav-target={item.id}
      onClick={onClick}
    >
      <DotIcon name={item.icon} />
      {item.badge && !!item.count && <span className="q-badge" aria-hidden="true" />}
    </button>
  );
}
