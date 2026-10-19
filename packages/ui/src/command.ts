/**
 * Строка Command: что человек написал и куда это ляжет. Сам разбор — `parse` (CMD-003), тот же,
 * что на сервере; здесь — только слова для карточки под строкой.
 */
import { durationLabel, labelOf, localNow, parse, type LocalNow, type Parsed } from './parse';

export type CommandKind = 'task' | 'thought' | 'search' | 'journal' | 'note' | 'bookmark';

export interface ParsedCommand {
  kind: CommandKind;
  /** как назвать для человека: «Дело», «Напоминание», «Покупка», «Конспект»… */
  title: string;
  /** куда ляжет */
  where: string;
  /** срок, если нашёлся: «завтра, 16:00», «каждый вт, 17:00» */
  when: string | null;
  /** что ещё понял: срок, длительность, #проект, важность */
  details: string[];
  /** текст без команды, срока и меток */
  text: string;
  /** не уверен — «посмотри сам» и почему (D-199) */
  review: string | null;
  /** полный разбор — то же, что сервер положит в элемент Входящих */
  parse: Parsed;
}

/**
 * Пока нет модулей дел и заметок (PLAN-001, DOC-002), всё кроме поиска ложится во «Входящие»
 * черновиком: разбор сохраняется в элементе, а разложить по местам — одним нажатием.
 */
const WHERE: Record<CommandKind, string> = {
  task: 'Входящие — черновик дела',
  thought: 'Входящие — разберёшь потом',
  search: 'Docs, Ink и Входящие',
  journal: 'Входящие — дневник, видишь только ты',
  note: 'Входящие — черновик заметки',
  bookmark: 'Входящие — закладка',
};

export function parseCommand(input: string, now: LocalNow = localNow()): ParsedCommand | null {
  const p = parse(input, now);
  if (!p) return null;
  const details: string[] = [];
  if (p.kind === 'task') details.push(p.when ?? 'без срока');
  else if (p.when) details.push(p.when);
  if (p.duration_min !== null) details.push(durationLabel(p.duration_min));
  if (p.project) details.push(`#${p.project}`);
  if (p.priority > 0) details.push('!'.repeat(p.priority));
  return {
    kind: p.kind,
    title: labelOf(p),
    where: WHERE[p.kind],
    when: p.when,
    details,
    text: p.title || p.url || '',
    review: p.review,
    parse: p,
  };
}

/** Кто из помощников берёт результат. */
export const COMMAND_OWNER = {
  task: 'proto',
  thought: 'elik',
  search: 'neit',
  journal: 'foti',
  note: 'neit',
  bookmark: 'elik',
} as const;
/** Цвет точки результата. */
export const COMMAND_COLOR = {
  task: 'ink',
  thought: 'yellow',
  search: 'sky',
  journal: 'orange',
  note: 'sky',
  bookmark: 'peach',
} as const;
