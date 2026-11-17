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
    dim: '#968d82',
    line: 'rgba(243, 237, 227, 0.12)',
    'line-2': 'rgba(243, 237, 227, 0.26)',
    faint: 'rgba(243, 237, 227, 0.16)',
    orange: '#ff9852',
    sky: '#71cfff',
    yellow: '#ffe163',
    green: '#90dea5',
    red: '#f08b85',
    peach: '#ffb98a',
    'orange-ink': '#ff9852',
    'sky-ink': '#71cfff',
    'yellow-ink': '#ffe163',
    'green-ink': '#90dea5',
    'red-ink': '#f08b85',
    'orange-hover': '#ffad74',
    'on-accent': '#100f0d',
  },
  light: {
    bg: '#f3eee5',
    'bg-2': '#e9e2d6',
    panel: '#fffcf6',
    'panel-2': '#ebe4d8',
    ink: '#1f1a17',
    mute: '#5d5650',
    dim: '#665e56',
    line: 'rgba(31, 26, 23, 0.12)',
    'line-2': 'rgba(31, 26, 23, 0.26)',
    faint: 'rgba(31, 26, 23, 0.16)',
    orange: '#f7883e',
    sky: '#3ea9e8',
    yellow: '#edb500',
    green: '#3fae69',
    red: '#c33f38',
    peach: '#f39a6b',
    'orange-ink': '#9c4a12',
    'sky-ink': '#12648f',
    'yellow-ink': '#7a5e00',
    'green-ink': '#256f41',
    'red-ink': '#b0352f',
    'orange-hover': '#e9772b',
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
  red: 'ошибка, неверный ответ',
  peach: 'личное',
  'orange-ink': 'оранжевый текст',
  'sky-ink': 'небесный текст',
  'yellow-ink': 'жёлтый текст',
  'green-ink': 'зелёный текст',
  'red-ink': 'текст ошибки',
  'orange-hover': 'главная кнопка под курсором',
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
