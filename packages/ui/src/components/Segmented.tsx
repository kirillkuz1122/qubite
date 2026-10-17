import { useId, type CSSProperties } from 'react';
import { cx } from './Button';

export interface SegmentedProps<T extends string> {
  label: string;
  options: { id: T; name: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** Выбор одного из нескольких. Перетекание подложки по пружине — в DS-002. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedProps<T>) {
  const id = useId();
  const index = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('q-seg', className)}
      style={{ '--q-seg-count': options.length, '--q-seg-index': index } as CSSProperties}
    >
      <span className="q-seg__thumb" aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.id}
          id={`${id}-${o.id}`}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          className="q-seg__item"
          onClick={() => onChange(o.id)}
        >
          {o.name}
        </button>
      ))}
    </div>
  );
}
