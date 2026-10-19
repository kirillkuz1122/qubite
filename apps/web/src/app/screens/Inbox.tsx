import { loop } from '@qubite/motion';
import {
  Button,
  Companion,
  Segmented,
  useFlip,
  useLeaving,
  useSpring,
  type CompanionHandle,
} from '@qubite/ui';
import { useEffect, useRef, useState } from 'react';
import { useShell } from '../context';
import type { InboxAct, InboxFrom, InboxItem } from '../data';
import { useInbox } from '../inbox-context';
import { usePlanner } from '../planner-context';
import { useStore } from '../state';

type Filter = 'all' | Exclude<InboxFrom, 'text'>;

export function InboxScreen() {
  const { dispatch } = useStore();
  const inbox = useInbox();
  const planner = usePlanner();
  const shell = useShell();
  const [filter, setFilter] = useState<Filter>('all');
  const box = useRef<HTMLDivElement>(null);
  const shown = inbox.items.filter((x) => filter === 'all' || x.from === filter);
  /* пропавшие из списка (фильтр, разобрали) сначала тают, новые выезжают по очереди, соседи доезжают */
  const [rows, gone] = useLeaving(shown, (x) => x.id);
  useFlip(box, rows.map((r) => r.item.id + (r.leaving ? '~' : '')).join());
  /* когда список впервые показан: строки, что появились позже (сменили фильтр), выезжают */
  const [born] = useState(() => performance.now());
  const n = (f: InboxFrom) => inbox.items.filter((x) => x.from === f).length;

  function act(it: InboxItem, to: InboxAct, dot: DOMRect | undefined) {
    if (to === 'later') {
      inbox.later(it.id);
      return;
    }
    shell.fly({ x: (dot?.left ?? 0) + 5, y: (dot?.top ?? 0) + 5 }, to, 'yellow', () => {
      if (to === 'planner') void planner.add(it.text, { fromInbox: it.id });
      if (to === 'docs') dispatch({ type: 'doc.add', name: it.text });
    });
    shell.cheer('elik');
    /* разобрано — в архив (не удаляется); на других устройствах тоже пропадёт */
    setTimeout(() => void inbox.done(it.id), 200);
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
            { value: 'all', label: 'Все', count: inbox.items.length },
            { value: 'voice', label: 'Голос', count: n('voice') },
            { value: 'link', label: 'Ссылки', count: n('link') },
            { value: 'tg', label: 'Telegram', count: n('tg') },
          ]}
        />
      </div>
      <div className="items" ref={box}>
        {rows.map(({ item: it, leaving }, i) => (
          <Item
            key={it.id}
            it={it}
            fresh={it.time === 'сейчас'}
            born={born}
            order={i}
            leaving={leaving}
            onGone={gone}
            onAct={act}
          />
        ))}
      </div>
      {inbox.items.length === 0 && <Empty />}
    </>
  );
}

/** Какие новые мысли уже показали появление. */
const GROWN = new Set<string>();

function Item({
  it,
  fresh,
  born,
  order,
  leaving,
  onGone,
  onAct,
}: {
  it: InboxItem;
  fresh: boolean;
  /** когда список впервые показан; строка, появившаяся позже, выезжает */
  born: number;
  /** место в списке — для очереди выезда */
  order: number;
  leaving: boolean;
  onGone: (id: string) => void;
  onAct: (it: InboxItem, to: InboxAct, dot: DOMRect | undefined) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  /* новая мысль вырастает один раз — при первом показе */
  const [enter] = useState(() => performance.now() - born > 300);
  const [grow] = useState(() => {
    const g = (fresh && !GROWN.has(it.id)) || enter;
    GROWN.add(it.id);
    return g;
  });
  const [delay] = useState(() => (enter ? Math.min(order, 8) * 40 : 0));
  const goneRef = useRef(onGone);
  const leavingRef = useRef(leaving);
  useEffect(() => {
    goneRef.current = onGone;
    leavingRef.current = leaving;
  });
  const sp = useSpring(grow ? 0 : 1, 0.7, (v) => {
    const d = el.current;
    if (!d) return;
    d.style.opacity = Math.min(1, Math.max(0, v)).toFixed(3);
    d.style.transform =
      v === 1 ? '' : `scaleY(${Math.min(1.2, Math.max(0, 0.4 + v * 0.6)).toFixed(3)})`;
    if (leavingRef.current && v < 0.03) goneRef.current(it.id);
  });
  useEffect(() => {
    sp.emit();
    if (leaving) {
      loop().to(sp, 0);
      return;
    }
    const t = setTimeout(() => loop().to(sp, 1), delay);
    return () => clearTimeout(t);
  }, [sp, leaving, delay]);
  return (
    <div className="item" ref={el} data-flip={it.id} data-obj={it.id}>
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
