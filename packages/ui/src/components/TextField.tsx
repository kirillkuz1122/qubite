import { useId, type InputHTMLAttributes } from 'react';
import { cx } from './Button';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextField({ label, hint, error, className, ...rest }: TextFieldProps) {
  const id = useId();
  const note = error ?? hint;
  return (
    <div className={cx('q-field', error && 'q-field--error', className)}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? `${id}-note` : undefined}
        {...rest}
      />
      {note && (
        <small id={`${id}-note`}>
          {error && <span aria-hidden="true">⚠ </span>}
          {note}
        </small>
      )}
    </div>
  );
}
