import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast } from './contrast';
import { FAMILIES, MODULES, MODULE_SCHEMES, STYLES } from './catalog';

const css = ['tokens.css', 'themes/themes.css']
  .map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'))
  .join('\n');

/** Все значения токена во всех стилях (у «Тёплой бумаги» пластик свой). */
function values(token: string): string[] {
  return [...css.matchAll(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, 'gi'))].map((m) => m[1]!);
}

const INK = values('--ink')[0]!;

describe('контраст (WCAG AA)', () => {
  it('формула совпадает с эталонными значениями', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it.each([
    '--plastic-action',
    '--plastic-select',
    '--plastic-idea',
    '--plastic-success',
    '--plastic-error',
  ])('тёмный текст на %s читается во всех стилях', (token) => {
    const found = values(token);
    expect(found.length).toBeGreaterThan(0);
    for (const fill of found) expect(contrast(INK, fill)).toBeGreaterThanOrEqual(4.5);
  });

  it('второстепенный текст и текст ошибки читаются на светлых поверхностях', () => {
    const surfaces = [...values('--q-surface'), ...values('--q-surface-2'), ...values('--q-bg')];
    expect(surfaces.length).toBeGreaterThan(5);
    for (const bg of surfaces) {
      expect(contrast(values('--ink-2')[0]!, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(values('--error-text')[0]!, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

it('буквы модулей читаются на всех цветах «Радуги»', () => {
  const rainbow = [
    ...readFileSync(new URL('modules.css', import.meta.url), 'utf8').matchAll(
      /--q-mod:\s*(#[0-9a-f]{6})/gi,
    ),
  ];
  expect(rainbow).toHaveLength(MODULES.length);
  for (const m of rainbow) expect(contrast(INK, m[1]!)).toBeGreaterThanOrEqual(4.5);
});

describe('справочники', () => {
  it('у вариантов уникальные id', () => {
    for (const list of [STYLES, MODULE_SCHEMES, MODULES]) {
      const ids = list.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('у каждого модуля есть семья и свой цвет радуги', () => {
    for (const m of MODULES) expect(FAMILIES[m.family]).toBeDefined();
    expect(MODULES.map((m) => m.hue).sort((a, b) => a - b)).toEqual(MODULES.map((_, i) => i + 1));
  });

  it('у каждого стиля есть правила в themes.css (кроме «Потока» — он по умолчанию)', () => {
    for (const s of STYLES.filter((s) => s.id !== 'flow'))
      expect(css).toContain(`[data-style='${s.id}']`);
  });
});
