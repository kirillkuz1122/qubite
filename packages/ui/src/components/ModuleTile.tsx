import type { ModuleInfo } from '../catalog';
import { cx } from './Button';

export interface ModuleTileProps {
  module: ModuleInfo;
  active?: boolean;
  onClick?: () => void;
}

/** Плитка модуля. Знак — пока буква; настоящие иконки — в DS-005. */
export function ModuleTile({ module, active = false, onClick }: ModuleTileProps) {
  return (
    <button
      type="button"
      className={cx('q-tile', active && 'q-tile--active')}
      data-family={module.family}
      data-hue={module.hue}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="q-tile__glyph" aria-hidden="true">
        {module.name.slice(0, 1)}
      </span>
      <span className="q-tile__name">{module.name}</span>
    </button>
  );
}
