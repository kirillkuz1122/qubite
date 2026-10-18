/**
 * Характеры живых элементов (DS-002): у каждого элемента три варианта «ощущения» —
 * масса (тяжесть) и вязкость (упругость). Жёсткость у всех одна (MATERIAL). Выбор владельца — D-180.
 */
import type { Feel } from '@qubite/motion';

export type FeelPart = 'button' | 'flow' | 'switch' | 'range';
export type FeelName = 'tight' | 'live' | 'bouncy';

export const FEEL_NAMES: FeelName[] = ['tight', 'live', 'bouncy'];
export const FEEL_LABEL: Record<FeelName, string> = {
  tight: 'Собранный',
  live: 'Живой',
  bouncy: 'Пружинистый',
};
export const FEEL_PART_LABEL: Record<FeelPart, string> = {
  button: 'Кнопка',
  flow: 'Подложка',
  switch: 'Переключатель',
  range: 'Ползунок',
};

/**
 * Собранный — лёгкий и без отскока; живой — как было в DS-001/DS-007; пружинистый — чуть тяжелее
 * и заметно качается. Владелец выбрал «Пружинистый» для всех четырёх (D-182).
 */
export const FEELS: Record<FeelPart, Record<FeelName, Feel>> = {
  button: {
    tight: { mass: 0.45, damping: 22 },
    live: { mass: 0.6, damping: 20 },
    bouncy: { mass: 0.7, damping: 11 },
  },
  flow: {
    tight: { mass: 0.6, damping: 24 },
    live: { mass: 0.8, damping: 20 },
    bouncy: { mass: 0.9, damping: 13 },
  },
  switch: {
    tight: { mass: 0.5, damping: 22 },
    live: { mass: 0.7, damping: 20 },
    bouncy: { mass: 0.8, damping: 12 },
  },
  range: {
    tight: { mass: 0.4, damping: 21 },
    live: { mass: 0.55, damping: 20 },
    bouncy: { mass: 0.6, damping: 10 },
  },
};

export type FeelChoice = Record<FeelPart, FeelName>;
/** Выбор владельца 18.10.2026 (D-182): везде «Пружинистый». */
export const DEFAULT_FEEL: FeelChoice = {
  button: 'bouncy',
  flow: 'bouncy',
  switch: 'bouncy',
  range: 'bouncy',
};

/** Текущий выбор — его ставит LookProvider, компоненты читают в момент движения. */
const current: FeelChoice = { ...DEFAULT_FEEL };

export function setFeel(choice: FeelChoice): void {
  Object.assign(current, choice);
}

/** Характер элемента прямо сейчас. */
export function feelOf(part: FeelPart): Feel {
  return FEELS[part][current[part]];
}

/** Тот же характер, но масса умножена на k (ведущий и догоняющий край, хвост ручки). */
export function scaled(f: Feel, k: number): Feel {
  return { mass: f.mass * k, damping: f.damping };
}
