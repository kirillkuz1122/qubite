import type { ReactNode } from 'react';

export interface ListRowProps {
  /** цвет точки-маркера — имя токена: `orange`, `yellow`, `sky`… */
  color?: string;
  /** подпись строки: срок, время, проект. На ПК — справа, на телефоне — под названием */
  meta?: ReactNode;
  /** строка-кнопка: нажатие открывает запись */
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

/**
 * Строка списка v2 (DS-013): точка, название, подпись. Название — текст человека, поэтому
 * переносится по символам и не раздвигает экран; на телефоне подпись уходит под название,
 * а не сжимает его (DESIGN_SYSTEM §0.2).
 */
export function ListRow({ color = 'orange', meta, onClick, className, children }: ListRowProps) {
  const cls = ['q-lrow', className].filter(Boolean).join(' ');
  const body = (
    <>
      <span className="q-dot" style={{ background: `var(--q-${color})` }} aria-hidden="true" />
      <span className="q-lrow-t">{children}</span>
      {meta != null && meta !== '' && <span className="q-lrow-meta">{meta}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
