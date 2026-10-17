import { cx } from './Button';

export interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

export function Switch({ label, checked, onChange, className }: SwitchProps) {
  return (
    <label className={cx('q-switch', className)}>
      <span className="q-switch__label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="q-switch__track"
        onClick={() => onChange(!checked)}
      >
        <span className="q-switch__thumb" aria-hidden="true" />
      </button>
    </label>
  );
}
