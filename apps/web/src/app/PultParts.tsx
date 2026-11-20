/**
 * Части Пульта (HAR-002, AOS-5) по макетам Figma «Пульт · …»: шкала из точек, Светофор,
 * «ждёт тебя», строки агентов, карточка с историей, подключение ПК. Цвета — токены, движение —
 * компоненты @qubite/ui (D-874, DESIGN_SYSTEM §0).
 */
import {
  Button,
  DotIcon,
  EmptyState,
  Field,
  Note,
  Presence,
  Sheet,
  useSlide,
  useToast,
} from '@qubite/ui';
import { uuidv7 } from '@qubite/sync-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import { must, say } from '../auth/client';
import { answerFromPult } from './command-dispatch';
import { SecHead } from './parts';
import {
  PULT,
  PULT_AGENT,
  PULT_COLLECTORS,
  STATUS_COLOR,
  STATUS_LABEL,
  agentMeta,
  ago,
  cacheLabel,
  ciLabel,
  limitTone,
  litDots,
  pct,
  resetLine,
  tokens,
  usd,
  useAgentCard,
  useCollectors,
  weekdayShort,
  type PultAgent,
  type PultBoard,
  type PultSpend,
  type PultWaiting,
  type PultWindow,
} from './pult';

/** Точка статуса или цвета. */
export function Dot({ color }: { color: string }) {
  return <span className={`pult-dot pult-bg-${color}`} aria-hidden="true" />;
}

/** Шкала из точек: `lit` из `total` горят цветом `tone`. */
export function Meter({
  value,
  total,
  tone,
  label,
  small,
}: {
  value: number;
  total: number;
  tone: string;
  label: string;
  small?: boolean;
}) {
  const lit = litDots(value, total);
  return (
    <span
      className={small ? 'pult-meter small' : 'pult-meter'}
      style={{ ['--n' as string]: total }}
      role="img"
      aria-label={label}
    >
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < lit ? `pult-bg-${tone}` : undefined} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- Светофор

function Window({
  name,
  w,
  wide,
  now,
}: {
  name: string;
  w: PultWindow | null | undefined;
  wide: boolean;
  now: Date;
}) {
  if (!w)
    return (
      <div className="pult-win">
        <div className="pult-win-h">
          <span>{name}</span>
          <span className="pult-mute">нет данных</span>
        </div>
      </div>
    );
  const tone = limitTone(w.left);
  return (
    <div className="pult-win">
      <div className="pult-win-h">
        <span className="pult-win-name">
          {name}
          {w.low && (
            <span className="pult-tag pult-tag-red">
              <Dot color="red" />
              LOW
            </span>
          )}
        </span>
        <span>
          <b className={`pult-ink-${tone}`}>{pct(w.left)}</b> осталось
        </span>
      </div>
      <Meter
        value={w.left}
        total={wide ? 24 : 14}
        tone={tone}
        label={`${name}: осталось ${pct(w.left)}`}
      />
      <p className="pult-small">{resetLine(w, now)}</p>
    </div>
  );
}

/** Лимиты подписки 5ч/7д — сверху Светофора (D-962). */
export function Limits({
  board,
  wide,
  onConnect,
}: {
  board: PultBoard;
  wide: boolean;
  onConnect: () => void;
}) {
  const now = new Date(board.now);
  const l = board.limits;
  const pc = board.sources.find((s) => s.id === 'pc');
  const none = !l.five_hour && !l.seven_day;
  return (
    <section className="panel pult-box pult-limits" aria-label="Лимиты подписки">
      <div className="pult-cap">
        <span>Лимиты подписки</span>
        {l.at && (
          <span>
            обновлено{' '}
            {new Date(l.at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
      {none ? (
        <div className="pult-none">
          <p className="pult-small">
            Лимитов пока нет: {pc?.note ?? 'сборщик на ПК их не прислал'}. Их сообщает строка
            состояния Claude Code на ПК.
          </p>
          {!pc?.ok && (
            <div>
              <Button size="sm" onClick={onConnect}>
                Подключить ПК
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <Window name="5 часов" w={l.five_hour} wide={wide} now={now} />
          <hr className="pult-hr" />
          <Window name="7 дней" w={l.seven_day} wide={wide} now={now} />
        </>
      )}
    </section>
  );
}

/** Три цифры: работает · ждёт тебя · готово (D-953). */
export function Counters({ board }: { board: PultBoard }) {
  const c = board.counts;
  const items: [string, number, string][] = [
    ['работает', c.running, 'sky'],
    ['ждёт тебя', c.waiting, 'orange'],
    ['готово', c.done, 'green'],
  ];
  return (
    <div className="pult-counts" role="group" aria-label="Агенты сейчас">
      {items.map(([label, n, color]) => (
        <div key={label} className="panel pult-count">
          <span className="pult-small">
            <Dot color={color} />
            {label}
          </span>
          <b className={color === 'orange' && n > 0 ? 'pult-num pult-ink-orange' : 'pult-num'}>
            {n}
          </b>
        </div>
      ))}
    </div>
  );
}

/** Семь дней подряд до последнего дня сводки: дня без работы нет в сводке — он нулевой. */
function week(days: PultSpend['days']): PultSpend['days'] {
  const last = days.at(-1)?.date;
  if (!last) return [];
  const [y, m, d] = last.split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) - 6 + i);
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    return days.find((x) => x.date === date) ?? { date, tokens: 0, usd: null };
  });
}

/** Расход за 7 дней: % недели главным, токены и ≈ $ мелко (D-963, D-982). */
export function Spend({ board }: { board: PultBoard }) {
  const s = board.spend;
  if (!s)
    return (
      <section className="panel pult-box pult-spend" aria-label="Расход за 7 дней">
        <div className="pult-cap">
          <span>Расход за 7 дней</span>
        </div>
        <p className="pult-small">
          Нет данных: расход считает сборщик на ПК по журналам Claude Code. Облачные сессии свои
          токены серверу не сообщают.
        </p>
      </section>
    );
  const days = week(s.days);
  const max = Math.max(1, ...days.map((d) => d.tokens));
  const today = days.at(-1)?.date;
  const H = 12;
  return (
    <section className="panel pult-box pult-spend" aria-label="Расход за 7 дней">
      <div className="pult-cap">
        <span>Расход за 7 дней</span>
        <span>по ценам API</span>
      </div>
      <div className="pult-spend-top">
        {s.week_used != null ? (
          <>
            <b className="pult-num">{pct(s.week_used)}</b>
            <span>недельного лимита</span>
          </>
        ) : (
          <>
            <b className="pult-num">{tokens(s.tokens)}</b>
            <span>токенов</span>
          </>
        )}
        <span className="pult-small">
          {s.week_used != null && `${tokens(s.tokens)} токенов · `}≈ {usd(s.usd)}
        </span>
      </div>
      <div className="pult-bars" role="img" aria-label="Токены по дням">
        {days.map((d) => {
          const lit = d.tokens > 0 ? Math.max(1, Math.round((d.tokens / max) * H)) : 0;
          const tone = d.date === today ? 'orange' : 'sky';
          return (
            <div key={d.date} className="pult-bar" title={`${tokens(d.tokens)} · ≈ ${usd(d.usd)}`}>
              <span className="pult-bar-dots">
                {Array.from({ length: H }, (_, i) => (
                  <i key={i} className={H - i <= lit ? `pult-bg-${tone}` : undefined} />
                ))}
              </span>
              <span className={d.date === today ? 'pult-ink-orange' : undefined}>
                {weekdayShort(d.date)}
              </span>
            </div>
          );
        })}
      </div>
      {(s.top || s.cache_saved != null) && (
        <p className="pult-small">
          {s.top && `Больше всего — ${s.top.title} (${tokens(s.top.tokens)}). `}
          {s.cache_saved != null && `Кэш сэкономил ≈ ${usd(s.cache_saved)}.`}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- ждёт тебя

/** Ответ уходит комментарием в issue — агент читает его сам (как в Owner Console). */
function useAnswer(w: PultWaiting) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  /** `true` — ответ дошёл; при ошибке окно не закрывается, ошибка видна в нём. */
  const pending = useRef(false);
  const request = useRef<{ answer: string; id: string } | null>(null);
  const send = async (answer: string): Promise<boolean> => {
    const text = answer.trim();
    if (pending.current || !text) return false;
    pending.current = true;
    setBusy(true);
    setError(null);
    if (request.current?.answer !== text) request.current = { answer: text, id: uuidv7() };
    try {
      await answerFromPult(w.number, text, request.current.id);
      setSent(true);
      toast.show('Ответ ушёл агенту');
      window.setTimeout(() => {
        void qc.invalidateQueries({ queryKey: PULT });
        void qc.invalidateQueries({ queryKey: PULT_AGENT });
      }, 900);
      return true;
    } catch (err) {
      setError(say(err));
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return { send, busy, error, sent };
}

/** Карточка «ждёт тебя»: решение кнопкой прямо в строке (D-941). */
export function WaitCard({
  w,
  now,
  main,
  onOpen,
}: {
  w: PultWaiting;
  now: Date;
  /** у первой карточки на экране — главная кнопка */
  main: boolean;
  onOpen: () => void;
}) {
  const a = useAnswer(w);
  const [first, second, ...rest] = w.options;
  return (
    <Presence show={!a.sent}>
      <article className="panel pult-box pult-wait" aria-label={w.title}>
        <h3 className="pult-title">
          <Dot color="orange" />
          <span>{w.title}</span>
        </h3>
        <p className="pult-small">
          #{w.number} · {ago(w.updated_at, now)}
        </p>
        {w.text && <p className="pult-text">{w.text}</p>}
        <div className="pult-acts">
          {first && (
            <Button
              size="sm"
              variant={main ? 'fill' : 'outline'}
              disabled={a.busy}
              onClick={() => void a.send(first)}
            >
              {first}
            </Button>
          )}
          {second && (
            <Button size="sm" disabled={a.busy} onClick={() => void a.send(second)}>
              {second}
            </Button>
          )}
          {rest.map((o) => (
            <Button
              key={o}
              size="sm"
              variant="quiet"
              disabled={a.busy}
              onClick={() => void a.send(o)}
            >
              {o}
            </Button>
          ))}
          <Button size="sm" variant={first ? 'quiet' : 'outline'} onClick={onOpen}>
            Открыть
          </Button>
        </div>
        {a.error && <Note tone="bad">{a.error}</Note>}
      </article>
    </Presence>
  );
}

/** Окно ответа из карточки агента: варианты или свой текст. */
export function AnswerSheet({
  w,
  open,
  onClose,
}: {
  w: PultWaiting;
  open: boolean;
  onClose: () => void;
}) {
  const a = useAnswer(w);
  const [own, setOwn] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void a.send(own).then((ok) => ok && onClose());
  };
  return (
    <Sheet open={open} onClose={onClose} title="Ответить агенту">
      <form className="pult-form" onSubmit={submit} noValidate>
        <p className="pult-text">{w.text || w.title}</p>
        {w.options.length > 0 && (
          <div className="pult-acts" role="group" aria-label="Варианты ответа">
            {w.options.map((o, i) => (
              <Button
                key={o}
                size="sm"
                variant={i === 0 ? 'fill' : 'outline'}
                disabled={a.busy}
                onClick={() => void a.send(o).then((ok) => ok && onClose())}
              >
                {o}
              </Button>
            ))}
          </div>
        )}
        <Field
          label={w.options.length > 0 ? 'Или свой ответ' : 'Ответ'}
          value={own}
          onChange={(e) => setOwn(e.target.value)}
          maxLength={2000}
          error={a.error}
        />
        <div>
          <Button type="submit" size="sm" disabled={a.busy || !own.trim()}>
            {a.busy ? 'Отправляем…' : 'Ответить своим'}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------- агенты

/** Строка агента: название, модель, контекст шкалой; справа цена и кэш (Q.P.agent). */
function AgentLine({ a, withStatus }: { a: PultAgent; withStatus: boolean }) {
  const cache = cacheLabel(a.cache, false);
  return (
    <>
      <Dot color={STATUS_COLOR[a.status]} />
      <span className="pult-row-main">
        <span className="pult-row-title">{a.title}</span>
        <span className="pult-small">{agentMeta(a, withStatus)}</span>
        {a.context != null && (
          <span className="pult-ctx">
            <Meter
              small
              value={a.context}
              total={10}
              tone="sky"
              label={`контекст ${pct(a.context)}`}
            />
            <span className="pult-small">контекст {pct(a.context)}</span>
          </span>
        )}
      </span>
      <span className="pult-row-side">
        <b>{a.usd != null ? usd(a.usd) : ''}</b>
        {cache && (
          <span className={a.cache?.warm ? 'pult-micro pult-ink-green' : 'pult-micro pult-ink-sky'}>
            {cache}
          </span>
        )}
      </span>
    </>
  );
}

/** Список агентов; выбранная строка — подложкой, которая перетекает (useSlide). */
export function AgentList({
  agents,
  current,
  onOpen,
  withStatus,
  label,
}: {
  agents: PultAgent[];
  current: string | null;
  onOpen: (key: string) => void;
  withStatus: boolean;
  label: string;
}) {
  const sel = useSlide(64, 'q-slide pult-sel');
  const rows = useRef(new Map<string, HTMLElement>());
  useLayoutEffect(() => {
    const el = current ? rows.current.get(current) : undefined;
    if (el) sel.to(el.offsetTop, el.offsetHeight);
    else sel.hide();
  }, [current, agents, sel]);
  return (
    <div className="panel pult-list" role="list" aria-label={label}>
      {sel.node}
      {agents.map((a) => (
        <div
          key={a.key}
          role="listitem"
          ref={(el) => {
            if (el) rows.current.set(a.key, el);
            else rows.current.delete(a.key);
          }}
        >
          <Button
            className="pult-row"
            variant="quiet"
            dot={false}
            aria-current={a.key === current ? 'true' : undefined}
            onClick={() => onOpen(a.key)}
          >
            <AgentLine a={a} withStatus={withStatus} />
          </Button>
        </div>
      ))}
    </div>
  );
}

const EVENT_COLOR: Record<string, string> = {
  start: 'faint',
  info: 'faint',
  pr: 'sky',
  ci_red: 'red',
  ci_green: 'green',
  wait: 'orange',
  done: 'green',
};

/** Карточка агента: задача, модель, контекст, цена, кэш, PR и история событий (D-941). */
export function AgentCard({
  agentKey,
  board,
  wide,
}: {
  agentKey: string;
  board: PultBoard;
  wide: boolean;
}) {
  const card = useAgentCard(agentKey);
  const [answer, setAnswer] = useState(false);
  const fallback = board.agents.find((a) => a.key === agentKey);
  const a = card.data?.agent ?? fallback;
  if (!a)
    return (
      <div className="panel pult-box">
        <p className="pult-small">
          {card.isPending
            ? 'Загружаем…'
            : 'Этого агента уже нет: задача закрыта или сессия затихла.'}
        </p>
      </div>
    );
  const waiting = board.waiting.find((w) => w.key === a.key);
  const cache = cacheLabel(a.cache, true);
  const kv: [string, ReactNode][] = [
    ['Модель', a.model ? [a.model, a.effort].filter(Boolean).join(' · ') : 'нет данных'],
    [
      'Контекст',
      a.context != null ? (
        <span className="pult-ctx">
          <Meter
            value={a.context}
            total={wide ? 16 : 12}
            tone="sky"
            label={`контекст ${pct(a.context)}`}
            small
          />
          {pct(a.context)}
        </span>
      ) : (
        'нет данных'
      ),
    ],
    [
      'Цена',
      a.usd != null || a.tokens != null
        ? [
            a.usd != null ? `≈ ${usd(a.usd)}` : null,
            a.tokens != null ? `${tokens(a.tokens)} токенов` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : 'нет данных',
    ],
    [
      'Кэш',
      cache ? (
        <span className={a.cache?.warm ? 'pult-ink-green' : 'pult-ink-sky'}>{cache}</span>
      ) : (
        'нет данных'
      ),
    ],
    [
      'PR',
      a.pr ? (
        <span>
          <a className="pult-link pult-ink-sky" href={a.pr.url} target="_blank" rel="noreferrer">
            #{a.pr.number}
          </a>{' '}
          · {ciLabel(a.pr.ci)}
        </span>
      ) : (
        'нет'
      ),
    ],
  ];
  const events = card.data?.events ?? [];
  return (
    <article className="panel pult-box pult-card" aria-label={a.title}>
      <div className="pult-card-top">
        <span className={`pult-tag pult-tag-${STATUS_COLOR[a.status]}`}>
          <Dot color={STATUS_COLOR[a.status]} />
          {STATUS_LABEL[a.status]}
        </span>
        <span className="pult-small">{a.source}</span>
      </div>
      <h3 className="pult-card-title">{a.title}</h3>
      {a.task && <p className="pult-text pult-mute">{a.task}</p>}
      <dl className="pult-kv">
        {kv.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="pult-acts">
        {waiting && (
          <Button variant="fill" onClick={() => setAnswer(true)}>
            Ответить
          </Button>
        )}
        {a.session_url && (
          <a className="q-btn pult-link" href={a.session_url} target="_blank" rel="noreferrer">
            <span className="q-dot" aria-hidden="true" />
            Открыть сессию
          </a>
        )}
        {a.url && (
          <Button onClick={() => window.open(a.url ?? '', '_blank', 'noopener')}>
            Открыть задачу
          </Button>
        )}
        {a.pr && (
          <Button
            variant="quiet"
            onClick={() => window.open(a.pr?.url ?? '', '_blank', 'noopener')}
          >
            PR #{a.pr.number}
          </Button>
        )}
      </div>
      <SecHead text="ИСТОРИЯ" label="История">
        <span className="n">пишет код, 0 токенов</span>
      </SecHead>
      {events.length === 0 ? (
        <p className="pult-small">
          {card.isPending
            ? 'Загружаем…'
            : 'Событий пока нет — сервер запишет перемены статуса, PR и CI.'}
        </p>
      ) : (
        <ol className="pult-history">
          {events.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <time dateTime={e.at}>
                {new Date(e.at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}
              </time>
              <Dot color={EVENT_COLOR[e.kind] ?? 'faint'} />
              <span>{e.text}</span>
            </li>
          ))}
        </ol>
      )}
      {waiting && <AnswerSheet w={waiting} open={answer} onClose={() => setAnswer(false)} />}
    </article>
  );
}

// ---------------------------------------------------------------- источники и ПК

/** Откуда данные: GitHub и сборщики на ПК — честно, что есть и чего нет (D-980). */
export function Sources({ board, onConnect }: { board: PultBoard; onConnect: () => void }) {
  const qc = useQueryClient();
  const collectors = useCollectors(true);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const remove = async (id: string) => {
    setBusy(id);
    try {
      await must(api.DELETE('/api/owner/pult/collectors/{id}', { params: { path: { id } } }));
      toast.show('Сборщик отключён: его токен больше не работает');
      await qc.invalidateQueries({ queryKey: PULT_COLLECTORS });
      await qc.invalidateQueries({ queryKey: PULT });
    } catch (err) {
      // токен не отозван — сказать прямо, иначе похоже на успех
      toast.show(`Не отключили: ${say(err)}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="pult-sources" aria-label="Откуда данные">
      <SecHead text="ИСТОЧНИКИ" label="Откуда данные">
        <Button size="sm" variant="quiet" onClick={onConnect}>
          Подключить ПК
        </Button>
      </SecHead>
      <div className="panel pult-list">
        {board.sources.map((s, i) => (
          <div key={`${s.id}-${i}`} className="pult-src">
            <Dot color={s.ok ? 'green' : 'faint'} />
            <span className="pult-row-main">
              <span className="pult-row-title">{s.name}</span>
              <span className="pult-small">
                {s.note}
                {s.at && ` · ${ago(s.at, new Date(board.now))}`}
              </span>
            </span>
          </div>
        ))}
        {(collectors.data ?? []).map((c) => (
          <div key={c.id} className="pult-src">
            <DotIcon name="key" size={16} />
            <span className="pult-row-main">
              <span className="pult-row-title">Токен «{c.name}»</span>
              <span className="pult-small">
                {c.last_seen_at
                  ? `последняя сводка ${ago(c.last_seen_at, new Date(board.now))}`
                  : 'ещё ничего не присылал'}
              </span>
            </span>
            <Button
              size="sm"
              variant="quiet"
              disabled={busy === c.id}
              onClick={() => void remove(c.id)}
            >
              Отключить
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

/** «Подключить ПК»: выпустить токен сборщика и показать, куда его положить (D-981). */
export function ConnectSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('ПК');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const close = () => {
    setToken(null);
    setCopied(false);
    setError(null);
    onClose();
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const made = await must(
        api.POST('/api/owner/pult/collectors', { body: { name: name.trim() } }),
      );
      setToken(made.token);
      await qc.invalidateQueries({ queryKey: PULT_COLLECTORS });
      await qc.invalidateQueries({ queryKey: PULT });
    } catch (err) {
      setError(say(err));
    } finally {
      setBusy(false);
    }
  };
  const line = token ? `QUBITE_PULT_TOKEN=${token}` : '';
  return (
    <Sheet open={open} onClose={close} title="Подключить ПК">
      {token ? (
        <div className="pult-form">
          <Note tone="ok">Токен выпущен. Он показывается один раз — сохрани его сейчас.</Note>
          <ol className="pult-steps">
            <li>
              Положи строку в <code>~/.config/qubite/pult.env</code> (не в git):
              <pre className="pult-code">{line}</pre>
            </li>
            <li>
              Запусти сборщик из папки Qubite: <code>python3 scripts/pult_collect.py watch</code> —
              он шлёт сводку раз в 90 секунд.
            </li>
            <li>
              Для лимитов 5ч/7д в <code>~/.claude/settings.json</code> поставь строку состояния:{' '}
              <code>python3 …/scripts/pult_collect.py statusline</code>.
            </li>
          </ol>
          <div className="pult-acts">
            <Button
              variant="fill"
              onClick={() =>
                void navigator.clipboard?.writeText(line).then(
                  () => setCopied(true),
                  () => setCopied(false),
                )
              }
            >
              {copied ? 'Скопировано' : 'Скопировать строку'}
            </Button>
            <Button variant="quiet" onClick={close}>
              Готово
            </Button>
          </div>
        </div>
      ) : (
        <form className="pult-form" onSubmit={(e) => void create(e)} noValidate>
          <p className="pult-text">
            Сборщик на ПК читает журналы Claude Code и шлёт сюда сессии, расход и лимиты. Токен даёт
            только «прислать сводку» — больше ничего.
          </p>
          <Field
            label="Как назвать машину"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            error={error}
          />
          <div>
            <Button type="submit" variant="fill" disabled={busy || !name.trim()}>
              {busy ? 'Выпускаем…' : 'Выпустить токен'}
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

/** Пусто в «ждёт тебя» — Прото «Ничего не ждёт тебя». */
export function NothingWaits({ action }: { action?: ReactNode }) {
  return (
    <EmptyState
      kind="proto"
      label="Прото спокоен"
      title="Ничего не ждёт тебя"
      hint="Агенты работают сами. Загляни в Светофор."
    >
      {action}
    </EmptyState>
  );
}
