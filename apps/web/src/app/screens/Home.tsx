import {
  Button,
  Check,
  DotIcon,
  Field,
  Note,
  Presence,
  Sheet,
  useFlip,
  useLeaving,
} from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { plannerData, type PlannerProject, type PlannerTask } from '@qubite/sync-client';
import { api } from '../../api';
import { say } from '../../auth/client';
import { Opportunities } from '../HomeOpportunities';
import { useRevert } from '../agent';
import { useShell } from '../context';
import { plural } from '../data';
import {
  HOME,
  searchCoins,
  searchPlaces,
  useCoins,
  useHome,
  useLocate,
  useNews,
  useRates,
  useSaveSettings,
  useWeather,
  type HomeCoinMatch,
  type HomeDigestItem,
  type HomeOverview,
  type HomePlace,
  type HomeSettings,
} from '../home';
import {
  DIGEST_KIND,
  ago,
  coinChange,
  coinPrice,
  contestStart,
  digestTarget,
  heldLine,
  rateChange,
  rateValue,
  temp,
  upcoming,
} from '../home-view';
import { useInbox } from '../inbox-context';
import { SecHead, TaskList } from '../parts';
import { usePlanner } from '../planner-context';
import { reveal } from '../reveal';
import { useSync } from '../sync-context';
import '../home.css';

/**
 * Главная (HOME-001, D-298, D-327): первый экран после входа. Сверху — сводка от AI (её пишет
 * агент; без агента её нет), под ней — возможности (олимпиады и хакатоны, AGT-005), ниже —
 * факты: дела на сегодня, новое во Входящих и что агент разложил, ближайшие сроки, погода,
 * курсы и новости. Город, валюты и темы меняются тут же — шестерёнкой у виджета.
 */
export function HomeScreen() {
  const home = useHome();
  const data = home.data;
  const box = useRef<HTMLDivElement>(null);
  const [moved, setMoved] = useState(0);
  useFlip(box, moved);
  const relayout = () => setMoved((n) => n + 1);
  // «Возможности» меняют высоту (карточка ушла, «Дела поставлены») — то, что ниже, доезжает
  // пружиной. Сдвиги внутри .home-rest считаются от него самого (position: relative), поэтому
  // свой useFlip не путается с общим и строки «Агент разложил» не едут дважды.
  const rest = useRef<HTMLDivElement>(null);
  const [restMoved, setRestMoved] = useState(0);
  useFlip(rest, restMoved);
  const relayoutRest = useCallback(() => setRestMoved((n) => n + 1), []);
  return (
    <div className="flow home" ref={box}>
      {data?.agent && <Digest digest={data.digest ?? null} />}
      <Presence className="home-held panel" show={!!data?.held.length} onLayout={relayout}>
        {data && data.held.length > 0 && <Held held={data.held} />}
      </Presence>
      <div className="home-rest" data-flip="home-rest" ref={rest}>
        <Opportunities onLayout={relayoutRest} />
        <div className="home-below" data-flip="home-below">
          <TodayPart />
          <InboxPart filed={data?.filed ?? []} />
          <Deadlines />
          <Widgets settings={data?.settings ?? null} />
          <News settings={data?.settings ?? null} />
        </div>
      </div>
    </div>
  );
}

/* ---------- сводка от AI ---------- */

function Digest({ digest }: { digest: HomeOverview['digest'] }) {
  const shell = useShell();
  const go = (item: HomeDigestItem) => {
    const t = digestTarget(item);
    if (!t || 'url' in t) return;
    shell.go(t.section);
    if (t.obj) reveal(t.section, t.obj);
  };
  return (
    <section className="home-digest panel" aria-label="Сводка от AI">
      <div className="home-digest-h">
        <span className="ai-badge">от AI</span>
        <b>Сводка на сегодня</b>
        {digest && (
          <button className="more" type="button" onClick={() => shell.go('agent')}>
            почему →
          </button>
        )}
      </div>
      {!digest && (
        <p className="later">
          Агент напишет сводку утром: что важно сегодня, что он заметил, вопросы и новости по твоим
          темам.
        </p>
      )}
      {digest && (
        <ul className="home-digest-list">
          {digest.items.map((item, i) => {
            const kind = DIGEST_KIND[item.kind] ?? DIGEST_KIND.tip!;
            const t = digestTarget(item);
            return (
              <li key={i} data-kind={item.kind}>
                <span className="q-dot" style={{ background: `var(--q-${kind.color})` }} />
                <div>
                  <small>{kind.label}</small> {item.text}
                  {t && 'url' in t && (
                    <a className="home-link" href={t.url} target="_blank" rel="noopener noreferrer">
                      {t.label} ↗
                    </a>
                  )}
                  {t && !('url' in t) && (
                    <button className="home-link" type="button" onClick={() => go(item)}>
                      {t.label} →
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ---------- пришло в тишину (утренняя сводка, D-319) ---------- */

function Held({ held }: { held: HomeOverview['held'] }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const read = async () => {
    setBusy(true);
    await Promise.all(
      held.map((n) =>
        api
          .POST('/api/v1/notifications/{id}/read', { params: { path: { id: n.id } } })
          .catch(() => null),
      ),
    );
    setBusy(false);
    void qc.invalidateQueries({ queryKey: HOME });
    void qc.invalidateQueries({ queryKey: ['notices'] });
  };
  return (
    <>
      <b>{heldLine(held.length)}</b>
      <ul>
        {held.map((n) => (
          <li key={n.id}>
            {n.title}
            {n.body && <small> · {n.body}</small>}
          </li>
        ))}
      </ul>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void read()}>
        Прочитано
      </Button>
    </>
  );
}

/* ---------- дела на сегодня ---------- */

function TodayPart() {
  const planner = usePlanner();
  const shell = useShell();
  const tasks = planner.week[planner.today]!.tasks;
  const done = tasks.filter((t) => t.done).length;
  return (
    <>
      <SecHead text="ДЕЛА" label="Дела на сегодня">
        <button className="more" type="button" onClick={() => shell.go('today')}>
          {done} из {tasks.length} · сегодня →
        </button>
      </SecHead>
      {planner.loaded && tasks.length === 0 && (
        <p className="later">На сегодня дел нет. Запиши в Command: «/д #алгебра № 214 в 18:00».</p>
      )}
      <TaskList
        tasks={tasks}
        onToggle={(t, d) => {
          void planner.toggle(t.id, d);
          if (d) shell.cheer('proto');
        }}
      />
    </>
  );
}

/* ---------- Входящие и что агент разложил ---------- */

function InboxPart({ filed }: { filed: HomeOverview['filed'] }) {
  const inbox = useInbox();
  const shell = useShell();
  const box = useRef<HTMLDivElement>(null);
  const [rows, gone] = useLeaving(filed, (f) => f.action_id);
  useFlip(box, rows.map((r) => r.item.action_id + (r.leaving ? '~' : '')).join());
  const n = inbox.items.length;
  return (
    <>
      <SecHead text="ВХОДЯЩИЕ" label="Входящие">
        <button className="more" type="button" onClick={() => shell.go('inbox')}>
          {n ? `${n} ${plural(n, 'новая', 'новые', 'новых')} →` : 'все →'}
        </button>
      </SecHead>
      {n === 0 && filed.length === 0 && <p className="later">Пусто — всё разобрано.</p>}
      {inbox.items.slice(0, 3).map((it) => (
        <div className="spark" key={it.id}>
          <span className="q-dot" />
          <span>{it.text}</span>
          <small>{it.time}</small>
        </div>
      ))}
      {rows.length > 0 && (
        <div className="home-filed" ref={box} aria-label="Агент разложил">
          <small>Агент разложил</small>
          {rows.map(({ item: f, leaving }) => (
            <div key={f.action_id} data-flip={f.action_id}>
              <HomeFiledRow f={f} leaving={leaving} onGone={gone} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function HomeFiledRow({
  f,
  leaving,
  onGone,
}: {
  f: HomeOverview['filed'][number];
  leaving: boolean;
  onGone: (id: string) => void;
}) {
  const revert = useRevert();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const undo = () => {
    setError(null);
    revert.mutate(
      { target: { action: f.action_id }, force: false },
      {
        onSuccess: (result) => {
          if (result.status === 'conflict') {
            setError('После агента запись уже меняли. Открой «Агент», чтобы решить, что вернуть.');
            return;
          }
          void qc.invalidateQueries({ queryKey: HOME });
        },
        onError: (e) => setError(say(e)),
      },
    );
  };
  return (
    <Presence
      show={!leaving}
      className="item filed-row home-filed-row"
      onLayout={() => {
        if (leaving) onGone(f.action_id);
      }}
    >
      <span className="q-dot" />
      <div className="t">
        <Link className="txt home-link" to="/agent">
          {f.summary}
        </Link>
        <div className="elik">
          <time dateTime={f.at}>{ago(f.at, new Date())}</time>
          <Button size="sm" dot={false} disabled={revert.isPending || leaving} onClick={undo}>
            Откатить
          </Button>
        </div>
        <Presence show={!!error} swap={error}>
          <Note tone="bad">{error}</Note>
        </Presence>
      </div>
    </Presence>
  );
}

/* ---------- ближайшие сроки ---------- */

/** Все дела и проекты с устройства (неделя вперёд выходит за «эту неделю» Planner). */
function usePlannerAll() {
  const { client, version } = useSync();
  const [data, setData] = useState<{ tasks: PlannerTask[]; projects: PlannerProject[] } | null>(
    null,
  );
  useEffect(() => {
    if (!client) return;
    let alive = true;
    void plannerData(client).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [client, version]);
  return data;
}

function Deadlines() {
  const data = usePlannerAll();
  const shell = useShell();
  const day = new Date().toDateString();
  const list = useMemo(
    () => (data ? upcoming(data.tasks, data.projects, new Date()) : []),
    // пересчёт — при новых данных и в новый день
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, day],
  );
  return (
    <>
      <SecHead text="СРОКИ" label="Ближайшие сроки">
        <span className="n">неделя вперёд</span>
      </SecHead>
      {data && list.length === 0 && <p className="later">На неделю вперёд сроков нет.</p>}
      <div className="home-due">
        {list.map((u) => (
          <button
            key={u.id}
            className="home-due-row"
            type="button"
            onClick={() => {
              shell.go('planner');
              reveal('planner', u.id);
            }}
          >
            <span className="q-dot" style={{ background: `var(--q-${u.color})` }} />
            <span className="t">
              {u.title}
              {u.project && <small>{u.project}</small>}
            </span>
            <span className="time">{u.when}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/* ---------- погода и курсы ---------- */

type Part = 'weather' | 'rates' | 'coins' | 'news';

const PART_NAME: Record<Part, string> = {
  weather: 'Город погоды',
  rates: 'Валюты',
  coins: 'Монеты',
  news: 'Темы новостей',
};

function Gear({ part, open, onClick }: { part: Part; open: boolean; onClick: () => void }) {
  const name = PART_NAME[part];
  return (
    <button
      className="home-gear"
      type="button"
      aria-label={`Настроить: ${name}`}
      aria-expanded={open}
      onClick={onClick}
    >
      <DotIcon name="settings" size={18} />
    </button>
  );
}

/** Настройки виджетов — модальным окном, а не раскрытием в блоке (отзыв 21.10, D-434). */
function Widgets({ settings }: { settings: HomeSettings | null }) {
  const [open, setOpen] = useState<Part | null>(null);
  // какое окно было открыто последним — пока окно уходит, в нём то же содержимое
  const [shown, setShown] = useState<Part>('weather');
  const toggle = (p: Part) => {
    setShown(p);
    setOpen((o) => (o === p ? null : p));
  };
  return (
    <>
      <SecHead text="ПОГОДА И КУРСЫ" label="Погода и курсы" />
      <div className="home-widgets">
        <Weather open={open === 'weather'} onGear={() => toggle('weather')} />
        <div className="home-markets">
          <Rates open={open === 'rates'} onGear={() => toggle('rates')} />
          <Coins open={open === 'coins'} onGear={() => toggle('coins')} />
        </div>
      </div>
      <Sheet
        open={open !== null && !!settings}
        onClose={() => setOpen(null)}
        title={PART_NAME[shown]}
      >
        {settings && shown === 'weather' && <PlaceSettings settings={settings} />}
        {settings && shown === 'rates' && <CurrencySettings settings={settings} />}
        {settings && shown === 'coins' && <CoinSettings settings={settings} />}
      </Sheet>
    </>
  );
}

function Card({
  title,
  gear,
  children,
}: {
  title: ReactNode;
  gear: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="home-card panel">
      <div className="home-card-h">
        <span>{title}</span>
        {gear}
      </div>
      {children}
    </section>
  );
}

function Stale({ stale }: { stale: boolean }) {
  return stale ? (
    <small className="home-stale">устарело · источник не ответил — последнее известное</small>
  ) : null;
}

function Weather({ open, onGear }: { open: boolean; onGear: () => void }) {
  const w = useWeather();
  return (
    <Card
      title={<>Погода{w.data && <> · {w.data.place}</>}</>}
      gear={<Gear part="weather" open={open} onClick={onGear} />}
    >
      {w.isPending && <p className="later">Узнаю погоду…</p>}
      {w.isError && <p className="later">Погода сейчас недоступна.</p>}
      {w.data && (
        <>
          <div className="home-now" aria-label="Сейчас">
            <b>{temp(w.data.now.temperature)}</b>
            <span>
              {w.data.now.text}
              {w.data.now.feels_like != null && (
                <small>ощущается {temp(w.data.now.feels_like)}</small>
              )}
              {w.data.now.wind != null && <small>ветер {Math.round(w.data.now.wind)} м/с</small>}
            </span>
          </div>
          <ul className="home-days">
            {w.data.days.map((d, i) => (
              <li key={d.date}>
                <small>{['сегодня', 'завтра', 'послезавтра'][i] ?? d.date}</small>
                <span>
                  {temp(d.max)} / {temp(d.min)}
                </span>
                <small>
                  {d.text}
                  {d.precipitation != null && d.precipitation >= 30 && ` · ${d.precipitation}%`}
                </small>
              </li>
            ))}
          </ul>
          <Stale stale={w.data.stale} />
        </>
      )}
    </Card>
  );
}

function Rates({ open, onGear }: { open: boolean; onGear: () => void }) {
  const r = useRates();
  return (
    <Card title="Курсы валют" gear={<Gear part="rates" open={open} onClick={onGear} />}>
      {r.isPending && <p className="later">Узнаю курсы…</p>}
      {r.isError && !r.data && <p className="later">Курсы сейчас недоступны.</p>}
      {r.data && r.data.items.length === 0 && <p className="later">Валюты не выбраны.</p>}
      {r.data && (
        <>
          <ul className="home-rates">
            {r.data.items.map((x) => {
              const c = rateChange(x.change);
              return (
                <li key={x.code}>
                  <b>{x.code}</b>
                  <span>
                    {rateValue(x.value, x.nominal)}
                    <small className="home-rate-source">
                      {x.name} · {x.source === 'er-api' ? 'не ЦБ' : 'ЦБ РФ'}
                    </small>
                  </span>
                  <small data-dir={c.dir}>{c.text}</small>
                </li>
              );
            })}
          </ul>
          <Stale stale={r.data.stale || r.isError} />
        </>
      )}
    </Card>
  );
}

function Coins({ open, onGear }: { open: boolean; onGear: () => void }) {
  const coins = useCoins();
  return (
    <Card title="Криптовалюта" gear={<Gear part="coins" open={open} onClick={onGear} />}>
      {coins.isPending && <p className="later">Узнаю цены монет…</p>}
      {coins.isError && !coins.data && (
        <p className="later">Цены монет сейчас недоступны. Попробуйте позже.</p>
      )}
      {coins.data?.items.length === 0 && <p className="later">Добавьте монеты шестерёнкой</p>}
      {coins.data && (
        <>
          <ul className="home-coins">
            {coins.data.items.map((coin) => {
              const change = coinChange(coin.change_24h);
              return (
                <li key={coin.id}>
                  <div className="home-coin-name">
                    <b>{coin.symbol.toUpperCase()}</b>
                    <small>{coin.name}</small>
                  </div>
                  <div className="home-coin-price">
                    <span>{coinPrice(coin.usd, 'USD')}</span>
                    <small>{coinPrice(coin.rub, 'RUB')}</small>
                  </div>
                  <small
                    className="home-coin-change"
                    data-dir={change.dir}
                    style={{ color: change.color }}
                  >
                    {change.text}
                    {coin.change_24h != null && ' · 24 ч'}
                  </small>
                </li>
              );
            })}
          </ul>
          <Stale stale={coins.data.stale || coins.isError} />
        </>
      )}
    </Card>
  );
}

function PlaceSettings({ settings }: { settings: HomeSettings }) {
  const save = useSaveSettings();
  const locate = useLocate();
  const [q, setQ] = useState('');
  /** ответ поиска — для своего запроса (старый ответ на новый запрос не показываем) */
  const [result, setResult] = useState<{ q: string; items: HomePlace[]; error: string | null }>({
    q: '',
    items: [],
    error: null,
  });
  const text = q.trim();
  const current = result.q === text && text.length >= 2 ? result : null;
  const found = current?.items ?? [];
  const error = current?.error ?? null;
  useEffect(() => {
    if (text.length < 2) return;
    let alive = true;
    const t = setTimeout(() => {
      searchPlaces(text)
        .then(
          (r) =>
            alive &&
            setResult({
              q: text,
              items: r.items,
              error: r.items.length ? null : 'Такого города не нашлось',
            }),
        )
        .catch((e: unknown) => alive && setResult({ q: text, items: [], error: say(e) }));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [text]);
  const pick = (place: HomePlace) => {
    save.mutate({ place });
    setQ('');
  };
  return (
    <div role="group" aria-label="Город погоды">
      <p className="home-set-now">
        Сейчас: <b>{settings.place.name}</b>
        {settings.place.region && <small> · {settings.place.region}</small>}
      </p>
      <Field
        label="Другой город"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Например, Екатеринбург"
        error={error}
      />
      {found.length > 0 && (
        <ul className="home-found" aria-label="Найденные города">
          {found.map((p) => (
            <li key={`${p.latitude},${p.longitude}`}>
              <button type="button" onClick={() => pick(p)}>
                {p.name}
                {p.region && <small> · {p.region}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="home-set-btns">
        <Button
          size="sm"
          variant="outline"
          disabled={locate.isPending}
          onClick={() => locate.mutate()}
        >
          {locate.isPending ? 'Определяю…' : 'Определить по геолокации'}
        </Button>
      </div>
      <p className="home-set-hint">
        Браузер спросит разрешение. Координаты нужны один раз, чтобы найти город, — храним только
        город.
      </p>
      {locate.isError && <p className="act-error">{locate.error.message}</p>}
      {save.isError && <p className="act-error">{say(save.error)}</p>}
    </div>
  );
}

const DEFAULT_CURRENCIES = [
  { code: 'USD', name: 'Доллар США' },
  { code: 'EUR', name: 'Евро' },
  { code: 'CNY', name: 'Китайский юань' },
];
const MAX_CURRENCIES = 8;
const MAX_COINS = 6;
const DEFAULT_COINS: HomeCoinMatch[] = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'the-open-network', symbol: 'TON', name: 'TON' },
];

function CurrencySettings({ settings }: { settings: HomeSettings }) {
  const save = useSaveSettings();
  const rates = useRates();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(false);
  const available = rates.data?.available ?? DEFAULT_CURRENCIES;
  const chosen = settings.currencies;
  const text = q.trim().toLocaleLowerCase('ru');
  const found = available.filter(
    (c) => !chosen.includes(c.code) && `${c.code} ${c.name}`.toLocaleLowerCase('ru').includes(text),
  );
  const flip = (code: string, on: boolean) => {
    if (save.isPending) return;
    if (on && chosen.length >= MAX_CURRENCIES) {
      setLimit(true);
      return;
    }
    setLimit(false);
    save.mutate({ currencies: on ? [...chosen, code] : chosen.filter((c) => c !== code) });
  };
  return (
    <div role="group" aria-label="Валюты">
      <p className="home-set-now">До {MAX_CURRENCIES} валют. Показываем в порядке добавления.</p>
      <fieldset className="home-options" disabled={save.isPending}>
        <div className="home-checks home-chosen" aria-label="Выбранные валюты">
          {chosen.map((code) => (
            <Check key={code} checked onChange={() => flip(code, false)}>
              {code} · {available.find((c) => c.code === code)?.name ?? code}
            </Check>
          ))}
        </div>
        <Field
          label="Поиск валюты"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Код или название, например песо"
        />
        <div className="home-checks" aria-label="Доступные валюты">
          {found.map((c) => (
            <Check key={c.code} checked={false} onChange={() => flip(c.code, true)}>
              {c.code} · {c.name}
            </Check>
          ))}
        </div>
      </fieldset>
      {found.length === 0 && <p className="home-set-hint">Других валют по этому запросу нет.</p>}
      {rates.isError && <Note>Каталог валют сейчас недоступен. Попробуйте позже.</Note>}
      {limit && (
        <Note tone="bad">Можно выбрать до 8 валют. Сначала уберите одну из выбранных.</Note>
      )}
      {save.isError && <Note tone="bad">{say(save.error)}</Note>}
    </div>
  );
}

function CoinSettings({ settings }: { settings: HomeSettings }) {
  const save = useSaveSettings();
  const coins = useCoins();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(false);
  const [result, setResult] = useState<{
    q: string;
    items: HomeCoinMatch[];
    stale: boolean;
    error: string | null;
  }>({ q: '', items: [], stale: false, error: null });
  const text = q.trim();
  const current = text.length >= 2 && result.q === text ? result : null;
  const chosen = settings.coins ?? [];
  useEffect(() => {
    if (text.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchCoins(text, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) {
            setResult({ q: text, items: data.items, stale: data.stale, error: null });
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setResult({ q: text, items: [], stale: false, error: say(error) });
          }
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text]);
  const change = (ids: string[]) => {
    if (save.isPending) return;
    if (ids.length > MAX_COINS) {
      setLimit(true);
      return;
    }
    setLimit(false);
    save.mutate({ coins: ids });
  };
  const names = new Map(
    [...DEFAULT_COINS, ...result.items, ...(coins.data?.items ?? [])].map((c) => [c.id, c]),
  );
  return (
    <div role="group" aria-label="Монеты">
      <p className="home-set-now">До {MAX_COINS} монет. Цена в долларах и рублях.</p>
      <fieldset className="home-options" disabled={save.isPending}>
        <div className="home-checks home-chosen" aria-label="Выбранные монеты">
          {chosen.map((id) => {
            const coin = names.get(id);
            return (
              <Check key={id} checked onChange={() => change(chosen.filter((c) => c !== id))}>
                {coin ? `${coin.symbol.toUpperCase()} · ${coin.name}` : id}
              </Check>
            );
          })}
        </div>
        <Field
          label="Поиск монеты"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Например, Ethereum"
          {...(text.length < 2 ? { hint: 'Введите хотя бы 2 знака названия' } : {})}
          error={current?.error ?? null}
        />
        {text.length >= 2 && !current && (
          <p className="home-set-hint" role="status">
            Ищу монеты…
          </p>
        )}
        {current && !current.error && current.items.length === 0 && (
          <p className="home-set-hint">Монеты не найдены. Попробуйте другое название.</p>
        )}
        <div className="home-checks" aria-label="Найденные монеты">
          {current?.items
            .filter((c) => !chosen.includes(c.id))
            .map((coin) => (
              <Check key={coin.id} checked={false} onChange={() => change([...chosen, coin.id])}>
                {coin.symbol.toUpperCase()} · {coin.name}
              </Check>
            ))}
        </div>
        {current && <Stale stale={current.stale} />}
        <div className="home-set-btns">
          <Button size="sm" onClick={() => change(DEFAULT_COINS.map((c) => c.id))}>
            По умолчанию
          </Button>
        </div>
      </fieldset>
      {limit && (
        <Note tone="bad">Можно выбрать до 6 монет. Сначала уберите одну из выбранных.</Note>
      )}
      {save.isError && <Note tone="bad">{say(save.error)}</Note>}
    </div>
  );
}

/* ---------- новости ---------- */

function News({ settings }: { settings: HomeSettings | null }) {
  const news = useNews();
  const save = useSaveSettings();
  const [open, setOpen] = useState(false);
  const topics = settings?.topics ?? [];
  return (
    <>
      <SecHead text="НОВОСТИ" label="Новости">
        <Gear part="news" open={open} onClick={() => setOpen((o) => !o)} />
      </SecHead>
      <Sheet open={open && !!settings} onClose={() => setOpen(false)} title="Темы новостей">
        <fieldset className="home-options" disabled={save.isPending}>
          <div className="home-checks" role="group" aria-label="Темы новостей">
            {(settings?.available_topics ?? []).map((t) => (
              <Check
                key={t.id}
                checked={topics.includes(t.id)}
                onChange={(v) => {
                  if (!save.isPending) {
                    save.mutate({
                      topics: v ? [...topics, t.id] : topics.filter((x) => x !== t.id),
                    });
                  }
                }}
              >
                {t.title}
              </Check>
            ))}
          </div>
        </fieldset>
        {save.isError && <Note tone="bad">{say(save.error)}</Note>}
      </Sheet>
      {settings && topics.length === 0 && <p className="later">Темы новостей выключены.</p>}
      {topics.length > 0 && news.isError && <p className="later">Новости сейчас недоступны.</p>}
      {topics.length > 0 && news.data?.items.length === 0 && (
        <p className="later">Свежих новостей пока нет.</p>
      )}
      <ul className="home-news">
        {topics.length > 0 &&
          news.data?.items.map((n) => (
            <li key={n.url}>
              <a href={n.url} target="_blank" rel="noopener noreferrer">
                {n.title}
              </a>
              <small>
                {n.topic_title} · {n.source}
                {n.published &&
                  ` · ${n.topic === 'contests' ? contestStart(n.published) : ago(n.published, new Date())}`}
              </small>
            </li>
          ))}
      </ul>
      {news.data && <Stale stale={news.data.stale} />}
      <nav className="home-calendars" aria-label="Календари олимпиад">
        <a href="https://codolymp.ru/olympiads" target="_blank" rel="noopener noreferrer">
          Календарь олимпиад: Кодолимп
        </a>
        <a href="https://olimpiada.ru" target="_blank" rel="noopener noreferrer">
          Олимпиады школьников
        </a>
      </nav>
    </>
  );
}
