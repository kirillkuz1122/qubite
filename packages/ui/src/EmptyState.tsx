import { forwardRef, type ReactNode } from 'react';
import { Companion, type CompanionHandle } from './Companion';
import type { CompanionKind } from './tokens';

export interface EmptyStateProps {
  /** помощник раздела: Прото — дела, Элик — мысли, Нейт — знания, Фоти — личное */
  kind: CompanionKind;
  /** что делает помощник — для читалки («Элик дремлет») */
  label?: string;
  /** одна фраза: что здесь будет */
  title: ReactNode;
  /** пояснение мельче, если одной фразы мало */
  hint?: ReactNode;
  /** одно действие — обычная кнопка */
  children?: ReactNode;
  className?: string;
}

/** Пустой раздел: помощник, одна фраза и одно действие. `ref` — сам помощник (настроение, прыжок). */
export const EmptyState = forwardRef<CompanionHandle, EmptyStateProps>(function EmptyState(
  { kind, label, title, hint, children, className },
  ref,
) {
  return (
    <div className={['q-empty', className].filter(Boolean).join(' ')}>
      <Companion ref={ref} kind={kind} pitch={6.5} {...(label ? { label } : {})} />
      <p className="q-empty-title">{title}</p>
      {hint && <p className="q-empty-hint">{hint}</p>}
      {children && <div className="q-empty-act">{children}</div>}
    </div>
  );
});
