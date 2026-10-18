import { loop } from '@qubite/motion';
import { Button, Companion, Segmented, useFlip, useSpring, type CompanionHandle } from '@qubite/ui';
import { useEffect, useRef, useState } from 'react';
import { useShell } from '../context';
import type { InboxAct, InboxFrom, InboxItem } from '../data';
import { useStore } from '../state';

type Filter = 'all' | Exclude<InboxFrom, 'text'>;

export function InboxScreen() {
  const { state, dispatch } = useStore();
  const shell = useShell();
  const [filter, setFilter] = useState<Filter>('all');
  const box = useRef<HTMLDivElement>(null);
  const shown = state.inbox.filter((x) => filter === 'all' || x.from === filter);
  useFlip(box, shown.map((x) => x.id).join());
  const n = (f: InboxFrom) => state.inbox.filter((x) => x.from === f).length;

  function act(it: InboxItem, to: InboxAct, dot: DOMRect | undefined) {
    if (to === 'later') {
      dispatch({ type: 'inbox.later', id: it.id });
      return;
    }
    shell.fly({ x: (dot?.left ?? 0) + 5, y: (dot?.top ?? 0) + 5 }, to, 'yellow', () => {
      if (to === 'planner') dispatch({ type: 'task.add', title: it.text, time: null });
      if (to === 'docs') dispatch({ type: 'doc.add', name: it.text });
    });
    shell.cheer('elik');
    setTimeout(() => dispatch({ type: 'inbox.remove', id: it.id }), 200);
  }

  return (
    <>
      <div className="chips-row">
        <Segmented<Filter>
          variant="chips"
          label="Откуда"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Все', count: state.inbox.length },
            { value: 'voice', label: 'Голос', count: n('voice') },
            { value: 'link', label: 'Ссылки', count: n('link') },
            { value: 'tg', label: 'Telegram', count: n('tg') },
          ]}
        />
      </div>
      <div className="items" ref={box}>
        {shown.map((it) => (
          <Item key={it.id} it={it} fresh={it.time === 'сейчас'} onAct={act} />
        ))}
      </div>
      {state.inbox.length === 0 && <Empty />}
    </>
  );
}

/** Какие новые мысли уже показали появление. */
const GROWN = new Set<string>();

function Item({
  it,
  fresh,
  onAct,
}: {
  it: InboxItem;
  fresh: boolean;
  onAct: (it: InboxItem, to: InboxAct, dot: DOMRect | undefined) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  /* новая мысль вырастает один раз — при первом показе */
  const [grow] = useState(() => {
    const g = fresh && !GROWN.has(it.id);
    GROWN.add(it.id);
    return g;
  });
  const sp = useSpring(grow ? 0 : 1, 0.7, (v) => {
    const d = el.current;
    if (!d) return;
    d.style.opacity = Math.min(1, Math.max(0, v)).toFixed(3);
    d.style.transform =
      v === 1 ? '' : `scaleY(${Math.min(1.2, Math.max(0, 0.4 + v * 0.6)).toFixed(3)})`;
  });
  useEffect(() => {
    sp.emit();
    loop().to(sp, 1);
  }, [sp]);
  return (
    <div className="item" ref={el} data-flip={it.id}>
      <span className="q-dot" ref={dot} />
      <div className="t">
        <div className="txt">{it.text}</div>
        <div className="src">
          {it.src} · {it.time}
        </div>
        <div className="elik">
          <i />
          <span>Элик: {it.hint}</span>
          {it.acts.map(([label, to]) => (
            <Button
              key={to}
              size="sm"
              dot={false}
              onClick={() => {
                const r = dot.current?.getBoundingClientRect();
                if (to !== 'later') loop().to(sp, 0);
                onAct(it, to, r);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Пусто: Элик дремлет, пока не появится новая мысль. */
function Empty() {
  const elik = useRef<CompanionHandle>(null);
  useEffect(() => {
    const t = setTimeout(() => elik.current?.turnAway(true), 900);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="empty">
      <Companion ref={elik} kind="elik" pitch={6.5} label="Элик дремлет" />
      <div>
        Пусто — всё разобрано.
        <br />
        Элик дремлет, пока не появится новая мысль.
      </div>
    </div>
  );
}
