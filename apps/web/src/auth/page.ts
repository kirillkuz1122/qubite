/** Связь страниц Qubite Auth с общей рамкой: заголовок, помощники, юридические ссылки. */
import { createContext, useContext, useEffect, useRef } from 'react';

/** Что страница Auth говорит рамке: заголовок из точек, подпись, ширина карточки. */
export interface PageHead {
  /** надпись из точек заглавными: «ВХОД» */
  dots: string;
  /** заголовок для читалки и вкладки: «Вход» */
  title: string;
  lead?: string | undefined;
  wide?: boolean | undefined;
}

export interface AuthCtx {
  setHead(h: PageHead): void;
  /** помощники отворачиваются (пароль) */
  shy(on: boolean): void;
  /** помощники грустят (ошибка) */
  sad(): void;
  /** помощники радуются (получилось) */
  cheer(): void;
}

export const Ctx = createContext<AuthCtx | null>(null);

function useAuthCtx(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('страница Auth вне AuthLayout');
  return c;
}

/** Страница Auth объявляет свой заголовок; заголовок из точек перестраивается. */
export function usePage(head: PageHead) {
  const { setHead } = useAuthCtx();
  const { dots, title, wide } = head;
  const lead = head.lead;
  useEffect(() => {
    setHead({ dots, title, lead, wide });
    document.title = `${title} · Qubite`;
  }, [setHead, dots, title, lead, wide]);
}

/** Помощники на экране: отвернуться, погрустить, порадоваться. */
export function useHelpers(): Omit<AuthCtx, 'setHead'> {
  return useAuthCtx();
}

/**
 * Свойства для поля пароля: пока оно в фокусе или пароль показан — помощники
 * закрывают глаза и отворачиваются.
 */
export function useShyPassword() {
  const { shy } = useAuthCtx();
  const state = useRef({ focus: false, shown: false });
  const apply = () => shy(state.current.focus || state.current.shown);
  useEffect(() => () => shy(false), [shy]);
  return {
    onFocus: () => {
      state.current.focus = true;
      apply();
    },
    onBlur: () => {
      state.current.focus = false;
      apply();
    },
    onReveal: (shown: boolean) => {
      state.current.shown = shown;
      apply();
    },
  };
}

export const LEGAL_LINKS = [
  { doc: 'terms', label: 'Условия' },
  { doc: 'privacy', label: 'Приватность' },
  { doc: 'cookies', label: 'Cookies' },
  { doc: 'consent', label: 'Согласие на обработку данных' },
] as const;
