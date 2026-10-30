import { Button, Note, Presence, useLeaving } from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Fail, say } from '../auth/client';
import {
  dismiss,
  forget,
  useDismiss,
  useInterested,
  useOpportunities,
  useOpportunitiesKey,
  useRefreshOpportunities,
  type OpportunityCard,
} from './opportunities';
import {
  MAX_CARDS,
  kindLine,
  opportunityWhen,
  siteUrl,
  tasksLine,
  whoLine,
} from './opportunities-view';
import { SecHead } from './parts';

/** Сколько ждём «Вернуть», прежде чем сказать серверу «Не надо». */
export const UNDO_MS = 5000;

const SOURCE_NAME: Record<string, string> = {
  codolymp: 'Кодолимп',
  codeforces: 'Codeforces',
  devpost: 'Devpost',
};

/**
 * «Возможности» на Главной (AGT-005, D-734): до трёх олимпиад, хакатонов и соревнований,
 * которые предложил агент. «Интересно» — агент ставит дела одним пакетом ленты (откат — в
 * «Агенте»), «Не надо» — карточка уходит, пару секунд её можно вернуть.
 *
 * `onLayout` — высота блока поменялась: Главная двигает то, что ниже, пружиной (useFlip).
 */
export function Opportunities({
  onLayout,
  undoMs = UNDO_MS,
}: {
  onLayout: () => void;
  undoMs?: number;
}) {
  const query = useOpportunities();
  const refresh = useRefreshOpportunities();
  const picked = query.data?.picked ?? false;
  const cards = (query.data?.items ?? []).slice(0, MAX_CARDS);
  const [rows, gone] = useLeaving(cards, (c) => c.id);
  const guest = query.error instanceof Fail && query.error.status === 401;
  // убрали последнюю карточку — список перезапрашивается: «Ищу…», а не мелькание «ничего нет»
  const empty = query.isFetching && refresh.isIdle ? 'wait' : 'empty';
  const state = query.data ? (rows.length ? 'list' : empty) : query.isError ? 'error' : 'wait';
  const shape = `${state}|${rows.map((r) => r.item.id + (r.leaving ? '~' : '')).join()}`;
  useLayoutEffect(() => {
    onLayout();
  }, [shape, onLayout]);

  if (guest) return null;
  return (
    <section className="opps" aria-label="Возможности">
      <SecHead text="ВОЗМОЖНОСТИ" label="Возможности">
        {state === 'list' && (
          <span className="opps-mark">{picked ? 'отобрал агент' : 'без отбора агента'}</span>
        )}
      </SecHead>
      {state === 'wait' && <p className="opps-text">Ищу олимпиады и хакатоны…</p>}
      {state === 'error' && (
        <div className="opps-empty">
          <p className="opps-text">Возможности сейчас недоступны — сервер не ответил.</p>
          <Button
            size="sm"
            dot={false}
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? 'Проверяю…' : 'Повторить'}
          </Button>
        </div>
      )}
      {state === 'empty' && (
        <>
          <div className="opps-empty">
            <p className="opps-text">
              Агент пока ничего не нашёл. Олимпиады, хакатоны и соревнования он проверяет раз в
              день.
            </p>
            <Button size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
              {refresh.isPending ? 'Обновляю…' : 'Обновить'}
            </Button>
          </div>
          <Presence
            className="opps-note"
            show={refresh.isError || (refresh.isSuccess && !query.isFetching)}
            swap={refresh.status}
            onLayout={onLayout}
          >
            {refresh.isError && <Note tone="bad">{say(refresh.error)}</Note>}
            {refresh.data && (
              <Note>
                {refresh.data.inserted > 0
                  ? 'Нашлось новое — агент отберёт подходящее.'
                  : 'Новых мероприятий в источниках пока нет.'}
                {refresh.data.failed_sources.length > 0 &&
                  ` Не ответили: ${refresh.data.failed_sources.map((s) => SOURCE_NAME[s] ?? s).join(', ')}.`}
              </Note>
            )}
          </Presence>
        </>
      )}
      {rows.length > 0 && (
        <div className="opps-list">
          {rows.map(({ item, leaving }) => (
            <div key={item.id} data-flip={`opp-${item.id}`}>
              <OpportunityRow
                item={item}
                leaving={leaving}
                onGone={gone}
                onLayout={onLayout}
                undoMs={undoMs}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type Away = 'no' | 'undo' | 'sending' | 'failed';

function OpportunityRow({
  item,
  leaving,
  onGone,
  onLayout,
  undoMs,
}: {
  item: OpportunityCard;
  leaving: boolean;
  onGone: (id: string) => void;
  onLayout: () => void;
  undoMs: number;
}) {
  const qc = useQueryClient();
  const key = useOpportunitiesKey();
  const interested = useInterested();
  const { mutate: send } = useDismiss();
  const [away, setAway] = useState<Away>('no');
  const [awayError, setAwayError] = useState<string | null>(null);
  const done = item.status === 'interested';
  const view = away !== 'no' ? 'away' : done ? 'done' : 'card';
  const error = interested.isError ? say(interested.error) : null;

  // «Не надо»: ждём «Вернуть», потом говорим серверу
  useEffect(() => {
    if (away !== 'undo') return;
    const t = setTimeout(() => {
      setAway('sending');
      send(item.id, {
        onError: (e) => {
          setAwayError(say(e));
          setAway('failed');
        },
      });
    }, undoMs);
    return () => clearTimeout(t);
  }, [away, item.id, send, undoMs]);

  // ушёл с Главной, пока ждали «Вернуть», — «Не надо» всё равно доходит до сервера
  const waiting = useRef(false);
  useEffect(() => {
    waiting.current = away === 'undo';
  }, [away]);
  useEffect(
    () => () => {
      if (waiting.current) {
        void dismiss(item.id).then(
          () => forget(qc, key, item.id),
          () => undefined,
        );
      }
    },
    [qc, item.id],
  );

  useLayoutEffect(() => {
    onLayout();
  }, [view, onLayout]);

  return (
    <Presence
      show={!leaving}
      swap={view}
      onLayout={() => {
        if (leaving) onGone(item.id);
      }}
    >
      {view === 'away' ? (
        <div className="opp opp-away panel" role="group" aria-label={`Убрано: ${item.title}`}>
          <p className="opp-away-t">
            {away === 'sending'
              ? 'Убираю…'
              : away === 'failed'
                ? 'Пока не убрал.'
                : 'Убрал — больше не предложу.'}
            <small>{item.title}</small>
          </p>
          <div className="opp-btns">
            {away === 'failed' && (
              <Button
                size="sm"
                dot={false}
                onClick={() => {
                  setAway('sending');
                  send(item.id, {
                    onError: (e) => {
                      setAwayError(say(e));
                      setAway('failed');
                    },
                  });
                }}
              >
                Повторить
              </Button>
            )}
            <Button
              size="sm"
              dot={false}
              disabled={away === 'sending'}
              onClick={() => {
                setAwayError(null);
                setAway('no');
              }}
            >
              Вернуть
            </Button>
          </div>
          <Presence
            className="opp-away-note"
            show={away === 'failed'}
            swap={awayError}
            onLayout={onLayout}
          >
            <Note tone="bad">Не получилось убрать: {awayError}</Note>
          </Presence>
        </div>
      ) : (
        <Card
          item={item}
          done={done}
          busy={interested.isPending}
          error={error}
          onYes={() => interested.mutate(item.id)}
          onNo={() => {
            interested.reset();
            setAway('undo');
          }}
          onLayout={onLayout}
        />
      )}
    </Presence>
  );
}

function Card({
  item,
  done,
  busy,
  error,
  onYes,
  onNo,
  onLayout,
}: {
  item: OpportunityCard;
  done: boolean;
  busy: boolean;
  error: string | null;
  onYes: () => void;
  onNo: () => void;
  onLayout: () => void;
}) {
  const id = useId();
  const when = opportunityWhen(item, new Date());
  const who = whoLine(item);
  const site = siteUrl(item.url);
  const why = item.why.trim();
  return (
    <article className="opp panel" aria-labelledby={id} aria-busy={busy}>
      <small className="opp-kind">{kindLine(item)}</small>
      <h3 className="opp-title" id={id}>
        {item.title}
      </h3>
      <ul className="opp-facts">
        {when.registration && <li className="opp-reg">{when.registration}</li>}
        {when.dates && <li>{when.dates}</li>}
        {who && <li>{who}</li>}
        {item.place.trim() && <li>{item.place}</li>}
      </ul>
      {why && (
        <p className="opp-why">
          <span className="q-dot" aria-hidden="true" />
          <span>
            <small>почему тебе:</small> {why}
          </span>
        </p>
      )}
      <div className="opp-foot">
        {site && (
          <a
            className="home-link opp-site"
            href={site}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Сайт организатора: ${item.title}`}
          >
            Сайт организатора ↗
          </a>
        )}
        <Presence show swap={done} className="opp-act">
          {done ? (
            <div className="opp-done">
              <Note tone="ok">{tasksLine(item.tasks ?? 0)}</Note>
              <Link className="home-link" to="/agent">
                Что сделал агент →
              </Link>
            </div>
          ) : (
            <div className="opp-btns">
              <Button size="sm" variant="fill" disabled={busy} onClick={onYes}>
                {busy ? 'Ставлю дела…' : 'Интересно'}
              </Button>
              <Button size="sm" dot={false} disabled={busy} onClick={onNo}>
                Не надо
              </Button>
            </div>
          )}
        </Presence>
      </div>
      <Presence show={!!error && !done} swap={error} onLayout={onLayout}>
        <Note tone="bad">Не получилось поставить дела: {error}</Note>
      </Presence>
    </article>
  );
}
