import { loop, rubber } from '@qubite/motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { feelOf } from './feel';
import { useSpring } from './useSpring';

export interface RangeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** как показать значение справа (по умолчанию — проценты) */
  format?: (value: number) => string;
  /** что-нибудь под ползунком: например, образцы точек */
  children?: ReactNode;
}

/**
 * Ползунок настройки: подпись и значение сверху, ниже — дорожка с оранжевой точкой.
 * Точка догоняет значение пружиной, вытягивается на быстром ходу и тянется резинкой за край.
 * Под ней — обычный input type=range: клавиатура, экранный диктор и тесты работают как всегда.
 */
export function Range({
  label,
  value,
  min,
  max,
  onChange,
  format = (v) => `${v}%`,
  children,
}: RangeProps) {
  const frac = (v: number) => (max === min ? 0 : (v - min) / (max - min));
  const rail = useRef<HTMLSpanElement>(null);
  const fill = useRef<HTMLElement>(null);
  const thumb = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  const W = useRef(0);
  const draw = () => {
    const w = W.current;
    const x = pos.x * w;
    const stretch = Math.min(0.5, Math.abs(pos.v) * 0.12);
    if (fill.current) fill.current.style.transform = `scaleX(${Math.max(0, pos.x).toFixed(4)})`;
    if (thumb.current)
      thumb.current.style.transform = `translateX(${x.toFixed(2)}px) scale(${(1 + stretch).toFixed(3)}, ${(1 - stretch / 3).toFixed(3)})`;
  };
  const pos = useSpring(frac(value), 0.55, draw);

  // ширина дорожки — один раз и при изменении размера
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const measure = () => {
      W.current = el.offsetWidth;
      setWidth(W.current);
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    loop().to(pos, frac(value), feelOf('range'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, min, max, width]);

  /** палец на дорожке: за краем точка тянется резинкой, после — пружинит назад */
  const press = useRef<number | null>(null);
  const over = (clientX: number) => {
    const el = rail.current;
    if (!el || !W.current) return;
    const raw = (clientX - el.getBoundingClientRect().left) / W.current;
    if (raw < 0 || raw > 1) loop().hold(pos, rubber(raw, 0, 1, 0.08), 0);
  };

  return (
    <label className="q-range">
      <span className="q-range-head">
        <span>{label}</span>
        <span className="q-range-val">{format(value)}</span>
      </span>
      <span className="q-range-track">
        <span className="q-range-rail" ref={rail}>
          <i className="q-range-fill" ref={fill} />
        </span>
        <i className="q-range-thumb" ref={thumb} aria-hidden="true" />
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={(e) => {
            press.current = e.pointerId;
          }}
          onPointerMove={(e) => {
            if (press.current === e.pointerId) over(e.clientX);
          }}
          onPointerUp={() => {
            press.current = null;
            loop().to(pos, frac(value), feelOf('range'));
          }}
          onPointerCancel={() => {
            press.current = null;
            loop().to(pos, frac(value), feelOf('range'));
          }}
        />
      </span>
      {children}
    </label>
  );
}
