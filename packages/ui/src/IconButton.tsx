import type { ButtonHTMLAttributes } from 'react';
import { DotIcon, type IconName } from './icons';
import { usePress } from './press';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> {
  icon: IconName;
  /** что делает кнопка — читалке и подсказкой на ПК; без подписи значок-кнопки не бывает */
  label: string;
  /** quiet — только значок; frame — с рамкой (панель инструментов); fill — главное действие */
  variant?: 'quiet' | 'frame' | 'fill';
}

/** Кнопка-значок 44×44: под курсором светлеет, под пальцем сжимается до 0,86 и пружинит. */
export function IconButton({
  icon,
  label,
  variant = 'quiet',
  className,
  disabled,
  ...rest
}: IconButtonProps) {
  const press = usePress(0.86);
  return (
    <button
      type="button"
      title={label}
      {...rest}
      {...(disabled ? { ref: press.ref } : press)}
      disabled={disabled}
      aria-label={label}
      className={['q-icon-btn', `q-icon-btn-${variant}`, className].filter(Boolean).join(' ')}
    >
      <DotIcon name={icon} />
    </button>
  );
}
