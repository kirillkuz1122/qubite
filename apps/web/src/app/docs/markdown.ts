import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TEXT_FORMAT_TRANSFORMERS,
  type ElementTransformer,
  type MultilineElementTransformer,
  type Transformer,
} from '@lexical/markdown';
import { $createTextNode, $getRoot, ParagraphNode } from 'lexical';
import {
  $createBlockNode,
  $isBlockNode,
  $orderedNumber,
  BlockNode,
  type BlockKind,
} from './BlockNode';

/** Все создаваемые Lexical абзацы (Enter, вставка, Markdown) — наши плоские блоки. */
export const DOC_NODES = [
  BlockNode,
  {
    replace: ParagraphNode,
    with: () => $createBlockNode(),
    withKlass: BlockNode,
  },
];

const markers: { kind: BlockKind; pattern: RegExp; prefix: string }[] = [
  { kind: 'h2', pattern: /^(\s*)##\s/, prefix: '## ' },
  { kind: 'h1', pattern: /^(\s*)#\s/, prefix: '# ' },
  { kind: 'todo', pattern: /^(\s*)(?:-\s)?\[([ xX])\]\s/, prefix: '' },
  { kind: 'ul', pattern: /^(\s*)[-*+]\s/, prefix: '- ' },
  { kind: 'ol', pattern: /^(\s*)\d+\.\s/, prefix: '' },
  { kind: 'quote', pattern: /^(\s*)>\s?/, prefix: '> ' },
];

const blocks: ElementTransformer[] = markers.map(({ kind, pattern, prefix }) => ({
  type: 'element',
  dependencies: [BlockNode],
  regExp: pattern,
  export(node, children) {
    if (!$isBlockNode(node) || node.getKind() !== kind) return null;
    const marker =
      kind === 'todo'
        ? `- [${node.getChecked() ? 'x' : ' '}] `
        : kind === 'ol'
          ? `${$orderedNumber(node)}. `
          : prefix;
    return `${'  '.repeat(node.getIndent())}${marker}${children(node)}`;
  },
  replace(parent, _children, match) {
    if (!$isBlockNode(parent) || parent.getKind() === 'code') return false;
    parent.setKind(kind).setIndent(Math.floor((match[1]?.length ?? 0) / 2));
    if (kind === 'todo') parent.setChecked(match[2]?.toLowerCase() === 'x');
  },
}));

const code: MultilineElementTransformer = {
  type: 'multiline-element',
  dependencies: [BlockNode],
  regExpStart: /^(\s*)(`{3,})[^`]*$/,
  regExpEnd: { regExp: /^\s*`{3,}\s*$/, optional: true },
  handleImportAfterStartMatch({ lines, rootNode, startLineIndex, startMatch }) {
    let end = startLineIndex + 1;
    const fenceLength = startMatch[2]!.length;
    while (end < lines.length) {
      const closing = lines[end]!.trim();
      if (/^`+$/.test(closing) && closing.length >= fenceLength) break;
      end++;
    }
    rootNode.append(
      $createBlockNode('code')
        .setIndent(Math.floor((startMatch[1]?.length ?? 0) / 2))
        .append($createTextNode(lines.slice(startLineIndex + 1, end).join('\n'))),
    );
    return [true, Math.min(end, lines.length - 1)];
  },
  export(node) {
    if (!$isBlockNode(node) || node.getKind() !== 'code') return null;
    const text = node.getTextContent();
    const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((s) => s.length));
    const fence = '`'.repeat(longest + 1);
    const indent = '  '.repeat(node.getIndent());
    return `${indent}${fence}\n${text}\n${indent}${fence}`;
  },
  replace(parent, _children, start, _end, lines, isImport) {
    if (isImport) {
      parent.append(
        $createBlockNode('code')
          .setIndent(Math.floor((start[1]?.length ?? 0) / 2))
          .append($createTextNode((lines ?? []).join('\n'))),
      );
    } else if ($isBlockNode(parent)) {
      parent.setKind('code');
    } else return false;
  },
};

const paragraph: ElementTransformer = {
  type: 'element',
  dependencies: [BlockNode],
  regExp: /^( {2,})/,
  export(node, children) {
    return $isBlockNode(node) && node.getKind() === 'p'
      ? `${'  '.repeat(node.getIndent())}${children(node)}`
      : null;
  },
  replace(parent, _children, match) {
    if (!$isBlockNode(parent)) return false;
    parent.setIndent(Math.floor((match[1]?.length ?? 0) / 2));
  },
};

export const DOC_TRANSFORMERS: Transformer[] = [
  code,
  ...blocks,
  paragraph,
  ...TEXT_FORMAT_TRANSFORMERS,
];
// Внутри code текст остаётся буквальным; inline-форматирование задаётся панелью.
export const DOC_SHORTCUTS: Transformer[] = [code, ...blocks];

/** append=true сохраняет уже набранное без сети при позднем получении старого Markdown. */
export function $importMarkdown(markdown: string, append = false): void {
  const root = $getRoot();
  const existing = append ? root.getChildren() : [];
  // Отсоединяем, а потом возвращаем те же узлы: ключи и текст не меняются.
  existing.forEach((node) => node.remove());
  $convertFromMarkdownString(markdown, DOC_TRANSFORMERS, root, true);
  if (existing.length) {
    // Пустой seed тоже обработан; лишний пустой абзац к офлайн-тексту не нужен.
    if (!markdown) root.clear();
    root.append(...existing);
  }
  if (root.isEmpty()) root.append($createBlockNode());
}

export function $exportMarkdown(): string {
  return $convertToMarkdownString(DOC_TRANSFORMERS, $getRoot(), true);
}

/** Добавить сохранённый локальный вариант после всех нынешних блоков. */
export function $appendMarkdown(markdown: string): void {
  const root = $getRoot();
  const existing = root.getChildren();
  existing.forEach((node) => node.remove());
  $importMarkdown(markdown);
  const added = root.getChildren();
  added.forEach((node) => node.remove());
  root.append(...existing, ...added);
}
