import { useLayoutEffect, useRef } from 'react';
import type { NavItem } from './Dock';
import { DotIcon } from './icons';
import { useSlide } from './Slide';

export interface SideNavProps<T extends string> {
  items: NavItem<T>[];
  current: T;
  onGo: (id: T) => void;
  /** подпись группы для читалки; по умолчанию «Разделы» */
  label?: string;
}

/** Разделы на ПК: подсветка едет к пункту и тянется по пути. */
export function SideNav<T extends string>({
  items,
  current,
  onGo,
  label = 'Разделы',
}: SideNavProps<T>) {
  const { node, to, hide } = useSlide(44, 'q-side-sel');
  const btns = useRef(new Map<T, HTMLButtonElement>());
  const first = useRef(true);
  useLayoutEffect(() => {
    const b = btns.current.get(current);
    // раздел из другой группы (Модули): здесь выделение тает, а не стоит на старом месте
    if (!b) {
      hide(first.current);
      first.current = true;
      return;
    }
    to(b.offsetTop, b.offsetHeight, first.current);
    first.current = false;
  }, [current, to, hide]);
  return (
    <nav className="q-side-nav" aria-label={label}>
      {node}
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          ref={(el) => {
            if (el) btns.current.set(it.id, el);
          }}
          className={it.id === current ? 'q-on' : undefined}
          aria-current={it.id === current ? 'page' : undefined}
          data-nav-target={it.id}
          onClick={() => onGo(it.id)}
        >
          <DotIcon name={it.icon} />
          {it.label}
          <b>{it.count || ''}</b>
        </button>
      ))}
    </nav>
  );
}
