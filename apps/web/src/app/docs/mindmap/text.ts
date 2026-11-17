/** Mind map ↔ вложенный Markdown-список (D-1002, DOC-005). */
import type * as Y from 'yjs';
import type { DocLink } from '@qubite/sync-client';
import { readTree, type MindNode, type Outline } from './model';

const MENTION =
  /^\[@((?:\\.|[^\]\\])*)\]\(qubite:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)$/i;

function mentionText(target: string, links: readonly DocLink[]): string {
  const link = links.find((value) => value.id === target);
  const title = (link?.deleted ? 'Удалено' : (link?.title ?? ''))
    .replace(/\\/g, '\\\\')
    .replace(/[[\]]/g, '\\$&')
    .replace(/[\r\n]/g, ' ');
  return `[@${title}](qubite://${target})`;
}

/** Подпись узла: текст или название ссылки из кэша. */
export function nodeLabel(node: MindNode, links: readonly DocLink[] = []): string {
  if (!node.link) return node.text;
  const link = links.find((value) => value.id === node.link!.target);
  return link?.deleted ? 'Удалено' : link?.title || node.text || '…';
}

export function treeMarkdown(tree: MindNode, links: readonly DocLink[] = []): string {
  const lines: string[] = [];
  const walk = (node: MindNode, depth: number) => {
    // Подпись с «[» в начале экранируется: иначе «[x] done» прочитается как галочка списка,
    // а «[@…](qubite://…)» — как ссылка. Исходный «\» в начале тоже: иначе «\[x]» потеряет слеш.
    const text = node.text.trim();
    const label = node.link
      ? mentionText(node.link.target, links)
      : text.startsWith('[') || text.startsWith('\\')
        ? `\\${text}`
        : text;
    lines.push(`${'  '.repeat(depth)}- ${label}`);
    node.children.forEach((child) => walk(child, depth + 1));
  };
  walk(tree, 0);
  return lines.join('\n');
}

export function mindmapMarkdown(doc: Y.Doc, links: readonly DocLink[] = []): string {
  return treeMarkdown(readTree(doc), links);
}

// Пустой пункт («- » или «-») — пустой узел карты: экспорт и импорт обратимы.
const ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])(?:[ \t]+\[[ xX]\])?(?:[ \t]+(.*))?$/;

/**
 * Вложенный список → дерево. Отступ — пробелы или табы (таб = 4); глубина считается по
 * стеку отступов, поэтому подойдут и 2, и 4 пробела. Строки вне списка пропускаются,
 * кроме первого заголовка — он может стать центром.
 */
export function parseOutline(
  markdown: string,
  links: readonly DocLink[] = [],
): { heading: string | null; items: Outline[] } {
  const top: Outline[] = [];
  const stack: { indent: number; item: Outline }[] = [];
  let heading: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const match = ITEM.exec(line);
    if (!match) {
      const head = /^#{1,6}\s+(.+)$/.exec(line.trim());
      if (head && heading === null && !top.length) heading = head[1]!.trim();
      continue;
    }
    const indent = match[1]!.replace(/\t/g, '    ').length;
    const raw = (match[2] ?? '').trim();
    const mention = MENTION.exec(raw);
    const item: Outline = mention
      ? {
          text: mention[1]!.replace(/\\(.)/g, '$1'),
          // Тип ссылки — из кэша целей, как в markdown.ts: событие остаётся событием.
          link: {
            target: mention[2]!.toLowerCase(),
            kind:
              links.find((value) => value.id === mention[2]!.toLowerCase())?.type ?? 'docs.page',
          },
          children: [],
        }
      : { text: /^\\[[\\]/.test(raw) ? raw.slice(1) : raw, children: [] };
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    (parent ? parent.item.children : top).push(item);
    stack.push({ indent, item });
  }
  return { heading, items: top };
}

/** Центр и ветки из Markdown: один пункт верхнего уровня — центр, иначе центр — заголовок/название. */
export function outlineRoot(
  markdown: string,
  title: string,
  links: readonly DocLink[] = [],
): { root: string; branches: Outline[] } {
  const { heading, items } = parseOutline(markdown, links);
  if (items.length === 1 && !items[0]!.link)
    return { root: items[0]!.text, branches: items[0]!.children };
  return { root: heading ?? title, branches: items };
}

/** Шаблон из задания учительницы (D-1003). */
export const COLLOCATIONS_TITLE = 'Collocations: information';
export function collocationsTemplate(): { root: string; branches: Outline[] } {
  const leaves = (words: string[]) => words.map((text) => ({ text, children: [] }));
  return {
    root: 'information',
    branches: [
      {
        text: 'noun + information',
        color: 'sky',
        side: 'r',
        children: leaves(['a piece of ~', 'a source of ~', 'the flow of ~', 'a lack of ~']),
      },
      {
        text: 'adjective + information',
        color: 'green',
        side: 'r',
        children: leaves(['useful ~', 'detailed ~', 'accurate ~', 'up-to-date ~', 'background ~']),
      },
      {
        text: 'verb + information',
        color: 'orange',
        side: 'l',
        children: leaves(['provide ~', 'gather ~', 'share ~', 'access ~', 'obtain ~']),
      },
    ],
  };
}
