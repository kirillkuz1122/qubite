import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'action' | 'secondary' | 'ghost' | 'success';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return <button type={type} className={cx('q-btn', `q-btn--${variant}`, className)} {...rest} />;
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
