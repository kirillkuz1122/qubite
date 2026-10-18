import { drag, project, rubber } from '@qubite/motion';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFlow } from './Flow';

export interface SegmentedProps<T extends string> {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T, origin: { x: number; y: number }) => void;
  label: string;
  /** panel — в рамке (по умолчанию), chips — фильтры без рамки, с числами и прокруткой */
  variant?: 'panel' | 'chips';
  /** пункты переносятся в несколько рядов; подложка перетекает и между рядами */
  wrap?: boolean;
}

/**
 * Переключатель вариантов: подложка выбранного перетекает к новому — и к соседнему, и к дальнему,
 * и в другой ряд. В рамке подложку можно взять пальцем и протащить или бросить; у краёв она тянется
 * резинкой, Escape или прокрутка возвращают её на место.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  variant = 'panel',
  wrap = false,
}: SegmentedProps<T>) {
  const chips = variant === 'chips';
  const { node, to, hold } = useFlow(36, chips ? 0 : 4, chips ? { className: 'q-chip-flow' } : {});
  const box = useRef<HTMLDivElement>(null);
  const btns = useRef(new Map<T, HTMLButtonElement>());
  const first = useRef(true);
  const latest = useRef({ value, options, onChange });
  useEffect(() => {
    latest.current = { value, options, onChange };
  });
  const dragged = useRef(false);

  const place = (v: T, jump: boolean) => {
    const b = btns.current.get(v);
    if (!b) return;
    to(b.offsetLeft, b.offsetLeft + b.offsetWidth, jump, wrap ? b.offsetTop : undefined);
  };

  useLayoutEffect(() => {
    place(value, first.current);
    first.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, to, wrap]);

  useEffect(() => {
    const el = box.current;
    if (!el || chips || wrap) return;
    const row = () => latest.current.options.map((o) => btns.current.get(o.value)!);
    let grab = 0;
    let center = 0;
    let width = 0;
    /** пункт, чей центр ближе всего к x */
    const nearest = (x: number) => {
      let best = 0;
      let d = Infinity;
      row().forEach((b, i) => {
        const c = b.offsetLeft + b.offsetWidth / 2;
        if (Math.abs(c - x) < d) {
          d = Math.abs(c - x);
          best = i;
        }
      });
      return best;
    };
    const h = drag(el, {
      axis: 'x',
      // тащить можно только саму подложку — выбранный пункт
      filter: (e) =>
        (e.target as Element | null)?.closest('button') === btns.current.get(latest.current.value),
      onStart: () => {
        dragged.current = true;
        const b = btns.current.get(latest.current.value)!;
        grab = b.offsetLeft + b.offsetWidth / 2;
        width = b.offsetWidth;
      },
      onMove: ({ dx }) => {
        const bs = row();
        const lo = bs[0]!.offsetLeft;
        const last = bs[bs.length - 1]!;
        const hi = last.offsetLeft + last.offsetWidth;
        center = grab + dx;
        // ширина подложки плавно меняется к ширине пункта под пальцем
        width += (bs[nearest(center)]!.offsetWidth - width) * 0.35;
        const a = rubber(center - width / 2, lo, hi - width, 24);
        hold(a, a + width);
      },
      onEnd: ({ vx }) => {
        const { options: os, value: cur, onChange: change } = latest.current;
        const i = nearest(project(center, vx, 0.985));
        const next = os[i]!.value;
        hold(center - width / 2, center + width / 2, vx);
        if (next === cur) place(cur, false);
        else {
          const r = btns.current.get(next)!.getBoundingClientRect();
          change(next, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
        }
      },
      onCancel: () => place(latest.current.value, false),
    });
    return () => h.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chips, wrap]);

  return (
    <div
      ref={box}
      className={[chips ? 'q-chips' : 'q-seg', wrap && 'q-wrap'].filter(Boolean).join(' ')}
      role="radiogroup"
      aria-label={label}
      onPointerDown={() => (dragged.current = false)}
    >
      {node}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'q-on' : undefined}
          ref={(el) => {
            if (el) btns.current.set(o.value, el);
          }}
          onClick={(e) => {
            if (dragged.current) return; // подложку протащили — выбор уже сделан жестом
            const r = e.currentTarget.getBoundingClientRect();
            onChange(o.value, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
          }}
        >
          {o.label}
          {o.count !== undefined && <b>{o.count || ''}</b>}
        </button>
      ))}
    </div>
  );
}
