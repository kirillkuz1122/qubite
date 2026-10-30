import { LexicalCollaboration } from '@lexical/react/LexicalCollaborationContext';
import { CollaborationPlugin } from '@lexical/react/LexicalCollaborationPlugin';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import type { DocHandle } from '@qubite/sync-client';
import { Button, Check, Presence, useSlide } from '@qubite/ui';
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from 'lexical';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Doc } from 'yjs';
import { caretPoint } from '../../lab/caret';
import { $isBlockNode, $orderedNumber, type BlockKind } from './BlockNode';
import { BLOCKS, slashItems, slashQuery } from './blocks';
import { DOC_NODES, DOC_SHORTCUTS, $exportMarkdown, $importMarkdown } from './markdown';
import { attachMarkdownExport, DocsProvider } from './provider';

interface Slash { query: string; x: number; y: number }
interface Todo { key: string; checked: boolean; label: string; target: HTMLElement }

function $selectedBlocks() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return [];
  const nodes = [...selection.getNodes(), selection.anchor.getNode()];
  return [...new Set(nodes.map((node) => node.getTopLevelElement()).filter($isBlockNode))];
}

function apply(editor: LexicalEditor, kind: BlockKind, slash: boolean) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    if (slash) {
      const block = selection.anchor.getNode().getTopLevelElement();
      if (!$isBlockNode(block) || slashQuery(block.getTextContent()) === null) return;
      // Удаляем только команду. Вид и текст остаются на том же узле.
      block.clear().select();
    }
    $selectedBlocks().forEach((block) => block.setKind(kind));
  });
  editor.focus();
}

export function DocEditor({ handle }: { handle: DocHandle }) {
  const provider = useMemo(() => new DocsProvider(handle.doc), [handle]);
  const providerFactory = useCallback((id: string, map: Map<string, Doc>) => {
    map.set(id, handle.doc);
    return provider.asProvider();
  }, [handle, provider]);

  return (
    <LexicalComposer initialConfig={{
      namespace: 'qubite-docs',
      nodes: DOC_NODES,
      editorState: null,
      theme: { text: { bold: 'docs-bold', italic: 'docs-italic', strikethrough: 'docs-strike', code: 'docs-inline-code' } },
      onError: (error: Error) => { throw error; },
    }}>
      <LexicalCollaboration>
        <RichTextPlugin
          contentEditable={<ContentEditable className="docs-text" aria-label="Текст документа" />}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <MarkdownShortcutPlugin transformers={DOC_SHORTCUTS} />
        <CollaborationPlugin
          id="document"
          providerFactory={providerFactory}
          shouldBootstrap={true}
          initialEditorState={() => $importMarkdown('')}
          syncCursorPositionsFn={() => {}}
        />
        <Controls handle={handle} provider={provider} />
      </LexicalCollaboration>
    </LexicalComposer>
  );
}

function Controls({ handle, provider }: { handle: DocHandle; provider: DocsProvider }) {
  const [editor] = useLexicalComposerContext();
  const [slash, setSlash] = useState<Slash | null>(null);
  const [active, setActive] = useState(0);
  const [selection, setSelection] = useState(false);
  const [todos, setTodos] = useState<Todo[]>([]);
  const bar = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [formatY, setFormatY] = useState(0);
  const highlight = useSlide(44);
  const items = slash ? slashItems(slash.query) : [];
  const pick = useCallback((kind: BlockKind) => {
    apply(editor, kind, true);
    setSlash(null);
  }, [editor]);

  useEffect(() => {
    let alive = true;
    let imported = false;
    // Два вызова в StrictMode не должны повторить импорт.
    const seedKey = 'qubite.seed-imported';
    const importSeed = () => {
      if (!alive || !provider.ready || imported || handle.seedMarkdown === null) return;
      imported = true;
      const seed = handle.seedMarkdown;
      if (!handle.doc.getMap('qubite-local').get(seedKey)) {
        editor.update(() => $importMarkdown(seed, true), { discrete: true });
        handle.doc.getMap('qubite-local').set(seedKey, true);
      }
      void handle.markSeeded().catch(() => { imported = false; });
    };
    const exportText = () => editor.getEditorState().read($exportMarkdown);
    const detach = attachMarkdownExport(handle, exportText);
    const stopReady = provider.subscribeReady(importSeed);
    const stop = handle.onStatus(() => { queueMicrotask(importSeed); });
    importSeed();
    return () => {
      alive = false;
      stop();
      stopReady();
      detach();
    };
  }, [editor, handle, provider]);

  useEffect(() => editor.registerUpdateListener(({ editorState }) => {
    editorState.read(() => {
      const selected = $getSelection();
      const block = $isRangeSelection(selected)
        ? selected.anchor.getNode().getTopLevelElement() : null;
      const query = $isRangeSelection(selected) && selected.isCollapsed() &&
        $isBlockNode(block) && block.getKind() === 'p' ? slashQuery(block.getTextContent()) : null;
      setSlash(query === null ? null : { query, ...caretPoint(editor.getRootElement()) });
      setSelection($isRangeSelection(selected) && !selected.isCollapsed());
      if ($isRangeSelection(selected) && !selected.isCollapsed()) {
        setFormatY(caretPoint(editor.getRootElement()).y);
      }
      // Нумерация зависит также от соседей: обновляем только DOM, не Yjs.
      const checkboxes: Todo[] = [];
      $getRoot().getChildren().filter($isBlockNode).forEach((node) => {
        const dom = editor.getElementByKey(node.getKey());
        if (dom) dom.dataset.number = String($orderedNumber(node));
        const target = dom?.querySelector<HTMLElement>('.docs-block-accessory');
        if (target && node.getKind() === 'todo') checkboxes.push({
          key: node.getKey(), checked: node.getChecked(), label: node.getTextContent(), target,
        });
      });
      setTodos(checkboxes);
    });
  }), [editor]);

  useEffect(() => {
    const stopTab = editor.registerCommand(KEY_TAB_COMMAND, (event) => {
      const blocks = $selectedBlocks();
      if (!blocks.length) return false;
      event.preventDefault();
      blocks.forEach((block) => block.setIndent(block.getIndent() + (event.shiftKey ? -1 : 1)));
      return true;
    }, COMMAND_PRIORITY_HIGH);
    const stopEnter = editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
      if (event?.shiftKey) return false;
      const selected = $getSelection();
      if (!$isRangeSelection(selected) || !selected.isCollapsed()) return false;
      const block = selected.anchor.getNode().getTopLevelElement();
      if (!$isBlockNode(block)) return false;
      if (block.getKind() === 'p' && /^`{3}$/.test(block.getTextContent())) {
        event?.preventDefault();
        block.clear().setKind('code').selectStart();
        return true;
      }
      if (block.getKind() === 'code' && block.getTextContent() !== '') {
        event?.preventDefault();
        selected.insertLineBreak();
        return true;
      }
      if (block.getTextContent() !== '' || block.getKind() === 'p') return false;
      event?.preventDefault();
      block.setKind('p').setIndent(0).setChecked(false);
      return true;
    }, COMMAND_PRIORITY_HIGH);
    return () => { stopTab(); stopEnter(); };
  }, [editor]);

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    const key = (event: KeyboardEvent) => {
      if (!slash) return;
      if (event.key === 'Escape') { setSlash(null); event.preventDefault(); event.stopPropagation(); return; }
      if (!items.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        setActive((value) => (value + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
      } else if (event.key === 'Enter') pick(items[Math.min(active, items.length - 1)]!.kind);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    root.addEventListener('keydown', key, true);
    return () => root.removeEventListener('keydown', key, true);
  }, [editor, slash, items, active, pick]);

  useEffect(() => {
    const row = menu.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (row) highlight.to(row.offsetTop, row.offsetHeight);
  }, [active, slash?.query, highlight.to]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const place = () => {
      // При открытой клавиатуре панель привязана к нижнему краю видимой области.
      bar.current?.style.setProperty('--docs-keyboard', `${Math.max(0,
        window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0),
      )}px`);
    };
    place();
    viewport?.addEventListener('resize', place);
    viewport?.addEventListener('scroll', place);
    return () => { viewport?.removeEventListener('resize', place); viewport?.removeEventListener('scroll', place); };
  }, []);

  const format = (value: TextFormatType) => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, value);
    editor.focus();
  };
  return (
    <>
      {todos.map((todo) => createPortal(
        <Check checked={todo.checked} onChange={(checked) => editor.update(() => {
          const block = $getNodeByKey(todo.key);
          if ($isBlockNode(block)) block.setChecked(checked);
        })}><span className="q-sr">Выполнено: {todo.label || 'Пустой пункт'}</span></Check>,
        todo.target, todo.key,
      ))}
      <Presence show={!!slash && items.length > 0} className="docs-slash-wrap">
        <div ref={menu} className="docs-slash" role="listbox" aria-label="Вид блока"
          style={{ transform: `translate(${slash?.x ?? 0}px, ${slash?.y ?? 0}px)` }}>
          {highlight.node}
          {items.map((block, index) => (
            <div role="option" aria-selected={index === Math.min(active, items.length - 1)} key={block.kind}>
              <Button dot={false} onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={(event) => { setActive(index); highlight.to(event.currentTarget.offsetTop, 44); }}
                onClick={() => pick(block.kind)}>{block.label}</Button>
            </div>
          ))}
        </div>
      </Presence>
      <div ref={bar} className="docs-tools" onMouseDown={(event) => event.preventDefault()}>
        <div className="docs-block-tools" role="toolbar" aria-label="Блоки">
          {BLOCKS.map((block) => (
            <Button key={block.kind} size="sm" dot={false} title={block.label}
              onClick={() => apply(editor, block.kind, false)}>{block.hint || block.label}</Button>
          ))}
          <Button size="sm" dot={false} aria-label="Уменьшить отступ" onClick={() =>
            editor.update(() => $selectedBlocks().forEach((block) => block.setIndent(block.getIndent() - 1)))}>
            Отступ −
          </Button>
          <Button size="sm" dot={false} aria-label="Увеличить отступ" onClick={() =>
            editor.update(() => $selectedBlocks().forEach((block) => block.setIndent(block.getIndent() + 1)))}>
            Отступ +
          </Button>
        </div>
        <Presence show={selection} className="docs-format-wrap">
          <div className="docs-format-tools" role="toolbar" aria-label="Формат текста"
            style={{ transform: `translateY(${formatY}px)` }}>
            <Button size="sm" dot={false} onClick={() => format('bold')}>Жирный</Button>
            <Button size="sm" dot={false} onClick={() => format('italic')}>Курсив</Button>
            <Button size="sm" dot={false} onClick={() => format('strikethrough')}>Зачёркнутый</Button>
            <Button size="sm" dot={false} onClick={() => format('code')}>Код</Button>
          </div>
        </Presence>
      </div>
    </>
  );
}
