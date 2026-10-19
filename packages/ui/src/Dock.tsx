import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { drag, project, rubber } from '@qubite/motion';
import { feelOf, scaled } from './feel';
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
 * Подсветку раздела можно тащить пальцем и смахивать: отпустил — открылся раздел под ней,
 * быстрый свайп — соседний раздел. Escape или прокрутка посреди жеста возвращают её на место.
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

  /* «желе»: строка доехала — капля сплющивается и раскачивается, отскок видно глазом */
  const jel = useSpring(0, 0.7, (x) => {
    if (host.current)
      host.current.style.scale =
        x === 0 ? '' : `${(1 + 0.04 * x).toFixed(4)} ${(1 - 0.14 * x).toFixed(4)}`;
  });
  const fo = useSpring(open ? 1 : 0, 0.7, (x) => {
    const v = Math.min(1, Math.max(0, x));
    if (field.current) {
      field.current.style.opacity = v.toFixed(3);
      // без обрезки: содержимое строки въезжает с перелётом и пружинит назад
      field.current.style.transform = `translateX(${((1 - x) * 56).toFixed(1)}px) scale(${(0.92 + 0.08 * x).toFixed(4)})`;
    }
    if (cmdBtn.current) cmdBtn.current.style.opacity = Math.max(0, 1 - v * 1.6).toFixed(3);
    items.forEach((it, i) => {
      const b = btns.current.get(it.id);
      if (!b) return;
      const keep = it.id === geo.current.current;
      b.style.opacity = keep ? '1' : Math.max(0, 1 - v * 1.8).toFixed(3);
      b.style.pointerEvents = v > 0.5 && !keep ? 'none' : '';
      const x = keep ? geo.current.x0(i) * (1 - v) + 4 * v : geo.current.x0(i);
      // свойство translate, а не transform: нажатие (usePress) и «вздрагивание» (flyDot) пишут scale,
      // а scale умножает transform — иконка при нажатии уезжала влево тем сильнее, чем правее стоит
      b.style.translate = `${x.toFixed(2)}px`;
    });
  });

  /* ширина капли — от экрана */
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    // ширина меняется и без изменения окна (появилась полоса прокрутки) — следим за самой каплей
    // настоящая ширина, без «желе»: getBoundingClientRect учёл бы покачивание (scale),
    // и иконки разъезжались бы — правые сильнее левых
    const measure = () => setW(el.offsetWidth);
    measure();
    if (typeof ResizeObserver !== 'function') {
      addEventListener('resize', measure);
      return () => removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
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
    // тот же характер, что у подложки («Пружинистый»): ведущий край лёгкий, хвост тяжелее
    const f = feelOf('flow');
    if (open) {
      L.to(cA, opened.ca, scaled(f, 0.69));
      L.to(cB, opened.cb, f);
      setTimeout(() => {
        L.to(nA, opened.na, f);
        L.to(nB, opened.nb, scaled(f, 1.375));
        ind.to(8, 52);
      }, 40);
    } else {
      L.to(nB, closed.nb, scaled(f, 0.75));
      setTimeout(() => {
        L.to(cA, closed.ca, scaled(f, 1.375));
        L.to(cB, closed.cb, f);
      }, 40);
      const i = items.findIndex((it) => it.id === current);
      const cx = x0(i) + ITEM / 2;
      ind.to(cx - 24, cx + 24);
    }
    L.to(fo, open ? 1 : 0, scaled(f, 0.875));
    const t = setTimeout(() => {
      L.to(jel, 0, f);
      L.kick(jel, open ? 15 : 11);
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, W]);

  /* подсветку раздела тащат пальцем или смахивают */
  const dragged = useRef(false);
  const live = useRef({ items, current, onGo, open, W });
  live.current = { items, current, onGo, open, W };
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let from = 0;
    let c = 0;
    const center = (i: number) => geo.current.x0(i) + ITEM / 2;
    const back = () => {
      const i = live.current.items.findIndex((it) => it.id === live.current.current);
      ind.to(center(i) - 24, center(i) + 24);
    };
    const h = drag(el, {
      axis: 'x',
      // только по разделам и только когда строка Command закрыта
      filter: (e) =>
        !live.current.open &&
        e.clientX - el.getBoundingClientRect().left < live.current.W - H - GAP,
      onDown: () => (dragged.current = false),
      onStart: () => {
        dragged.current = true;
        from = center(live.current.items.findIndex((it) => it.id === live.current.current));
      },
      onMove: ({ dx }) => {
        const n = live.current.items.length;
        c = rubber(from + dx, center(0), center(n - 1), 18);
        ind.hold(c - 24, c + 24);
      },
      onEnd: ({ vx }) => {
        const { items: its, current: cur, onGo: go } = live.current;
        const n = its.length;
        const now = its.findIndex((it) => it.id === cur);
        const goal = project(c, vx, 0.985);
        let i = 0;
        for (let j = 1; j < n; j++)
          if (Math.abs(center(j) - goal) < Math.abs(center(i) - goal)) i = j;
        // быстрый свайп, но не дотянул до соседа — всё равно соседний раздел
        if (i === now && Math.abs(vx) > 450) i = Math.min(n - 1, Math.max(0, now + Math.sign(vx)));
        ind.hold(c - 24, c + 24, vx);
        if (i === now) back();
        else go(its[i]!.id);
      },
      onCancel: back,
    });
    return () => h.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <nav
      ref={host}
      className={open ? 'q-dock q-open' : 'q-dock'}
      aria-label="Разделы"
      // каждый раздел ловит нажатие на всей своей доле капли, а не только на иконке
      style={{ '--q-slot': `${step}px` } as CSSProperties}
    >
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
          onClick={() => {
            if (dragged.current) return; // раздел уже выбран жестом
            if (open) onOpenChange(false);
            else onGo(it.id);
          }}
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
