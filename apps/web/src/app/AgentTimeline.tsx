/**
 * Лента «Что сделал агент» (AGT-002, AGENT §5): кто · что · почему · было → стало, и кнопки
 * «Откатить», «Откатить пакет», «Исправить». Откат, который наткнулся на более позднюю правку,
 * ничего не меняет и показывает три значения — решаешь ты (как черновик Console, D-233).
 * После отката действия агента — необязательный вопрос «почему» (AGT-007, D-397).
 * Одна и та же лента — целиком (раздел «Агент») и короткая у проекта и дела.
 */
import { Button, Field } from '@qubite/ui';
import { useState, type FormEvent } from 'react';
import { Fail, say } from '../auth/client';
import {
  useFix,
  useRevert,
  useRevertWhy,
  useTimeline,
  type RevertTarget,
  type Trail,
} from './agent';
import {
  actorLabel,
  asksWhy,
  canRevert,
  conflictLines,
  costLabel,
  diffLines,
  fixTarget,
  whenLabel,
  whyLine,
  WHY_BUTTONS,
  type AgentAction,
  type AgentConflict,
  type ProjectName,
} from './agent-view';
import { usePlanner } from './planner-context';

export function AgentTimeline({ trail, compact = false }: { trail: Trail; compact?: boolean }) {
  const planner = usePlanner();
  const timeline = useTimeline(trail);
  const names: ProjectName = (id) => planner.projects.find((p) => p.id === id)?.name;

  if (timeline.isPending) return <p className="later">Загружаю ленту…</p>;
  if (timeline.isError) {
    const denied = timeline.error instanceof Fail && timeline.error.status === 403;
    if (denied && compact) return null;
    return (
      <p className="later" role="status">
        {denied
          ? 'Агент выключен: нет доступа к модулю «Агент Qubite». Его включает owner в Console.'
          : say(timeline.error)}
      </p>
    );
  }
  const items = timeline.data.pages.flatMap((p) => p.items);
  if (items.length === 0) {
    return (
      <p className="later">
        {compact ? 'Агент здесь ещё ничего не делал.' : 'Агент пока ничего не сделал.'}
      </p>
    );
  }
  return (
    <div className={compact ? 'acts compact' : 'acts'}>
      <ol aria-label={compact ? 'Что делал агент' : 'Что сделал агент'}>
        {items.map((a) => (
          <ActionRow key={a.id} a={a} names={names} compact={compact} />
        ))}
      </ol>
      {timeline.hasNextPage && (
        <button
          type="button"
          className="later"
          disabled={timeline.isFetchingNextPage}
          onClick={() => void timeline.fetchNextPage()}
        >
          {timeline.isFetchingNextPage ? 'Загружаю…' : 'Ещё'}
        </button>
      )}
    </div>
  );
}

function ActionRow({
  a,
  names,
  compact,
}: {
  a: AgentAction;
  names: ProjectName;
  compact: boolean;
}) {
  const revert = useRevert();
  const [conflict, setConflict] = useState<{
    target: RevertTarget;
    conflicts: AgentConflict[];
  } | null>(null);
  const [fixing, setFixing] = useState(false);
  // Только что откатил действие агента — пакет отката, про который спросить «почему».
  const [asked, setAsked] = useState<string | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reverted = !!a.state.reverted_by;
  const fix = fixTarget(a);
  const cost = costLabel(a.cost_usd_micros);

  function run(target: RevertTarget, force: boolean) {
    setError(null);
    revert.mutate(
      { target, force },
      {
        onSuccess: (r) => {
          setConflict(r.status === 'conflict' ? { target, conflicts: r.conflicts } : null);
          const undo = r.actions.find((x) => x.state.why && x.state.why.kind == null);
          if (undo && !compact) setAsked(undo.batch_id);
        },
        onError: (e) => setError(say(e)),
      },
    );
  }

  return (
    <li className={reverted ? 'act reverted' : 'act'} data-actor={a.actor}>
      <div className="act-head">
        <span className="q-dot" aria-hidden="true" />
        <time dateTime={a.at}>{whenLabel(a.at)}</time>
        <b>{actorLabel(a.actor)}</b>
        {a.state.batch_size > 1 && <span className="tag">пакет · {a.state.batch_size}</span>}
        {reverted && <span className="tag">откачено</span>}
        {a.state.corrected_by.length > 0 && <span className="tag">исправлено</span>}
        {a.corrects && <span className="tag">поправка</span>}
        {cost && <span className="tag">{cost}</span>}
      </div>
      <p className="act-what">{a.summary}</p>
      {a.reason && <p className="act-why">почему: {a.reason}</p>}
      {whyLine(a.state.why) && <p className="act-why">{whyLine(a.state.why)}</p>}
      {!compact &&
        a.changes.map((c) => {
          const lines = diffLines(c, names);
          if (lines.length === 0) return null;
          return (
            <ul className="act-diff" key={c.object_id} aria-label={`Изменения: ${c.title}`}>
              {lines.map((l, i) =>
                l.line ? (
                  <li key={i} className={l.line}>
                    <span aria-label={l.line === 'added' ? 'добавлено' : 'убрано'}>{l.label}</span>{' '}
                    {l.line === 'added' ? <b>{l.after}</b> : <s>{l.before}</s>}
                  </li>
                ) : (
                  <li key={i}>
                    <span>{l.label}:</span> <s>{l.before}</s> → <b>{l.after}</b>
                  </li>
                ),
              )}
            </ul>
          );
        })}
      {!reverted && !conflict && !fixing && (
        <div className="act-btns">
          {canRevert(a) && (
            <Button
              size="sm"
              dot={false}
              disabled={revert.isPending}
              onClick={() => run({ action: a.id }, false)}
            >
              Откатить
            </Button>
          )}
          {a.state.batch_size > 1 && (
            <Button
              size="sm"
              dot={false}
              disabled={revert.isPending}
              onClick={() => run({ batch: a.batch_id }, false)}
            >
              Откатить пакет
            </Button>
          )}
          {fix && (
            <Button size="sm" dot={false} onClick={() => setFixing(true)}>
              Исправить
            </Button>
          )}
        </div>
      )}
      {reverted && !compact && (
        <p className="act-why">Откачено — отмену можно откатить в строке «Ты · Откатил: …» выше.</p>
      )}
      {asked && <WhyAsk batch={asked} onDone={() => setAsked(null)} />}
      {!compact && asksWhy(a) && !whyOpen && (
        <div className="act-btns">
          <Button size="sm" dot={false} onClick={() => setWhyOpen(true)}>
            Почему откатил?
          </Button>
        </div>
      )}
      {whyOpen && asksWhy(a) && <WhyAsk batch={a.batch_id} onDone={() => setWhyOpen(false)} />}
      {conflict && (
        <Conflict
          conflicts={conflict.conflicts}
          names={names}
          busy={revert.isPending}
          onForce={() => run(conflict.target, true)}
          onKeep={() => setConflict(null)}
        />
      )}
      {fixing && fix && (
        <FixForm
          a={a}
          object={fix.object_id}
          kind={fix.object_type}
          onDone={() => setFixing(false)}
        />
      )}
      {error && (
        <p className="act-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * «Почему откатил?» — по желанию: кнопкой или своими словами (можно ответить и агенту в Telegram).
 * «Ошибся» и «не надо такого» — урок для навыков и «О тебе»; «не сейчас» и молчание — нет.
 */
function WhyAsk({ batch, onDone }: { batch: string; onDone: () => void }) {
  const why = useRevertWhy();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = (answer: string) => {
    setError(null);
    why.mutate({ batch, answer }, { onSuccess: onDone, onError: (e) => setError(say(e)) });
  };
  return (
    <form
      className="act-ask panel"
      aria-label="Почему откатил?"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) send(text.trim());
      }}
    >
      <p>
        <b>Почему откатил?</b> Можно не отвечать. «Ошибся» и «не надо такого» — агент учтёт, «не
        сейчас» — нет.
      </p>
      <div className="act-btns">
        {WHY_BUTTONS.map((w) => (
          <Button
            key={w}
            size="sm"
            dot={false}
            type="button"
            disabled={why.isPending}
            onClick={() => send(w)}
          >
            {w[0]!.toUpperCase() + w.slice(1)}
          </Button>
        ))}
      </div>
      <Field
        label="Своими словами"
        placeholder="Например: «ДЗ по физре я не делаю»"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {error && (
        <p className="act-error" role="alert">
          {error}
        </p>
      )}
      <div className="act-btns">
        <Button size="sm" variant="fill" type="submit" disabled={why.isPending || !text.trim()}>
          Ответить
        </Button>
        <Button size="sm" dot={false} type="button" onClick={onDone}>
          Пропустить
        </Button>
      </div>
    </form>
  );
}

function Conflict({
  conflicts,
  names,
  busy,
  onForce,
  onKeep,
}: {
  conflicts: AgentConflict[];
  names: ProjectName;
  busy: boolean;
  onForce: () => void;
  onKeep: () => void;
}) {
  const lines = conflictLines(conflicts, names);
  return (
    <div className="act-conflict panel" role="group" aria-label="После агента это уже меняли">
      <p>
        <b>После агента это уже меняли.</b> Откат ничего не тронул — реши сам:
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Поле</th>
            <th scope="col">Было</th>
            <th scope="col">Сделал агент</th>
            <th scope="col">Сейчас</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <th scope="row">
                {l.label}
                <small>{l.title}</small>
              </th>
              <td>{l.before}</td>
              <td>{l.action}</td>
              <td>{l.now}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="act-btns">
        <Button size="sm" variant="fill" disabled={busy} onClick={onForce}>
          Вернуть как было
        </Button>
        <Button size="sm" dot={false} disabled={busy} onClick={onKeep}>
          Оставить как сейчас
        </Button>
      </div>
    </div>
  );
}

/** «Исправить»: поменять результат руками. Это твоя поправка — агент на ней учится. */
function FixForm({
  a,
  object,
  kind,
  onDone,
}: {
  a: AgentAction;
  object: string;
  kind: string;
  onDone: () => void;
}) {
  const fix = useFix();
  const change = a.changes.find((c) => c.object_id === object);
  const after = (field: string) =>
    change?.diff.find((d) => d.field === field)?.after as unknown as string | null | undefined;
  const isTask = kind === 'planner.task';
  const [title, setTitle] = useState(change?.title ?? '');
  const [date, setDate] = useState(after('due_date') ?? '');
  const [time, setTime] = useState(after('due_time') ?? '');
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const fields: Record<string, unknown> = {};
    if (isTask) {
      if (date !== (after('due_date') ?? '')) fields.due_date = date || null;
      if (time !== (after('due_time') ?? '') || (!date && time))
        fields.due_time = date ? time || null : null;
    }
    const newTitle = title.trim() && title.trim() !== change?.title ? title.trim() : undefined;
    if (!newTitle && Object.keys(fields).length === 0) {
      onDone();
      return;
    }
    setError(null);
    fix.mutate(
      { action: a.id, object, title: newTitle, fields },
      { onSuccess: onDone, onError: (er) => setError(say(er)) },
    );
  }

  return (
    <form className="act-fix panel" onSubmit={submit} aria-label="Исправить">
      <Field label="Название" value={title} onChange={(e) => setTitle(e.target.value)} />
      {isTask && (
        <div className="act-fix-when">
          <Field label="Срок" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Field label="Время" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      )}
      {error && (
        <p className="act-error" role="alert">
          {error}
        </p>
      )}
      <div className="act-btns">
        <Button size="sm" variant="fill" type="submit" disabled={fix.isPending}>
          Сохранить
        </Button>
        <Button size="sm" dot={false} type="button" onClick={onDone}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
