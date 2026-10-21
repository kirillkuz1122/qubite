/**
 * Одна «копия» документа в лаборатории: рамка устройства, панель блоков для пальца
 * и `/`-меню. Само поле — редактор прототипа (А или Б) через `EditorProps`; меню и
 * клавиши здесь общие, чтобы прототипы отличались только движком.
 */
import { useRef, useState, type ComponentType, type KeyboardEvent, type RefObject } from 'react';
import type * as Y from 'yjs';
import { BLOCKS, slashItems, type BlockKind } from './blocks';

/** Меню открыто: запрос после `/` и точка под кареткой (относительно поля). */
export interface Slash {
  query: string;
  x: number;
  y: number;
}

export interface EditorApi {
  /** Сделать текущий блок блоком `kind`; `slash` — сперва стереть набранное `/запрос`. */
  apply(kind: BlockKind, slash: boolean): void;
}

export interface EditorProps {
  doc: Y.Doc;
  /** Эта копия заполняет пустой документ начальным конспектом (только одна из двух). */
  seed: boolean;
  label: string;
  onSlash: (s: Slash | null) => void;
  apiRef: RefObject<EditorApi | null>;
}

export function Copy({
  Editor,
  doc,
  index,
  name,
}: {
  Editor: ComponentType<EditorProps>;
  doc: Y.Doc;
  index: 0 | 1;
  name: string;
}) {
  const api = useRef<EditorApi | null>(null);
  const [slash, setSlash] = useState<Slash | null>(null);
  const [active, setActive] = useState(0);
  const items = slash ? slashItems(slash.query) : [];
  const pick = (kind: BlockKind) => {
    api.current?.apply(kind, true);
    setSlash(null);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!slash || items.length === 0) return;
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (step) setActive((a) => (a + step + items.length) % items.length);
    else if (e.key === 'Enter') pick(items[Math.min(active, items.length - 1)]!.kind);
    else if (e.key === 'Escape') setSlash(null);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <section className="lab-copy" aria-label={name}>
      <header className="lab-copy-head">
        <b>{name}</b>
      </header>
      <div className="lab-bar" role="toolbar" aria-label={`Блоки: ${name}`}>
        {BLOCKS.slice(1).map((b) => (
          <button
            key={b.kind}
            type="button"
            title={b.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => api.current?.apply(b.kind, false)}
          >
            {b.hint || b.label}
          </button>
        ))}
      </div>
      <div className="lab-field" onKeyDownCapture={onKey}>
        <Editor
          doc={doc}
          seed={index === 0}
          label={`Документ: ${name}`}
          apiRef={api}
          onSlash={(s) => {
            setSlash(s);
            if (!s) setActive(0);
          }}
        />
        {slash && items.length > 0 && (
          <ul
            className="lab-slash"
            role="listbox"
            aria-label="Вид блока"
            style={{ transform: `translate(${slash.x}px, ${slash.y}px)` }}
          >
            {items.map((b, i) => (
              <li
                key={b.kind}
                role="option"
                aria-selected={i === Math.min(active, items.length - 1)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(b.kind)}
              >
                <span>{b.label}</span>
                <small>{b.hint}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
