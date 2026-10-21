/**
 * Прототип А (DOC-001): Tiptap 3 поверх ProseMirror, CRDT — Yjs через y-prosemirror
 * (`@tiptap/extension-collaboration`) — это родная для Tiptap связка. Markdown-шорткаты
 * (`#`, `-`, `1.`, `[ ]`, `>`, ```` ``` ````) — правила ввода самого Tiptap.
 */
import Collaboration from '@tiptap/extension-collaboration';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';
import { seedHtml, slashQuery, type BlockKind } from './blocks';
import { caretPoint } from './caret';
import type { EditorProps } from './Copy';

function apply(editor: Editor, kind: BlockKind, slash: boolean) {
  let chain = editor.chain().focus();
  if (slash) {
    const { $from } = editor.state.selection;
    chain = chain.deleteRange({ from: $from.start(), to: $from.end() });
  }
  // список ↔ другой блок: сперва вынуть из списка, потом сделать нужное
  chain = chain.clearNodes();
  const run = {
    text: () => chain.setParagraph(),
    h1: () => chain.setHeading({ level: 1 }),
    h2: () => chain.setHeading({ level: 2 }),
    bullet: () => chain.toggleBulletList(),
    ordered: () => chain.toggleOrderedList(),
    check: () => chain.toggleTaskList(),
    quote: () => chain.toggleBlockquote(),
    code: () => chain.setCodeBlock(),
  }[kind];
  run().run();
}

export default function TiptapEditor({ doc, seed, label, onSlash, apiRef }: EditorProps) {
  const box = useRef<HTMLDivElement>(null);
  const slashRef = useRef(onSlash);
  useEffect(() => {
    slashRef.current = onSlash;
  });
  const editor = useEditor({
    extensions: [
      // свою историю правок держит Yjs, встроенная мешала бы
      StarterKit.configure({ undoRedo: false, link: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Collaboration.configure({ document: doc }),
    ],
    editorProps: { attributes: { 'aria-label': label, class: 'lab-doc', spellcheck: 'false' } },
    onTransaction: ({ editor: ed }) => {
      const { $from, empty } = ed.state.selection;
      const q =
        empty && $from.parent.type.name === 'paragraph'
          ? slashQuery($from.parent.textContent)
          : null;
      slashRef.current(q === null ? null : { query: q, ...caretPoint(box.current) });
    },
  });
  useEffect(() => {
    // StrictMode пересоздаёт редактор: у старого уже нет `commands`
    if (!editor || editor.isDestroyed) return;
    apiRef.current = { apply: (kind, slash) => apply(editor, kind, slash) };
    // пустой документ заполняет одна копия; вторая получит его через пару
    if (seed && doc.getXmlFragment('default').length === 0) {
      editor.commands.setContent(seedHtml());
    }
  }, [editor, seed, doc, apiRef]);
  return (
    <div ref={box} className="lab-box">
      <EditorContent editor={editor} />
    </div>
  );
}
