import { loop } from '@qubite/motion';
import { createDoc } from '@qubite/sync-client';
import {
  Button,
  Companion,
  ElikDots,
  Note,
  Segmented,
  useFlip,
  useLeaving,
  useSpring,
  type CompanionHandle,
  type ElikMood,
} from '@qubite/ui';
import { useEffect, useRef, useState } from 'react';
import { useShell } from '../context';
import type { InboxAct, InboxFrom, InboxItem } from '../data';
import { useInbox } from '../inbox-context';
import { withThinking } from '../inbox-view';
import { usePlanner } from '../planner-context';
import { useSync } from '../sync-context';
import { useAnswer, useTriage, useUndoFiled, type Filed } from '../triage';
import { useRevertWhy } from '../agent';
import { SecHead } from '../parts';

type Filter = 'all' | Exclude<InboxFrom, 'text'>;

export function InboxScreen() {
  const inbox = useInbox();
  const planner = usePlanner();
  const shell = useShell();
  const { client, version, ready } = useSync();
  const [docError, setDocError] = useState(false);
  const moving = useRef(new Set<string>());
  /* агент раскладывает сам (CMD-004): что он обдумывает и что уже разложил */
  const triage = useTriage(version);
  const answer = useAnswer();
  const [filter, setFilter] = useState<Filter>('all');
  const box = useRef<HTMLDivElement>(null);
  const items = withThinking(inbox.items, triage.data?.thinking ?? []);
  const shown = items.filter((x) => filter === 'all' || x.from === filter);
  /* пропавшие из списка (фильтр, разобрали) сначала тают, новые выезжают по очереди, соседи доезжают */
  const [rows, gone] = useLeaving(shown, (x) => x.id);
  useFlip(box, rows.map((r) => r.item.id + (r.leaving ? '~' : '')).join());
  /* когда список впервые показан: строки, что появились позже (сменили фильтр), выезжают */
  const [born] = useState(() => performance.now());
  const n = (f: InboxFrom) => inbox.items.filter((x) => x.from === f).length;

  function reply(it: InboxItem, text: string) {
    answer.mutate({ item: it.id, answer: text });
  }

  function act(it: InboxItem, to: InboxAct, dot: DOMRect | undefined) {
    if (to === 'later') {
      inbox.later(it.id);
      return;
    }
    if (to === 'docs') {
      if (moving.current.has(it.id)) return;
      moving.current.add(it.id);
      setDocError(false);
      shell.fly({ x: (dot?.left ?? 0) + 5, y: (dot?.top ?? 0) + 5 }, to, 'yellow', () => {
        void (async () => {
          try {
            const sync = await ready();
            await createDoc(sync, it.text);
            // В архив — только после записи документа на устройство.
            await inbox.done(it.id);
            void sync.sync();
          } catch { setDocError(true); }
          finally { moving.current.delete(it.id); }
        })();
      });
      shell.cheer('elik');
      return;
    }
    shell.fly({ x: (dot?.left ?? 0) + 5, y: (dot?.top ?? 0) + 5 }, to, 'yellow', () => {
      if (to === 'planner') void planner.add(it.text, { fromInbox: it.id });
    });
    shell.cheer('elik');
    /* разобрано — в архив (не удаляется); на других устройствах тоже пропадёт */
    setTimeout(() => void inbox.done(it.id), 200);
  }

  return (
    <>
      {docError && <Note tone="bad">Документ не записался. Мысль осталась во Входящих — попробуйте ещё раз.</Note>}
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
            onAnswer={reply}
          />
        ))}
      </div>
      {inbox.items.length === 0 && <Empty />}
      <FiledList
        filed={triage.data?.filed ?? []}
        onBack={() => void client?.sync()}
        onCheer={() => shell.cheer('elik')}
      />
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
  onAnswer,
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
  /** ответ на вопрос агента «посмотри сам» */
  onAnswer: (it: InboxItem, answer: string) => void;
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
          <ElikDots mood={it.mood ?? 'idle'} />
          <span>Элик: {it.hint}</span>
          {(it.answers ?? []).map((a) => (
            <Button key={`a-${a}`} size="sm" dot={false} onClick={() => onAnswer(it, a)}>
              {a}
            </Button>
          ))}
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

/** Что сейчас со строкой «разложил»: показана, откатили (спрашиваем почему), откат не прошёл. */
type Undo = { revert: string | null; conflict: boolean };

/**
 * «Элик разложил» (CMD-004): мысли, которые агент разложил сам за сутки, — «разложил → Русский ·
 * дело на чт» и «Откатить». После отката Элик ошибается по-своему и спрашивает почему (D-397).
 */
function FiledList({
  filed,
  onBack,
  onCheer,
}: {
  filed: Filed[];
  /** мысль вернулась — подтянуть её во «Входящие» сразу */
  onBack: () => void;
  /** разложил новое, пока экран открыт — Элик в шапке радуется */
  onCheer: () => void;
}) {
  const undo = useUndoFiled();
  const why = useRevertWhy();
  /* откаченные остаются на месте, пока не ответили «почему» (сервер их уже не отдаёт) */
  const [undone, setUndone] = useState<Record<string, { f: Filed; u: Undo }>>({});
  const [gone, setGoneIds] = useState<string[]>([]);
  /* что было разложено ещё до открытия экрана; остальное — только что: Элик радуется */
  const [before] = useState(() => new Set(filed.map((f) => f.batch_id)));
  const cheered = useRef(new Set<string>());
  useEffect(() => {
    const born = filed.filter((f) => !before.has(f.batch_id) && !cheered.current.has(f.batch_id));
    born.forEach((f) => cheered.current.add(f.batch_id));
    if (born.length > 0) onCheer();
  }, [filed, before, onCheer]);

  const kept = Object.values(undone)
    .filter(({ f }) => !filed.some((x) => x.batch_id === f.batch_id))
    .map(({ f }) => f);
  const list = [...filed, ...kept]
    .filter((f) => !gone.includes(f.batch_id))
    .sort((a, b) => b.at.localeCompare(a.at));
  const box = useRef<HTMLDivElement>(null);
  const [rows, leave] = useLeaving(list, (f) => f.batch_id);
  useFlip(box, rows.map((r) => r.item.batch_id + (r.leaving ? '~' : '')).join());
  if (rows.length === 0) return null;

  function revert(f: Filed) {
    undo.mutate(f.batch_id, {
      onSuccess: (result) => {
        const reverted = result.status === 'reverted';
        const revertBatch = reverted ? (result.actions[0]?.batch_id ?? null) : null;
        setUndone((x) => ({
          ...x,
          [f.batch_id]: { f, u: { revert: revertBatch, conflict: !reverted } },
        }));
        if (reverted) onBack();
      },
    });
  }

  function close(f: Filed, answer: string | null) {
    const u = undone[f.batch_id]?.u;
    if (answer && u?.revert) why.mutate({ batch: u.revert, answer });
    setGoneIds((x) => [...x, f.batch_id]);
  }

  return (
    <section className="filed" aria-label="Элик разложил">
      <SecHead text="РАЗЛОЖИЛ" label="Элик разложил">
        <span className="n">{filed.length}</span>
      </SecHead>
      <div className="items" ref={box}>
        {rows.map(({ item: f, leaving }) => (
          <FiledRow
            key={f.batch_id}
            f={f}
            undo={undone[f.batch_id]?.u ?? null}
            fresh={!before.has(f.batch_id)}
            busy={undo.isPending && undo.variables === f.batch_id}
            leaving={leaving}
            onGone={leave}
            onRevert={() => revert(f)}
            onWhy={(answer) => close(f, answer)}
          />
        ))}
      </div>
    </section>
  );
}

const WHY: [string, string][] = [
  ['Ошибся', 'ошибся'],
  ['Не надо такого', 'не надо такого'],
];

function FiledRow({
  f,
  undo,
  fresh,
  busy,
  leaving,
  onGone,
  onRevert,
  onWhy,
}: {
  f: Filed;
  undo: Undo | null;
  /** разложил только что — Элик радуется */
  fresh: boolean;
  busy: boolean;
  leaving: boolean;
  onGone: (id: string) => void;
  onRevert: () => void;
  /** ответ «почему откатил» (`null` — пропустить) */
  onWhy: (answer: string | null) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [glad, setGlad] = useState(fresh);
  useEffect(() => {
    if (!glad) return;
    const t = setTimeout(() => setGlad(false), 1600);
    return () => clearTimeout(t);
  }, [glad]);
  const goneRef = useRef(onGone);
  const leavingRef = useRef(leaving);
  useEffect(() => {
    goneRef.current = onGone;
    leavingRef.current = leaving;
  });
  const sp = useSpring(fresh ? 0 : 1, 0.7, (v) => {
    const d = el.current;
    if (!d) return;
    d.style.opacity = Math.min(1, Math.max(0, v)).toFixed(3);
    d.style.transform =
      v === 1 ? '' : `scaleY(${Math.min(1.2, Math.max(0, 0.4 + v * 0.6)).toFixed(3)})`;
    if (leavingRef.current && v < 0.03) goneRef.current(f.batch_id);
  });
  useEffect(() => {
    sp.emit();
    loop().to(sp, leaving ? 0 : 1);
  }, [sp, leaving]);

  const mood: ElikMood = undo ? 'oops' : glad ? 'happy' : 'idle';
  const hint = undo
    ? undo.conflict
      ? 'после меня это уже меняли — реши в «Агент» → «Лента»'
      : 'ой, вернул мысль во Входящие. Почему откатил?'
    : (f.reason ?? 'разложил сам — если не так, откати');
  return (
    <div className="item filed-row" ref={el} data-flip={f.batch_id} data-filed={f.item_id}>
      <span className="q-dot" />
      <div className="t">
        <div className="txt">{f.thought}</div>
        <div className="src">разложил → {f.label}</div>
        <div className="elik">
          <ElikDots mood={mood} />
          <span>Элик: {hint}</span>
          {!undo && (
            <Button size="sm" dot={false} disabled={busy} onClick={onRevert}>
              Откатить
            </Button>
          )}
          {undo &&
            !undo.conflict &&
            WHY.map(([label, answer]) => (
              <Button key={answer} size="sm" dot={false} onClick={() => onWhy(answer)}>
                {label}
              </Button>
            ))}
          {undo && (
            <Button size="sm" dot={false} onClick={() => onWhy(null)}>
              {undo.conflict ? 'Понятно' : 'Пропустить'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
