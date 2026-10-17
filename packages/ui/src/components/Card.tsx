import type { HTMLAttributes } from 'react';
import { cx } from './Button';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  tone?: 'plain' | 'idea' | 'select' | 'success' | 'action';
}

export function Card({ tone = 'plain', className, ...rest }: CardProps) {
  return (
    <section className={cx('q-card', tone !== 'plain' && `q-card--${tone}`, className)} {...rest} />
  );
}
