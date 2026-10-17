import {
  BACKGROUNDS,
  GLASS_MODES,
  MODULE_SCHEMES,
  SIZES,
  STYLES,
  type BackgroundId,
  type GlassMode,
  type ModuleSchemeId,
  type SizeId,
  type StyleId,
  type Variant,
} from '@qubite/ui';

/** Выбор в лаборатории хранится в адресе: ссылкой можно поделиться и открыть на телефоне. */
export interface LabSearch {
  style: StyleId;
  glass: GlassMode;
  bg: BackgroundId;
  modules: ModuleSchemeId;
  size: SizeId;
}

function pick<T extends string>(list: Variant<T>[], value: unknown, fallback: T): T {
  return list.find((v) => v.id === value)?.id ?? fallback;
}

export function parseLabSearch(raw: Record<string, unknown>): LabSearch {
  return {
    style: pick(STYLES, raw.style, 'flow'),
    glass: pick(GLASS_MODES, raw.glass, 'painted'),
    bg: pick(BACKGROUNDS, raw.bg, 'milk'),
    modules: pick(MODULE_SCHEMES, raw.modules, 'families'),
    size: pick(SIZES, raw.size, 'm'),
  };
}
