import { useEffect, useId, useRef, useState } from 'react';
import { IconButton, type IconButtonProps } from './IconButton';
import { DotIcon, type IconName } from './icons';
import { Presence } from './Presence';

export interface MenuItem {
  label: string;
  onPick: () => void;
  icon?: IconName;
  disabled?: boolean;
  /** bad — действие, которое что-то убирает (например «Удалить») */
  tone?: 'bad';
}

export interface MenuProps {
  /** подпись кнопки, она же название меню: «Ещё» */
  label: string;
  items: MenuItem[];
  icon?: IconName;
  variant?: IconButtonProps['variant'];
  /** к какому краю кнопки прижать список (по умолчанию к правому) */
  align?: 'start' | 'end';
  disabled?: boolean;
  className?: string;
}

/**
 * Меню редких действий за кнопкой-значком («Ещё»). Открывается под кнопкой; стрелки ходят по
 * пунктам, Escape и щелчок мимо закрывают, фокус возвращается на кнопку.
 */
export function Menu({
  label,
  items,
  icon = 'more',
  variant = 'frame',
  align = 'end',
  disabled,
  className,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  const rows = () =>
    Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) wrap.current?.querySelector<HTMLButtonElement>('.q-icon-btn')?.focus();
  };

  useEffect(() => {
    if (!open) return;
    rows()[0]?.focus();
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener('pointerdown', away);
    return () => removeEventListener('pointerdown', away);
  }, [open]);

  function key(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
      return;
    }
    const all = rows();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const to =
      e.key === 'ArrowDown'
        ? at + 1
        : e.key === 'ArrowUp'
          ? at - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? all.length - 1
              : null;
    if (to === null || !all.length) return;
    e.preventDefault();
    all[(to + all.length) % all.length]?.focus();
  }

  return (
    <span
      ref={wrap}
      className={['q-pop-wrap', className].filter(Boolean).join(' ')}
      onKeyDown={open ? key : undefined}
      onBlur={(e) => {
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <IconButton
        icon={icon}
        label={label}
        variant={variant}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
      />
      <Presence show={open} className={`q-pop q-pop-${align}`}>
        <div ref={list} id={id} role="menu" aria-label={label} className="q-pop-list">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={item.tone === 'bad' ? 'q-pop-item q-pop-bad' : 'q-pop-item'}
              onClick={() => {
                close(true);
                item.onPick();
              }}
            >
              {item.icon && <DotIcon name={item.icon} />}
              {item.label}
            </button>
          ))}
        </div>
      </Presence>
    </span>
  );
}
