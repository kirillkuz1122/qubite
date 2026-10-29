/**
 * Токены «Частиц» (D-154…D-166): две темы, одинаковые имена.
 * Те же значения — в tokens.css (тест проверяет, что они совпадают).
 * Холсты с точками рисуют цветами отсюда, DOM — переменными CSS `--q-<имя>`.
 */
export const PALETTES = {
  dark: {
    bg: '#100f0d',
    'bg-2': '#0a0908',
    panel: '#1b1916',
    'panel-2': '#24211d',
    ink: '#f3ede3',
    mute: '#a59c90',
    dim: '#8a8176',
    line: 'rgba(243, 237, 227, 0.12)',
    'line-2': 'rgba(243, 237, 227, 0.26)',
    faint: 'rgba(243, 237, 227, 0.16)',
    orange: '#ff9852',
    sky: '#71cfff',
    yellow: '#ffe163',
    green: '#90dea5',
    red: '#f08b85',
    peach: '#ffb98a',
    'on-accent': '#100f0d',
  },
  light: {
    bg: '#f3eee5',
    'bg-2': '#e9e2d6',
    panel: '#fffcf6',
    'panel-2': '#ebe4d8',
    ink: '#1f1a17',
    mute: '#5d5650',
    dim: '#6e665e',
    line: 'rgba(31, 26, 23, 0.12)',
    'line-2': 'rgba(31, 26, 23, 0.26)',
    faint: 'rgba(31, 26, 23, 0.16)',
    orange: '#f7883e',
    sky: '#3ea9e8',
    yellow: '#edb500',
    green: '#3fae69',
    red: '#c33f38',
    peach: '#f39a6b',
    'on-accent': '#1f1a17',
  },
} as const;

export type ThemeName = keyof typeof PALETTES;
export type ColorName = keyof (typeof PALETTES)['dark'];
export type Palette = Record<ColorName, string>;

/** Что означает каждый цвет — для витрины и подсказок. */
export const COLOR_USAGE: Record<ColorName, string> = {
  bg: 'фон экрана',
  'bg-2': 'фон вокруг устройства',
  panel: 'панели, строка Command, меню',
  'panel-2': 'выбранное внутри панели',
  ink: 'основной текст и точки',
  mute: 'второстепенный текст',
  dim: 'подписи, время',
  line: 'разделители',
  'line-2': 'рамки кнопок и меню',
  faint: 'бледные точки',
  orange: 'действие, «сейчас», Фоти',
  sky: 'учёба, Нейт',
  yellow: 'мысль, Элик',
  green: 'сделано',
  red: 'неверный ответ',
  peach: 'личное',
  'on-accent': 'текст на цветной заливке',
};

/** Помощники и их цвета. */
export const COMPANION_COLOR = {
  elik: 'yellow',
  proto: 'ink',
  neit: 'sky',
  foti: 'orange',
} as const;
export type CompanionKind = keyof typeof COMPANION_COLOR;
