// Справочники дизайн-системы: стили, фоны, схемы цветов модулей.
// Пока это варианты для выбора в лаборатории (D-146); после выбора владельца
// лишние уйдут, а выбранный станет основным.

export type StyleId = 'flow' | 'liquid' | 'glass' | 'pixel' | 'clay' | 'neu' | 'paper';
export type GlassMode = 'honest' | 'painted';
export type BackgroundId = 'milk' | 'halo' | 'dots';
export type ModuleSchemeId = 'rainbow' | 'families' | 'quiet';
export type SizeId = 's' | 'm' | 'l';

export interface Variant<T extends string> {
  id: T;
  name: string;
  hint: string;
}

export const STYLES: Variant<StyleId>[] = [
  {
    id: 'flow',
    name: 'Поток',
    hint: 'Идея Codex: молочный фон, тонкая обводка, пастельный пластик',
  },
  {
    id: 'liquid',
    name: 'Жидкое стекло',
    hint: 'Как Apple Liquid Glass: прозрачные капсулы с бликами по краю',
  },
  { id: 'glass', name: 'Матовое стекло', hint: 'Глассморфизм: сильное размытие, белая кромка' },
  {
    id: 'pixel',
    name: 'Пиксель',
    hint: 'Nothing + крабик Claude: точки, ступенчатые углы, пиксельный шрифт',
  },
  { id: 'clay', name: 'Пластилин', hint: 'Клеймофизм: надутые мягкие игрушечные формы' },
  { id: 'neu', name: 'Нейморфизм', hint: 'Кнопки выдавлены из самого фона мягкими тенями' },
  {
    id: 'paper',
    name: 'Тёплая бумага',
    hint: 'Как Claude: спокойная бумага, книжный шрифт заголовков',
  },
];

export const GLASS_MODES: Variant<GlassMode>[] = [
  {
    id: 'honest',
    name: 'Честное',
    hint: 'Настоящее размытие фона — красиво, но тяжело для телефона',
  },
  { id: 'painted', name: 'Нарисованное', hint: 'Блики без размытия — лёгкое для любого телефона' },
];

export const BACKGROUNDS: Variant<BackgroundId>[] = [
  { id: 'milk', name: 'Молоко', hint: 'Ровный тёплый фон, ничего не отвлекает' },
  { id: 'halo', name: 'Ореол', hint: 'Мягкие цветные пятна — стеклу есть что преломлять' },
  { id: 'dots', name: 'Точки', hint: 'Точечная сетка, как миллиметровка' },
];

export const MODULE_SCHEMES: Variant<ModuleSchemeId>[] = [
  { id: 'rainbow', name: 'Радуга', hint: 'У каждого модуля свой цвет — ярко, легко узнать' },
  { id: 'families', name: 'Семьи', hint: 'Четыре цвета по помощникам: Элик, Прото, Нейт, Фоти' },
  { id: 'quiet', name: 'Тихая', hint: 'Модули нейтральные, цвет — только маленькой меткой' },
];

export const SIZES: Variant<SizeId>[] = [
  { id: 's', name: 'Мельче', hint: '15 px' },
  { id: 'm', name: 'Обычно', hint: '16 px' },
  { id: 'l', name: 'Крупнее', hint: '17.5 px' },
];

// Семья модуля = помощник, который за ним присматривает (COMPANIONS.md, концепция D).
export type Family = 'elik' | 'proto' | 'neit' | 'foti';

export const FAMILIES: Record<Family, { companion: string; role: string }> = {
  elik: { companion: 'Элик', role: 'ловит мысли' },
  proto: { companion: 'Прото', role: 'двигает дела' },
  neit: { companion: 'Нейт', role: 'знания и учёба' },
  foti: { companion: 'Фоти', role: 'личное' },
};

export interface ModuleInfo {
  id: string;
  name: string;
  family: Family;
  /** Номер цвета в схеме «Радуга» (1–16). */
  hue: number;
}

export const MODULES: ModuleInfo[] = [
  { id: 'command', name: 'Command', family: 'elik', hue: 1 },
  { id: 'inbox', name: 'Входящие', family: 'elik', hue: 2 },
  { id: 'docs', name: 'Docs', family: 'elik', hue: 3 },
  { id: 'reader', name: 'Reader', family: 'elik', hue: 4 },
  { id: 'today', name: 'Сегодня', family: 'proto', hue: 5 },
  { id: 'planner', name: 'Planner', family: 'proto', hue: 6 },
  { id: 'focus', name: 'Focus', family: 'proto', hue: 7 },
  { id: 'pulse', name: 'Pulse', family: 'proto', hue: 8 },
  { id: 'learn', name: 'Learn', family: 'neit', hue: 9 },
  { id: 'ink', name: 'Ink', family: 'neit', hue: 10 },
  { id: 'atlas', name: 'Atlas', family: 'neit', hue: 11 },
  { id: 'teams', name: 'Teams', family: 'neit', hue: 12 },
  { id: 'life', name: 'Life', family: 'foti', hue: 13 },
  { id: 'home', name: 'Home', family: 'foti', hue: 14 },
  { id: 'finance', name: 'Finance', family: 'foti', hue: 15 },
  { id: 'studio', name: 'Studio', family: 'foti', hue: 16 },
];
