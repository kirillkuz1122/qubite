/**
 * Общее для обоих прототипов редактора: виды блоков, пункты `/`-меню и одинаковый
 * начальный документ — чтобы сравнение А и Б было на одном сценарии (DOC-001).
 */

export type BlockKind = 'text' | 'h1' | 'h2' | 'bullet' | 'ordered' | 'check' | 'quote' | 'code';

export const BLOCKS: { kind: BlockKind; label: string; hint: string; words: string[] }[] = [
  { kind: 'text', label: 'Текст', hint: '', words: ['текст', 'абзац', 'text', 'p'] },
  { kind: 'h1', label: 'Заголовок', hint: '#', words: ['заголовок', 'heading', 'h1'] },
  { kind: 'h2', label: 'Подзаголовок', hint: '##', words: ['подзаголовок', 'h2'] },
  { kind: 'bullet', label: 'Список', hint: '-', words: ['список', 'list', 'ul'] },
  { kind: 'ordered', label: 'Нумерованный', hint: '1.', words: ['нумерованный', 'номер', 'ol'] },
  { kind: 'check', label: 'Чек-лист', hint: '[ ]', words: ['чек-лист', 'дело', 'todo', 'check'] },
  { kind: 'quote', label: 'Цитата', hint: '>', words: ['цитата', 'quote'] },
  { kind: 'code', label: 'Код', hint: '```', words: ['код', 'code'] },
];

/** Пункты меню под запрос после `/`: по началу любого слова, без учёта регистра. */
export function slashItems(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return BLOCKS;
  return BLOCKS.filter((b) => b.words.some((w) => w.startsWith(q)));
}

/** Текст блока — это `/запрос`? Тогда открываем меню. */
export function slashQuery(text: string): string | null {
  const m = /^\/([\p{L}\p{N}-]{0,20})$/u.exec(text);
  return m ? m[1]! : null;
}

export interface SeedBlock {
  kind: BlockKind;
  text: string;
  checked?: boolean;
}

/** Начальный документ — конспект, где есть все виды блоков. */
export const SEED: SeedBlock[] = [
  { kind: 'h1', text: 'Конспект: графы' },
  { kind: 'text', text: 'Граф — это вершины и рёбра между ними.' },
  { kind: 'bullet', text: 'обход в ширину' },
  { kind: 'bullet', text: 'обход в глубину' },
  { kind: 'check', text: 'решить задачу 3', checked: true },
  { kind: 'check', text: 'повторить Дейкстру' },
  { kind: 'quote', text: 'Сначала нарисуй граф на бумаге.' },
  { kind: 'code', text: 'for v in graph[u]:\n    visit(v)' },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Тот же документ в HTML — для Tiptap (соседние пункты списка — в один список). */
export function seedHtml(seed: SeedBlock[] = SEED) {
  let html = '';
  let open: 'bullet' | 'ordered' | 'check' | null = null;
  const close = () => {
    if (open) html += open === 'ordered' ? '</ol>' : '</ul>';
    open = null;
  };
  for (const b of seed) {
    const list = b.kind === 'bullet' || b.kind === 'ordered' || b.kind === 'check' ? b.kind : null;
    if (list !== open) {
      close();
      if (list === 'check') html += '<ul data-type="taskList">';
      else if (list === 'ordered') html += '<ol>';
      else if (list) html += '<ul>';
      open = list;
    }
    const t = esc(b.text);
    if (b.kind === 'check')
      html += `<li data-type="taskItem" data-checked="${b.checked ? 'true' : 'false'}"><p>${t}</p></li>`;
    else if (list) html += `<li><p>${t}</p></li>`;
    else if (b.kind === 'h1') html += `<h1>${t}</h1>`;
    else if (b.kind === 'h2') html += `<h2>${t}</h2>`;
    else if (b.kind === 'quote') html += `<blockquote><p>${t}</p></blockquote>`;
    else if (b.kind === 'code') html += `<pre><code>${t}</code></pre>`;
    else html += `<p>${t}</p>`;
  }
  close();
  return html;
}
