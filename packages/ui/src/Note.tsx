import type { ReactNode } from 'react';

export interface NoteProps {
  /** info — обычное, ok — получилось, bad — ошибка (читалка объявит сразу) */
  tone?: 'info' | 'ok' | 'bad';
  children: ReactNode;
  className?: string;
}

/** Короткое сообщение в рамке с цветной точкой: «письмо отправлено», «пароль не подошёл». */
export function Note({ tone = 'info', children, className }: NoteProps) {
  return (
    <div
      className={['q-note', `q-note-${tone}`, className].filter(Boolean).join(' ')}
      role={tone === 'bad' ? 'alert' : 'status'}
    >
      <span className="q-dot" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
