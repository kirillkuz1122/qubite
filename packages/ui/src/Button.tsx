import { loop } from '@qubite/motion';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useSpring } from './useSpring';
import { useRef } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** fill — оранжевая заливка (главное действие), outline — рамка */
  variant?: 'fill' | 'outline';
  size?: 'md' | 'sm';
  /** точка перед текстом */
  dot?: boolean;
  children: ReactNode;
}

/** Кнопка: под пальцем сжимается и пружинит обратно. */
export function Button({
  variant = 'outline',
  size = 'md',
  dot = true,
  className,
  children,
  ...rest
}: ButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const s = useSpring(1, 0.6, (x) => {
    if (ref.current) ref.current.style.transform = `scale(${x.toFixed(4)})`;
  });
  const L = loop();
  return (
    <button
      ref={ref}
      type="button"
      className={['q-btn', variant === 'fill' && 'q-fill', size === 'sm' && 'q-sm', className]
        .filter(Boolean)
        .join(' ')}
      onPointerDown={() => L.to(s, 0.9)}
      onPointerUp={() => {
        L.to(s, 1);
        L.kick(s, 1.2);
      }}
      onPointerLeave={() => L.to(s, 1)}
      {...rest}
    >
      {dot && <span className="q-dot" aria-hidden="true" />}
      {children}
    </button>
  );
}
