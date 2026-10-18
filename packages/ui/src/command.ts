/**
 * Разбор строки Command без AI: что человек написал — дело (со сроком), мысль, поиск или запись в дневник.
 * Это подсказка «куда ляжет»; настоящий разбор — задача CMD-003.
 */
export type CommandKind = 'task' | 'thought' | 'search' | 'journal' | 'note';

export interface ParsedCommand {
  kind: CommandKind;
  /** как назвать для человека */
  title: string;
  /** куда ляжет */
  where: string;
  /** срок, если нашёлся: «завтра, 16:00» */
  when: string | null;
  /** текст без команды в начале (/д, /м …) */
  text: string;
}

const DAY =
  /(сегодня|послезавтра|завтра|в понедельник|во вторник|в среду|в четверг|в пятницу|в субботу|в воскресенье)/i;
const TIME = /\b(\d{1,2})[:.](\d{2})\b/;
/** конец слова: \b в JS работает только с латиницей */
const END = '(?=$|[\\s:,.!?])';
const TASK_VERB =
  /^(сделать|купить|позвонить|прочитать|сдать|написать|решить|повторить|отправить)/i;

export function parseCommand(input: string): ParsedCommand | null {
  const raw = input.trim();
  if (!raw) return null;
  const low = raw.toLowerCase();
  const strip = (re: RegExp) => raw.replace(re, '').trim();
  if (new RegExp(`^/з${END}|^(в дневник|запись в дневник|дневник)${END}`).test(low)) {
    return {
      kind: 'journal',
      title: 'Запись в дневник',
      where: 'Life — видишь только ты',
      when: null,
      text: strip(/^(\/з|в дневник:?|запись в дневник:?|дневник:?)\s*/i),
    };
  }
  if (/^\/к(\s|$)/.test(low)) {
    return {
      kind: 'note',
      title: 'Конспект',
      where: 'новая страница в Docs',
      when: null,
      text: strip(/^\/к\s*/i),
    };
  }
  if (new RegExp(`^/п${END}|^(найти|найди|где|поиск)${END}`).test(low) || low.endsWith('?')) {
    return {
      kind: 'search',
      title: 'Поиск',
      where: 'Docs, Ink и Входящие',
      when: null,
      text: strip(/^(\/п|найти|найди|поиск)\s*/i),
    };
  }
  const day = low.match(DAY)?.[1] ?? null;
  const time = low.match(TIME)?.[0] ?? null;
  if (day || time || /^\/д(\s|$)/.test(low) || TASK_VERB.test(low)) {
    const when = [day, time].filter(Boolean).join(', ') || null;
    return { kind: 'task', title: 'Дело', where: 'Planner', when, text: strip(/^\/д\s*/i) };
  }
  return {
    kind: 'thought',
    title: 'Мысль',
    where: 'Входящие — разберёшь потом',
    when: null,
    text: strip(/^(\/м|идея:?|мысль:?)\s*/i),
  };
}

/** Кто из помощников берёт результат. */
export const COMMAND_OWNER = {
  task: 'proto',
  thought: 'elik',
  search: 'neit',
  journal: 'foti',
  note: 'neit',
} as const;
/** Цвет точки результата. */
export const COMMAND_COLOR = {
  task: 'ink',
  thought: 'yellow',
  search: 'sky',
  journal: 'orange',
  note: 'sky',
} as const;
