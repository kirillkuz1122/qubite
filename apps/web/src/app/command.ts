/**
 * Qubite Command (CMD-002): что найти по строке — разделы, настройки, быстрые действия и объекты
 * (дела, мысли во «Входящих», документы). Всё ищется на устройстве, без сети и без AI.
 * Здесь только данные: что нашлось и что сделать при выборе; делает оболочка (`AppShell`).
 */
import { matchScore, type CommandHit, type ParsedCommand, type ThemeChoice } from '@qubite/ui';
import { SECTIONS, type Day, type InboxItem, type SectionId } from './data';
import type { State } from './state';

/** Где искать объекты: дела недели (Planner, PLAN-001) и документы. */
export type CommandData = Pick<State, 'docs'> & { week: Day[] };

/** Что сделать, когда пункт выбран. */
export type CommandRun =
  /** открыть раздел; `obj` — показать объект на экране, `open` — сразу открыть его */
  | { type: 'go'; to: SectionId; obj?: string; open?: boolean }
  | { type: 'theme'; value: ThemeChoice }
  /** подставить текст в строку: «/д » или запрос из недавнего */
  | { type: 'fill'; text: string }
  | { type: 'history.clear' }
  /** сохранить строку как мысль (когда поиск ничего не нашёл) */
  | { type: 'save' };

export interface CommandEntry extends CommandHit {
  run: CommandRun;
  /** раздел, действие и настройка могут стать выбором по Enter; объекты — нет */
  group: 'section' | 'action' | 'setting' | 'object';
  keywords?: readonly string[];
}

const SECTION_WORDS: Record<SectionId, string[]> = {
  today: ['главная', 'домой', 'день', 'today'],
  inbox: ['входящие', 'мысли', 'идеи', 'inbox', 'элик'],
  planner: ['планер', 'планировщик', 'дела', 'неделя', 'задачи', 'проекты', 'прото'],
  docs: ['доки', 'документы', 'конспекты', 'заметки', 'нейт'],
  settings: ['настройки', 'параметры', 'вид', 'settings', 'фоти'],
};

const SECTION_COLOR = {
  today: 'orange',
  inbox: 'yellow',
  planner: 'ink',
  docs: 'sky',
  settings: 'mute',
} as const;

function sectionEntries(): CommandEntry[] {
  return SECTIONS.map((s) => ({
    id: `go-${s.id}`,
    title: s.name,
    where: 'открыть раздел',
    color: SECTION_COLOR[s.id],
    group: 'section',
    keywords: SECTION_WORDS[s.id],
    run: { type: 'go', to: s.id },
  }));
}

const SETTINGS: [string, string, string[]][] = [
  ['set-theme', 'Тема', ['темная', 'светлая', 'авто', 'цвет', 'ночь']],
  ['set-shape', 'Форма точки', ['круг', 'квадрат', 'скругление']],
  ['set-size', 'Размер точки', ['точки', 'крупнее', 'мельче']],
  ['set-tempo', 'Живость', ['скорость', 'анимации', 'движение']],
  ['set-lite', 'Облегчённый режим', ['слабый', 'телефон', 'батарея', 'лагает', 'тормозит']],
  ['set-motion', 'Меньше движения', ['анимации', 'укачивает', 'движение']],
  ['set-helper-elik', 'Элик', ['помощник', 'помощники', 'маскот']],
  ['set-helper-proto', 'Прото', ['помощник', 'помощники', 'маскот']],
  ['set-helper-neit', 'Нейт', ['помощник', 'помощники', 'маскот']],
  ['set-helper-foti', 'Фоти', ['помощник', 'помощники', 'маскот']],
  ['set-account', 'Аккаунт', ['профиль', 'устройства', 'выйти']],
  ['set-backup', 'Экспорт и бэкапы', ['резервная', 'копия', 'бэкап', 'экспорт']],
  ['set-ai', 'AI и бюджет', ['ии', 'лимит', 'деньги', 'модели']],
];

function settingEntries(): CommandEntry[] {
  return SETTINGS.map(([obj, title, keywords]) => ({
    id: obj,
    title,
    where: 'Настройки',
    color: 'mute',
    group: 'setting',
    keywords,
    run: { type: 'go', to: 'settings', obj },
  }));
}

function actionEntries(): CommandEntry[] {
  const theme = (value: ThemeChoice, title: string, keywords: string[]): CommandEntry => ({
    id: `theme-${value}`,
    title,
    where: 'сменить тему',
    color: 'mute',
    group: 'action',
    keywords: ['тема', ...keywords],
    run: { type: 'theme', value },
  });
  const create = (text: string, title: string, color: CommandHit['color']): CommandEntry => ({
    id: `new-${text.trim()}`,
    title,
    where: `начать строку с ${text.trim()}`,
    color,
    group: 'action',
    keywords: ['новое', 'новая', 'новый', 'создать', 'добавить'],
    run: { type: 'fill', text },
  });
  return [
    theme('dark', 'Тёмная тема', ['ночь', 'темно']),
    theme('light', 'Светлая тема', ['день', 'светло', 'бумага']),
    theme('auto', 'Тема как в системе', ['авто', 'система']),
    create('/д ', 'Новое дело', 'ink'),
    create('/м ', 'Новая мысль', 'yellow'),
    create('/к ', 'Новый конспект', 'sky'),
    create('/з ', 'Запись в дневник', 'orange'),
    {
      id: 'history-clear',
      title: 'Очистить недавнее',
      where: 'забыть историю строки на этом устройстве',
      color: 'mute',
      group: 'action',
      keywords: ['история', 'недавнее', 'стереть', 'забыть'],
      run: { type: 'history.clear' },
    },
  ];
}

/** Дела недели, мысли и документы. Дела «сегодня» показываются на «Сегодня», остальные — в Planner. */
function objectEntries(state: CommandData, inbox: readonly InboxItem[]): CommandEntry[] {
  const out: CommandEntry[] = [];
  for (const day of state.week)
    for (const t of day.tasks)
      out.push({
        id: `task-${t.id}`,
        title: t.title,
        where: `${day.today ? 'Сегодня' : `Planner · ${day.d} ${day.n}`} · ${t.done ? 'сделано' : t.time}`,
        color: t.done ? 'faint' : t.color,
        group: 'object',
        keywords: [t.tag ?? '', 'дело'],
        run: day.today ? { type: 'go', to: 'today', obj: t.id } : { type: 'go', to: 'planner' },
      });
  for (const it of inbox)
    out.push({
      id: `inbox-${it.id}`,
      title: it.text,
      where: `Входящие · ${it.time}`,
      color: 'yellow',
      group: 'object',
      keywords: ['мысль'],
      run: { type: 'go', to: 'inbox', obj: it.id },
    });
  for (const d of state.docs)
    out.push({
      id: `doc-${d.id}`,
      title: d.name,
      where: `Docs · ${d.when}`,
      color: d.tags[0]?.[0] ?? 'sky',
      group: 'object',
      keywords: [d.pre, ...d.tags.map(([, t]) => t)],
      run: { type: 'go', to: 'docs', obj: d.id, open: true },
    });
  return out;
}

const WEIGHT = { section: 1.25, action: 1.15, setting: 1.05, object: 1 } as const;
export const MAX_HITS = 6;

/** Найти по запросу: лучшие сверху, не больше `MAX_HITS`. */
export function findEntries(
  query: string,
  state: CommandData,
  inbox: readonly InboxItem[],
): (CommandEntry & { score: number })[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const all = [
    ...sectionEntries(),
    ...actionEntries(),
    ...settingEntries(),
    ...objectEntries(state, inbox),
  ];
  return all
    .map((e) => ({ ...e, score: matchScore(q, e.title, e.keywords) * WEIGHT[e.group] }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_HITS);
}

export interface CommandView {
  /** строка «куда ляжет»; для поиска её нет — сразу найденное */
  parsed: ParsedCommand | null;
  hits: CommandEntry[];
  heading?: string | undefined;
  /** что выбрано сразу (Enter): 0 — «куда ляжет», дальше — найденное, -1 — ничего */
  active: number;
}

/**
 * Что показать под строкой. Enter по умолчанию — **сохранить** (дело, мысль, конспект…);
 * «найди …», «/п …» и вопрос — сразу первое найденное. Одно-два слова, которые точно называют
 * раздел, настройку или действие («настройки», «светлая тема»), — открыть его, а не записать мысль.
 */
export function commandView(
  value: string,
  parsed: ParsedCommand | null,
  state: CommandData,
  inbox: readonly InboxItem[],
  history: readonly string[],
): CommandView {
  if (!parsed) {
    const hits = history.slice(0, 5).map<CommandEntry>((text, i) => ({
      id: `recent-${i}`,
      title: text,
      where: 'недавнее — подставить в строку',
      color: 'faint',
      group: 'object',
      run: { type: 'fill', text },
    }));
    return { parsed: null, hits, heading: 'Недавнее', active: -1 };
  }
  if (parsed.kind === 'search') {
    const hits = findEntries(parsed.text, state, inbox);
    if (!hits.length)
      hits.push({
        id: 'nothing',
        title: parsed.text ? `«${parsed.text}» не нашлось` : 'Что найти?',
        where: parsed.text ? 'сохранить как мысль во «Входящие»' : 'напиши, что ищешь',
        color: 'faint',
        group: 'object',
        run: { type: 'save' },
        score: 0,
      });
    return { parsed: null, hits, heading: 'Найдено', active: 0 };
  }
  const hits = findEntries(parsed.text || value, state, inbox);
  const top = hits[0];
  const short = value.trim().split(/\s+/).length <= 2;
  const exact =
    parsed.kind === 'thought' && short && top && top.group !== 'object' && top.score >= 2.5;
  return { parsed, hits, heading: hits.length ? 'Ещё нашлось' : undefined, active: exact ? 1 : 0 };
}

/* ---------- недавнее: последние строки, только на этом устройстве ---------- */

const HISTORY_KEY = 'qubite.command.history.v1';
const HISTORY_MAX = 20;

export function loadHistory(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Запомнить строку. Дневник не запоминается: он личный (Life — видишь только ты),
 * а недавнее видно любому, кто откроет строку на этом устройстве.
 */
export function remember(history: readonly string[], text: string, kind: ParsedCommand['kind']) {
  const t = text.trim();
  if (!t || kind === 'journal') return [...history];
  const next = [t, ...history.filter((h) => h !== t)].slice(0, HISTORY_MAX);
  saveHistory(next);
  return next;
}

export function saveHistory(list: readonly string[]) {
  try {
    if (list.length) localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    else localStorage.removeItem(HISTORY_KEY);
  } catch {
    // приватное окно или запрет хранилища — недавнее просто не сохранится
  }
}
