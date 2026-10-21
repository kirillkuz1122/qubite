/**
 * Лаборатория редактора (DOC-001): два прототипа на одном сценарии — А (Tiptap) и
 * Б (Lexical). Две копии документа — как ноутбук и телефон: выключи сеть, поправь обе,
 * нажми «Слить две копии». Сервера нет — копии сливаются прямо в браузере.
 * Открывается по прямой ссылке `/lab/editor` и с витрины `/design`; в меню её нет.
 */
import { Button, Segmented, Switch } from '@qubite/ui';
import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
import { Copy } from './Copy';
import { Pair } from './pair';
import './lab.css';

const EDITORS = {
  a: lazy(() => import('./TiptapEditor')),
  b: lazy(() => import('./LexicalEditor')),
};
type Which = keyof typeof EDITORS;

const ABOUT: Record<Which, string> = {
  a: 'Tiptap 3 на ProseMirror · CRDT Yjs (y-prosemirror)',
  b: 'Lexical от Meta · CRDT Yjs (@lexical/yjs)',
};

function readWhich(): Which {
  return new URLSearchParams(location.search).get('v') === 'b' ? 'b' : 'a';
}

export function EditorLab() {
  const [which, setWhich] = useState<Which>(readWhich);
  // смена прототипа — новая пара копий с тем же начальным конспектом
  return <Lab key={which} which={which} setWhich={setWhich} />;
}

function Lab({ which, setWhich }: { which: Which; setWhich: (w: Which) => void }) {
  const [pair] = useState(() => new Pair());
  const state = useSyncExternalStore(
    (fn) => pair.subscribe(fn),
    () => `${pair.isOnline ? 1 : 0}${pair.same() ? 1 : 0}`,
  );
  const online = state[0] === '1';
  const same = state[1] === '1';
  const Editor = EDITORS[which];
  return (
    <main className="lab">
      <header className="lab-head">
        <a className="lab-back" href="/design">
          ← Витрина
        </a>
        <h1>Лаборатория редактора</h1>
        <p className="lab-lead">
          Два прототипа на одном сценарии. Попробуй: <kbd>/</kbd> в пустой строке — меню блоков;
          <kbd>#</kbd>, <kbd>-</kbd>, <kbd>1.</kbd>, <kbd>[ ]</kbd>, <kbd>&gt;</kbd>, <kbd>```</kbd>{' '}
          и пробел — Markdown. Выключи сеть, поправь обе копии и слей их.
        </p>
        <Segmented<Which>
          label="Прототип"
          value={which}
          onChange={(v) => {
            setWhich(v);
            history.replaceState(null, '', `?v=${v}`);
          }}
          options={[
            { value: 'a', label: 'А · Tiptap' },
            { value: 'b', label: 'Б · Lexical' },
          ]}
        />
        <p className="lab-about">{ABOUT[which]}</p>
        <div className="lab-net">
          <Switch label="Сеть" checked={online} onChange={(on) => pair.setOnline(on)} />
          <Button size="sm" onClick={() => pair.merge()} disabled={same}>
            Слить две копии
          </Button>
          <span className="lab-state" role="status" data-same={same}>
            {same ? 'Копии совпадают' : 'Копии разошлись'}
          </span>
        </div>
      </header>
      <Suspense fallback={<p className="lab-wait">Загружаю редактор…</p>}>
        <div className="lab-copies">
          <Copy Editor={Editor} doc={pair.docs[0]} index={0} name="Ноутбук" />
          <Copy Editor={Editor} doc={pair.docs[1]} index={1} name="Телефон" />
        </div>
      </Suspense>
    </main>
  );
}
