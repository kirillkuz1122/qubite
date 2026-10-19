import { loop } from '@qubite/motion';
import { useId, useRef, type ReactNode } from 'react';
import { feelOf } from './feel';
import { useSpring } from './useSpring';

export interface CheckProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** текст рядом (можно со ссылками) */
  children: ReactNode;
  required?: boolean;
  error?: string | null;
}

/**
 * Галочка-согласие: квадратик из рамки, внутри которого точка вырастает пружиной.
 * Под капотом — настоящий checkbox, поэтому работает с клавиатуры и читалками.
 */
export function Check({ checked, onChange, children, required, error }: CheckProps) {
  const id = useId();
  const dot = useRef<HTMLElement>(null);
  const s = useSpring(checked ? 1 : 0, 0.5, (x) => {
    if (dot.current) dot.current.style.transform = `scale(${Math.max(0, x).toFixed(3)})`;
  });
  return (
    <div className={['q-check', error && 'q-bad'].filter(Boolean).join(' ')}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-note` : undefined}
        onChange={(e) => {
          loop().to(s, e.target.checked ? 1 : 0, feelOf('switch'));
          onChange(e.target.checked);
        }}
      />
      <span className="q-check-box" aria-hidden="true">
        <i ref={dot} style={{ transform: `scale(${checked ? 1 : 0})` }} />
      </span>
      <label htmlFor={id}>{children}</label>
      {error && (
        <p className="q-field-note" id={`${id}-note`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
