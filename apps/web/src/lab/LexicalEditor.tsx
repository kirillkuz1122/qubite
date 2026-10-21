/**
 * Прототип Б (DOC-001): Lexical (Meta), CRDT — Yjs через `@lexical/yjs`: это родная для
 * Lexical связка (Loro к Lexical официально не подключается). Markdown-шорткаты —
 * `MarkdownShortcutPlugin` с теми же правилами, что у прототипа А.
 */
import { $createCodeNode, CodeNode } from '@lexical/code';
import {
  $createListItemNode,
  $createListNode,
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
  REMOVE_LIST_COMMAND,
  type ListType,
} from '@lexical/list';
import { CHECK_LIST, CODE, HEADING, ORDERED_LIST, QUOTE, UNORDERED_LIST } from '@lexical/markdown';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { LexicalCollaboration } from '@lexical/react/LexicalCollaborationContext';
import { CollaborationPlugin } from '@lexical/react/LexicalCollaborationPlugin';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { $createHeadingNode, $createQuoteNode, HeadingNode, QuoteNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import { $getNearestNodeOfType } from '@lexical/utils';
import type { Provider } from '@lexical/yjs';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  type ElementNode,
  type LexicalEditor as Lexical,
} from 'lexical';
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { SEED, slashQuery, type BlockKind } from './blocks';
import { caretPoint } from './caret';
import type { EditorApi, EditorProps } from './Copy';

const TRANSFORMERS = [HEADING, QUOTE, CHECK_LIST, UNORDERED_LIST, ORDERED_LIST, CODE];

const THEME = {
  paragraph: 'lab-p',
  quote: 'lab-quote',
  code: 'lab-code',
  heading: { h1: 'lab-h1', h2: 'lab-h2' },
  list: {
    ul: 'lab-ul',
    ol: 'lab-ol',
    checklist: 'lab-checklist',
    listitem: 'lab-li',
    listitemChecked: 'lab-li-check lab-li-done',
    listitemUnchecked: 'lab-li-check',
    nested: { listitem: 'lab-li-nested' },
  },
};

/**
 * «Провайдер» без сети: Lexical ждёт объект с `connect` и событием `sync`. Документ
 * уже лежит в памяти, а обмен между копиями делает `Pair`, поэтому здесь — только
 * сообщить «синхронизировано».
 */
class LocalProvider {
  readonly awareness: Awareness;
  private handlers = new Map<string, Set<(arg: never) => void>>();
  constructor(doc: Y.Doc) {
    this.awareness = new Awareness(doc);
  }
  connect() {
    queueMicrotask(() => {
      this.emit('status', { status: 'connected' });
      this.emit('sync', true);
    });
  }
  disconnect() {}
  on(type: string, cb: (arg: never) => void) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(cb);
  }
  off(type: string, cb: (arg: never) => void) {
    this.handlers.get(type)?.delete(cb);
  }
  private emit(type: string, arg: unknown) {
    this.handlers.get(type)?.forEach((cb) => cb(arg as never));
  }
}

/** Начальный конспект узлами Lexical (соседние пункты — в один список). */
function $seed() {
  const root = $getRoot();
  let list: ListNode | null = null;
  let listType: ListType | null = null;
  for (const b of SEED) {
    const type: ListType | null =
      b.kind === 'bullet'
        ? 'bullet'
        : b.kind === 'ordered'
          ? 'number'
          : b.kind === 'check'
            ? 'check'
            : null;
    if (type) {
      if (!list || listType !== type) {
        list = $createListNode(type);
        listType = type;
        root.append(list);
      }
      const item = $createListItemNode(type === 'check' ? !!b.checked : undefined);
      list.append(item.append($createTextNode(b.text)));
      continue;
    }
    list = null;
    listType = null;
    let el: ElementNode;
    if (b.kind === 'h1' || b.kind === 'h2') el = $createHeadingNode(b.kind);
    else if (b.kind === 'quote') el = $createQuoteNode();
    else if (b.kind === 'code') {
      el = $createCodeNode();
      b.text.split('\n').forEach((line, i) => {
        if (i) el.append($createLineBreakNode());
        el.append($createTextNode(line));
      });
      root.append(el);
      continue;
    } else el = $createParagraphNode();
    root.append(el.append($createTextNode(b.text)));
  }
}

const LIST: Partial<Record<BlockKind, ListType>> = {
  bullet: 'bullet',
  ordered: 'number',
  check: 'check',
};

function apply(editor: Lexical, kind: BlockKind, slash: boolean) {
  editor.focus();
  editor.update(() => {
    let sel = $getSelection();
    if (!$isRangeSelection(sel)) return;
    if (slash) {
      const block = sel.anchor.getNode().getTopLevelElement();
      const el = block && 'clear' in block ? (block as ElementNode) : null;
      el?.clear();
      el?.select();
      sel = $getSelection();
      if (!$isRangeSelection(sel)) return;
    }
    const current = $getNearestNodeOfType(sel.anchor.getNode(), ListNode)?.getListType() ?? null;
    const want = LIST[kind];
    if (want) {
      if (current === want) editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      else
        editor.dispatchCommand(
          want === 'bullet'
            ? INSERT_UNORDERED_LIST_COMMAND
            : want === 'number'
              ? INSERT_ORDERED_LIST_COMMAND
              : INSERT_CHECK_LIST_COMMAND,
          undefined,
        );
      return;
    }
    if (current) editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    const create = {
      text: () => $createParagraphNode(),
      h1: () => $createHeadingNode('h1'),
      h2: () => $createHeadingNode('h2'),
      quote: () => $createQuoteNode(),
      code: () => $createCodeNode(),
    }[kind as 'text'];
    $setBlocksType($getSelection(), create);
  });
}

/** Мостик: `/`-меню и команды панели блоков → редактор. */
function Bridge({
  box,
  onSlash,
  apiRef,
}: {
  box: RefObject<HTMLDivElement | null>;
  onSlash: EditorProps['onSlash'];
  apiRef: RefObject<EditorApi | null>;
}) {
  const [editor] = useLexicalComposerContext();
  const slashRef = useRef(onSlash);
  useEffect(() => {
    slashRef.current = onSlash;
  });
  useEffect(() => {
    apiRef.current = { apply: (kind, slash) => apply(editor, kind, slash) };
    return editor.registerUpdateListener(({ editorState }) => {
      const q = editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) return null;
        const block = sel.anchor.getNode().getTopLevelElement();
        return $isParagraphNode(block) ? slashQuery(block.getTextContent()) : null;
      });
      slashRef.current(q === null ? null : { query: q, ...caretPoint(box.current) });
    });
  }, [editor, apiRef, box]);
  return null;
}

export default function LexicalEditor({ doc, seed, label, onSlash, apiRef }: EditorProps) {
  const box = useRef<HTMLDivElement>(null);
  // постоянная ссылка: новая функция на каждый рендер пересоздавала бы провайдер
  const providerFactory = useCallback(
    (id: string, map: Map<string, Y.Doc>) => {
      map.set(id, doc);
      return new LocalProvider(doc) as unknown as Provider;
    },
    [doc],
  );
  return (
    <div ref={box} className="lab-box">
      <LexicalComposer
        initialConfig={{
          namespace: 'qubite-lab',
          // содержимое приходит из Yjs, поэтому своё начальное состояние — null
          editorState: null,
          nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode],
          theme: THEME,
          onError: (e: Error) => {
            throw e;
          },
        }}
      >
        <LexicalCollaboration>
          <RichTextPlugin
            contentEditable={
              <ContentEditable className="lab-doc" aria-label={label} spellCheck={false} />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <ListPlugin />
          <CheckListPlugin />
          <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
          <CollaborationPlugin
            id="lab"
            shouldBootstrap={seed}
            initialEditorState={$seed}
            providerFactory={providerFactory}
          />
          <Bridge box={box} onSlash={onSlash} apiRef={apiRef} />
        </LexicalCollaboration>
      </LexicalComposer>
    </div>
  );
}
