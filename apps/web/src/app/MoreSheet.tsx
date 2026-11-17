import { DotIcon, Sheet, type NavItem } from '@qubite/ui';

/**
 * Лист «Ещё» нижней панели телефона (D-866, D-945): разделы, которым не хватило места в панели, —
 * плитками «значок + подпись», как в макете «Окна и состояния → Телефон: „Ещё“».
 */
export function MoreSheet<T extends string>({
  open,
  items,
  current,
  onGo,
  onClose,
}: {
  open: boolean;
  items: NavItem<T>[];
  current: T;
  onGo: (id: T) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Ещё">
      <div className="more-grid">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            className="more-tile"
            aria-current={it.id === current ? 'page' : undefined}
            data-nav-target={it.id}
            onClick={() => {
              onClose();
              onGo(it.id);
            }}
          >
            <DotIcon name={it.icon} />
            <span>{it.label}</span>
            {!!it.count && it.badge && <span className="more-count">{it.count}</span>}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
