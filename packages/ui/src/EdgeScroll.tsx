/**
 * Своя прокрутка вместо системной полосы (DS-002, D-184). У правого края — столбик точек:
 * по точке на каждый заголовок страницы и оранжевая точка «ты здесь». Зажал край пальцем
 * (на ПК — навёл мышь) — точки вытягиваются в линии и рядом выезжают названия заголовков.
 * Ведёшь палец — страница пружиной переезжает к ближайшему заголовку; нажал — прыжок к нему.
 */
import { drag, MASS } from '@qubite/motion';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { feelOf } from './feel';
import { loop, useSpring } from './useSpring';

export interface EdgeScrollProps {
  /** какие заголовки показывать (по умолчанию — все h2 на странице) */
  selector?: string;
  /** отступ сверху, на котором встаёт заголовок после прыжка, px */
  offset?: number;
  /** сколько места оставить снизу (над нижней каплей на телефоне), px */
  bottom?: number;
}

/** Вся страница едет без отскока: качание целого экрана выглядит как рывок. */
const PAGE = { mass: 0.6, damping: 23 };

interface Mark {
  label: string;
  /** где заголовок в документе, px */
  y: number;
  /** куда доедет страница, если выбрать этот заголовок (последние упираются в конец), px */
  t: number;
  /** где его точка на столбике, 0…1: та же доля, что у «ты здесь» на этой прокрутке */
  at: number;
}

export function EdgeScroll({ selector = 'h2', offset = 84, bottom = 24 }: EdgeScrollProps) {
  const box = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [hot, setHot] = useState(-1);
  const [opened, setOpened] = useState(false);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const hotRef = useRef(hot);
  hotRef.current = hot;

  /* раскрытие: линии вытягиваются, названия выезжают */
  const op = useSpring(0, MASS.pill, (v) => {
    const el = box.current;
    if (!el) return;
    el.style.setProperty('--open', Math.max(0, v).toFixed(3));
    if (labels.current) {
      labels.current.style.opacity = Math.min(1, Math.max(0, v)).toFixed(3);
      labels.current.style.transform = `translateX(${((1 - v) * 24).toFixed(2)}px)`;
    }
  });
  /* прокрутка страницы к заголовку — пружиной */
  const sc = useSpring(0, MASS.sheet, (y) => {
    if (driving.current) window.scrollTo(0, y);
  });
  const driving = useRef(false);

  const read = useCallback(() => {
    if (typeof document === 'undefined') return;
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const next: Mark[] = [];
    document.querySelectorAll<HTMLElement>(selector).forEach((h) => {
      const label = (h.getAttribute('aria-label') ?? h.textContent ?? '').trim();
      if (!label) return;
      const y = h.getBoundingClientRect().top + scrollY;
      const t = Math.min(max, Math.max(0, y - offset));
      next.push({ label, y, t, at: max ? t / max : 0 });
    });
    setMarks((cur) =>
      cur.length === next.length &&
      cur.every((m, i) => m.label === next[i]!.label && Math.abs(m.y - next[i]!.y) < 2)
        ? cur
        : next,
    );
  }, [selector, offset]);

  /**
   * «ты здесь» — доля прокрутки. Точки заголовков стоят там, куда доезжает страница при их выборе,
   * поэтому после прыжка «ты здесь» встаёт ровно на выбранный заголовок.
   */
  const place = useCallback(() => {
    const el = box.current;
    const t = thumb.current;
    if (!el || !t) return;
    const H = document.documentElement.scrollHeight;
    const max = Math.max(1, H - innerHeight);
    t.style.setProperty('--f', Math.min(1, Math.max(0, scrollY / max)).toFixed(4));
    el.style.setProperty('--h', `${el.clientHeight}px`);
    el.classList.toggle('q-edge-none', H <= innerHeight + 4);
    if (held.current) return;
    const ms = marksRef.current;
    // выбранный заголовок остаётся подсвеченным, пока страница стоит на нём (внизу на одном
    // экране может поместиться несколько заголовков — подсвечен тот, что выбрали)
    const p = picked.current;
    // цели сверяем с настоящим концом страницы: он мог сдвинуться после того, как заголовки прочитаны
    const reach = (m: Mark) => Math.min(m.t, max);
    if (p >= 0 && ms[p] && Math.abs(reach(ms[p]!) - scrollY) < 6) {
      if (p !== hotRef.current) setHot(p);
      return;
    }
    if (!driving.current) picked.current = -1;
    let i = -1;
    ms.forEach((m, j) => {
      if (reach(m) <= scrollY + 6) i = j;
    });
    if (i !== hotRef.current) setHot(i);
  }, []);
  const picked = useRef(-1);
  const held = useRef(false);

  useEffect(() => {
    // системная полоса прокрутки не нужна, пока есть своя
    document.documentElement.classList.add('q-own-scroll');
    // заголовки читаем после первой раскладки страницы
    const first = requestAnimationFrame(() => {
      read();
      place();
    });
    const draw = loop().render(place);
    const onScroll = () => draw();
    const onResize = () => {
      read();
      draw();
    };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onResize);
    // страница меняется без прокрутки (новые дела, другой раздел) — перечитываем заголовки
    const mo = new MutationObserver(() => onResize());
    mo.observe(document.body, { childList: true, subtree: true });
    // и когда высота страницы меняется сама (догрузился шрифт, дорисовались надписи из точек)
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => onResize()) : null;
    ro?.observe(document.body);
    // палец или колесо — прокрутка снова в руках человека
    const stop = () => (driving.current = false);
    addEventListener('wheel', stop, { passive: true });
    addEventListener('touchstart', stop, { passive: true });
    return () => {
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onResize);
      removeEventListener('wheel', stop);
      removeEventListener('touchstart', stop);
      mo.disconnect();
      ro?.disconnect();
      cancelAnimationFrame(first);
      document.documentElement.classList.remove('q-own-scroll');
    };
  }, [read, place]);

  const show = useCallback(
    (on: boolean) => {
      setOpened(on);
      loop().to(op, on ? 1 : 0, feelOf('flow'));
    },
    [op],
  );

  /** к заголовку i: страница едет пружиной */
  const go = useCallback(
    (i: number) => {
      const m = marksRef.current[i];
      if (!m) return;
      const L = loop();
      if (!driving.current) L.set(sc, scrollY);
      driving.current = true;
      const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      L.to(sc, Math.min(m.t, max), PAGE);
      picked.current = i;
      setHot(i);
    },
    [sc],
  );

  /**
   * Палец ведёт страницу непрерывно: на линии заголовка — страница ровно на нём,
   * между линиями — плавно между заголовками, выше первой — к началу, ниже последней — к концу.
   */
  const follow = (clientY: number) => {
    const el = box.current;
    const ms = marksRef.current;
    if (!el || !ms.length) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const pts: [number, number][] = [[0, 0]];
    ms.forEach((m, i) =>
      pts.push([(i + 0.5) / ms.length, Math.min(max, Math.max(0, m.y - offset))]),
    );
    pts.push([1, max]);
    let y = max;
    for (let j = 1; j < pts.length; j++) {
      const [f1, y1] = pts[j]!;
      if (f <= f1) {
        const [f0, y0] = pts[j - 1]!;
        y = y0 + ((y1 - y0) * (f - f0)) / Math.max(1e-6, f1 - f0);
        break;
      }
    }
    const L = loop();
    if (!driving.current) L.set(sc, scrollY);
    driving.current = true;
    L.to(sc, y, PAGE);
  };

  /**
   * Заголовок под пальцем. Раскрытые линии лежат равномерно по всей высоте, поэтому каждому
   * заголовку достаётся одинаковый ход пальца — целиться в точку не нужно.
   */
  const nearest = (clientY: number) => {
    const el = box.current;
    const n = marksRef.current.length;
    if (!el || !n) return -1;
    const r = el.getBoundingClientRect();
    const f = (clientY - r.top) / r.height;
    return Math.min(n - 1, Math.max(0, Math.floor(f * n)));
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let closeT = 0;
    const later = () => {
      clearTimeout(closeT);
      closeT = window.setTimeout(() => show(false), 700);
    };
    const h = drag(el, {
      axis: 'y',
      threshold: 2,
      onDown: (at, e) => {
        clearTimeout(closeT);
        held.current = true;
        try {
          el.setPointerCapture(e.pointerId ?? 1);
        } catch {
          /* без захвата тоже работает */
        }
        show(true);
        setHot(nearest(at.y));
      },
      onMove: ({ y }) => {
        follow(y);
        const i = nearest(y);
        if (i >= 0 && i !== hotRef.current) setHot(i);
      },
      onEnd: () => {
        held.current = false;
        picked.current = hotRef.current;
        later();
      },
      onTap: ({ y }) => {
        held.current = false;
        go(nearest(y));
        later();
      },
      onCancel: () => {
        held.current = false;
        later();
      },
    });
    const enter = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        clearTimeout(closeT);
        show(true);
      }
    };
    const leave = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && !h.active) later();
    };
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    return () => {
      clearTimeout(closeT);
      h.destroy();
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
    };
    // follow и nearest читают только ref-ы — пересоздавать жест не нужно
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, go]);

  return (
    <div
      ref={box}
      className={opened ? 'q-edge q-edge-open' : 'q-edge'}
      style={{ bottom }}
      role="navigation"
      aria-label="Заголовки страницы"
    >
      {marks.map((m, i) => (
        <i
          key={`${m.label}-${i}`}
          className={i === hot ? 'q-edge-mark q-on' : 'q-edge-mark'}
          style={
            {
              '--at': m.at.toFixed(4),
              '--even': ((i + 0.5) / marks.length).toFixed(4),
            } as CSSProperties
          }
        />
      ))}
      <b ref={thumb} className="q-edge-thumb" aria-hidden="true" />
      <div ref={labels} className="q-edge-labels" style={{ opacity: 0 }}>
        {marks.map((m, i) => (
          <button
            key={`${m.label}-${i}`}
            type="button"
            tabIndex={opened ? 0 : -1}
            className={i === hot ? 'q-on' : undefined}
            style={{ '--even': ((i + 0.5) / marks.length).toFixed(4) } as CSSProperties}
            onClick={() => go(i)}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
