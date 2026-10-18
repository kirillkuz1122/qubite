import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PALETTES } from './tokens';

// тесты пакета запускаются из его папки (pnpm test)
const css = readFileSync(resolve(process.cwd(), 'src/tokens.css'), 'utf8');
const lightAt = css.indexOf(":root[data-theme='light']");

/** Канал цвета → относительная яркость (WCAG). */
function lum(hex: string) {
  const n = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const [r, g, b] = ch.map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

describe('токены', () => {
  it('tokens.css и tokens.ts совпадают в обеих темах', () => {
    const dark = css.slice(0, lightAt);
    const light = css.slice(lightAt);
    for (const [name, value] of Object.entries(PALETTES.dark))
      expect(dark).toContain(`--q-${name}: ${value};`);
    for (const [name, value] of Object.entries(PALETTES.light))
      expect(light).toContain(`--q-${name}: ${value};`);
  });

  it('у тем одинаковый набор имён', () => {
    expect(Object.keys(PALETTES.light)).toEqual(Object.keys(PALETTES.dark));
  });

  it.each(['dark', 'light'] as const)('текст читается в теме %s (не ниже 4,5:1)', (theme) => {
    const p = PALETTES[theme];
    for (const ink of [p.ink, p.mute, p.dim])
      expect(contrast(ink, p.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.ink, p.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.mute, p.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p['on-accent'], p.orange)).toBeGreaterThanOrEqual(4.5);
  });
});
