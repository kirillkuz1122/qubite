import { useLayoutEffect, useRef } from 'react';
import { useFlow } from './Flow';

export interface SegmentedProps<T extends string> {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T, origin: { x: number; y: number }) => void;
  label: string;
  /** panel — в рамке (по умолчанию), chips — фильтры без рамки, с числами и прокруткой */
  variant?: 'panel' | 'chips';
}

/** Переключатель вариантов: подложка выбранного перетекает к новому. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  variant = 'panel',
}: SegmentedProps<T>) {
  const chips = variant === 'chips';
  const { node, to } = useFlow(36, chips ? 0 : 4, chips ? { className: 'q-chip-flow' } : {});
  const btns = useRef(new Map<T, HTMLButtonElement>());
  const first = useRef(true);
  useLayoutEffect(() => {
    const b = btns.current.get(value);
    if (!b) return;
    to(b.offsetLeft, b.offsetLeft + b.offsetWidth, first.current);
    first.current = false;
  }, [value, to]);
  return (
    <div className={chips ? 'q-chips' : 'q-seg'} role="radiogroup" aria-label={label}>
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
