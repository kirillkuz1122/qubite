import type { ReactNode } from 'react';

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

/** Ползунок настройки: подпись и значение сверху, сам ползунок — оранжевый. */
export function Range({
  label,
  value,
  min,
  max,
  onChange,
  format = (v) => `${v}%`,
  children,
}: RangeProps) {
  return (
    <label className="q-range">
      <span className="q-range-head">
        <span>{label}</span>
        <span className="q-range-val">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {children}
    </label>
  );
}
