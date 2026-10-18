import { useCallback, useRef, useState } from 'react';

export interface Leaving<T> {
  item: T;
  /** пропал из списка и сейчас уходит; когда анимация закончится — вызови gone(ключ) */
  leaving: boolean;
}

/**
 * Список, из которого ничего не пропадает рывком (D-183): то, что исчезло из items,
 * остаётся на своём месте с leaving = true, пока строка не доиграет уход и не вызовет gone.
 * Вместе с useFlip соседи потом доезжают на новые места.
 */
export function useLeaving<T>(items: T[], keyOf: (t: T) => string) {
  const last = useRef<Leaving<T>[]>([]);
  const finished = useRef(new Set<string>());
  const [, bump] = useState(0);
  const keys = new Set(items.map(keyOf));
  // вернувшийся (например, фильтр переключили обратно) снова живой
  keys.forEach((k) => finished.current.delete(k));
  const out: Leaving<T>[] = items.map((item) => ({ item, leaving: false }));
  last.current.forEach((e, i) => {
    const k = keyOf(e.item);
    if (keys.has(k) || finished.current.has(k)) return;
    out.splice(Math.min(i, out.length), 0, { item: e.item, leaving: true });
  });
  last.current = out;
  const gone = useCallback((k: string) => {
    finished.current.add(k);
    bump((n) => n + 1);
  }, []);
  return [out, gone] as const;
}
