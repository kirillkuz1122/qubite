import { useSyncExternalStore } from 'react';

/** Подходит ли экран под медиазапрос; следит за изменениями (поворот, окно стало шире). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (on) => {
      if (typeof matchMedia !== 'function') return () => {};
      const m = matchMedia(query);
      m.addEventListener('change', on);
      return () => m.removeEventListener('change', on);
    },
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
    () => false,
  );
}

/** ПК: боковая панель и плавающая Command (как в макете, от 900 px). */
export const WIDE = '(min-width: 900px)';

/**
 * Подсказка, которая сама себя печатает в пустом поле (placeholder).
 * Пока поле в фокусе или в нём есть текст — ждёт. Возвращает остановку.
 */
export function typewriter(
  input: HTMLInputElement,
  phrases: string[],
  o: { delay?: number; reduced?: boolean } = {},
): () => void {
  const base = input.getAttribute('placeholder') ?? '';
  let i = 0;
  let j = 0;
  let dir = 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function step() {
    if (document.activeElement === input || input.value) {
      input.setAttribute('placeholder', base);
      timer = setTimeout(step, 900);
      return;
    }
    const p = phrases[i] ?? '';
    j += dir;
    input.setAttribute('placeholder', p.slice(0, j) + (dir > 0 ? '▍' : ''));
    let wait = dir > 0 ? 55 + Math.random() * 60 : 22;
    if (j >= p.length) {
      dir = -1;
      wait = 1900;
    }
    if (j <= 0 && dir < 0) {
      dir = 1;
      i = (i + 1) % phrases.length;
      wait = 400;
    }
    timer = setTimeout(step, wait);
  }
  if (!o.reduced && phrases.length) timer = setTimeout(step, o.delay ?? 900);
  return () => {
    clearTimeout(timer);
    input.setAttribute('placeholder', base);
  };
}
