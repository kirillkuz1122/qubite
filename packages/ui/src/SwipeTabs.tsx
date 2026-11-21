import { rubber } from '@qubite/motion';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { canScroll, swipe } from './swipe';

export const SwipeTabsBack = createContext<(() => void) | undefined>(undefined);

/** Область переключателя и его содержимого, без дополнительной коробки в раскладке. */
export function SwipeTabs({ children }: { children: ReactNode }) {
  return (
    <div className="q-swipe-tabs" data-swipe-tabs="">
      {children}
    </div>
  );
}

type TabPosition = { left: number; right: number; top: number };

interface SwipeTabsOptions {
  enabled: boolean;
  current: number;
  count: number;
  measure: (index: number) => TabPosition | undefined;
  preview: (position: TabPosition) => void;
  restore: () => void;
  select: (index: number) => void;
}

export function useSwipeTabs(bar: RefObject<HTMLElement | null>, options: SwipeTabsOptions) {
  const onBack = useContext(SwipeTabsBack);
  const enabled = options.enabled && options.current >= 0 && options.count >= 2;
  const live = useRef({ ...options, onBack });
  live.current = { ...options, onBack };

  useLayoutEffect(() => {
    const el = bar.current;
    if (!enabled || !el) return;
    const scope = el.closest<HTMLElement>('[data-swipe-tabs]') ?? el;
    let current = -1;
    let positions: (TabPosition | undefined)[] = [];

    return swipe(scope, {
      axis: 'x',
      direction: 'both',
      filter: (event, target) => {
        const tabList = target.closest('[data-swipe-tab-list]');
        // Первые 24 px оставляем системному жесту назад.
        return (
          event.clientX >= 24 &&
          (!tabList || tabList === el) &&
          (scope === el || target.closest('[data-swipe-tabs]') === scope) &&
          !target.closest(
            '[data-swipe-tabs-ignore], .q-chips:not([data-swipe-tab-list]), [draggable="true"]',
          ) &&
          !canScroll(target, 'x', 0, scope)
        );
      },
      onStart: () => {
        const tabs = live.current;
        current = tabs.current;
        positions = Array.from({ length: tabs.count }, (_, i) => tabs.measure(i));
      },
      onMove: (dx) => {
        const from = positions[current];
        if (!from) return;
        const to = positions[current - Math.sign(dx)];
        if (!to) {
          const offset = rubber(dx, 0, 0, 24);
          live.current.preview({
            left: from.left + offset,
            right: from.right + offset,
            top: from.top,
          });
          return;
        }

        const step = Math.max(44, Math.abs((to.left + to.right - from.left - from.right) / 2));
        const progress = Math.min(1, Math.abs(dx) / step);
        const extra = rubber(Math.max(0, Math.abs(dx) - step), 0, 0, 24) * -Math.sign(dx);
        live.current.preview({
          left: from.left + (to.left - from.left) * progress + extra,
          right: from.right + (to.right - from.right) * progress + extra,
          top: from.top + (to.top - from.top) * progress,
        });
      },
      onEnd: (dx, velocity) => {
        const tabs = live.current;
        tabs.restore();
        if (tabs.current !== current) return;
        const distance = Math.abs(dx);
        if (distance < 64 && (distance < 24 || velocity * Math.sign(dx) <= 500)) return;
        const next = current - Math.sign(dx);
        if (next === -1) tabs.onBack?.();
        else if (next < tabs.count) tabs.select(next);
      },
      onCancel: () => live.current.restore(),
    });
  }, [bar, enabled]);
}
