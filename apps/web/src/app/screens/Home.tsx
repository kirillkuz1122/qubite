import { Button, Check, DotIcon, Field, Presence, Sheet, useFlip } from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { plannerData, type PlannerProject, type PlannerTask } from '@qubite/sync-client';
import { api } from '../../api';
import { say } from '../../auth/client';
import { useShell } from '../context';
import { plural } from '../data';
import {
  HOME,
  searchPlaces,
  useHome,
  useLocate,
  useNews,
  useRates,
  useSaveSettings,
  useWeather,
  type HomeDigestItem,
  type HomeOverview,
  type HomePlace,
  type HomeSettings,
} from '../home';
import {
  DIGEST_KIND,
  ago,
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
 * агент; без агента её нет), ниже — факты: дела на сегодня, новое во Входящих и что агент
 * разложил, ближайшие сроки, погода, курсы и новости. Город, валюты и темы меняются тут же —
 * шестерёнкой у виджета.
 */
export function HomeScreen() {
  const home = useHome();
  const data = home.data;
  const box = useRef<HTMLDivElement>(null);
  const [moved, setMoved] = useState(0);
  useFlip(box, moved);
  const relayout = () => setMoved((n) => n + 1);
  return (
    <div className="flow home" ref={box}>
      {data?.agent && <Digest digest={data.digest ?? null} />}
      <Presence className="home-held panel" show={!!data?.held.length} onLayout={relayout}>
        {data && data.held.length > 0 && <Held held={data.held} />}
      </Presence>
      <div data-flip="home-rest">
        <TodayPart />
        <InboxPart filed={data?.filed ?? []} />
        <Deadlines />
        <Widgets settings={data?.settings ?? null} />
        <News settings={data?.settings ?? null} />
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
      {filed.length > 0 && (
        <div className="home-filed" aria-label="Агент разложил">
          <small>Агент разложил</small>
          {filed.map((f) => (
            <button
              className="spark home-filed-row"
              key={f.action_id}
              type="button"
              onClick={() => shell.go('agent')}
            >
              <span className="q-dot" />
              <span>{f.summary}</span>
              <small>{ago(f.at, new Date())}</small>
            </button>
          ))}
        </div>
      )}
    </>
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

type Part = 'weather' | 'rates' | 'news';

const PART_NAME: Record<Part, string> = {
  weather: 'Город погоды',
  rates: 'Валюты',
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
        <Rates open={open === 'rates'} onGear={() => toggle('rates')} />
      </div>
      <Sheet
        open={open !== null && !!settings}
        onClose={() => setOpen(null)}
        title={PART_NAME[shown]}
      >
        {settings && shown === 'weather' && <PlaceSettings settings={settings} />}
        {settings && shown === 'rates' && <CurrencySettings settings={settings} />}
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
    <small className="home-stale">источник не ответил — последнее известное</small>
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
    <Card title="Курсы ЦБ" gear={<Gear part="rates" open={open} onClick={onGear} />}>
      {r.isPending && <p className="later">Узнаю курсы…</p>}
      {r.isError && <p className="later">Курсы сейчас недоступны.</p>}
      {r.data && r.data.items.length === 0 && <p className="later">Валюты не выбраны.</p>}
      {r.data && (
        <>
          <ul className="home-rates">
            {r.data.items.map((x) => {
              const c = rateChange(x.change);
              return (
                <li key={x.code}>
                  <b>{x.code}</b>
                  <span>{rateValue(x.value, x.nominal)}</span>
                  <small data-dir={c.dir}>{c.text}</small>
                </li>
              );
            })}
          </ul>
          <Stale stale={r.data.stale} />
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
const MAX_CURRENCIES = 6;

function CurrencySettings({ settings }: { settings: HomeSettings }) {
  const save = useSaveSettings();
  const r = useRates();
  const [all, setAll] = useState(false);
  const available = r.data?.available.length ? r.data.available : DEFAULT_CURRENCIES;
  const chosen = settings.currencies;
  const shown = all ? available : available.filter((c, i) => i < 8 || chosen.includes(c.code));
  const flip = (code: string, on: boolean) =>
    save.mutate({
      currencies: on ? [...chosen, code] : chosen.filter((c) => c !== code),
    });
  return (
    <div role="group" aria-label="Валюты">
      <p className="home-set-now">
        Валюты на Главной — до {MAX_CURRENCIES}, курс ЦБ РФ на сегодня.
      </p>
      <div className="home-checks">
        {shown.map((c) => {
          const on = chosen.includes(c.code);
          return (
            <Check
              key={c.code}
              checked={on}
              onChange={(v) => (!v || chosen.length < MAX_CURRENCIES) && flip(c.code, v)}
            >
              {c.code} · {c.name}
            </Check>
          );
        })}
      </div>
      {!all && available.length > shown.length && (
        <button className="more" type="button" onClick={() => setAll(true)}>
          все валюты ЦБ →
        </button>
      )}
      {save.isError && <p className="act-error">{say(save.error)}</p>}
    </div>
  );
}

/* ---------- новости ---------- */

const TOPICS = [
  { id: 'ai', name: 'ИИ и технологии' },
  { id: 'code', name: 'Программирование' },
  { id: 'study', name: 'Олимпиады и учёба' },
];

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
        <div className="home-checks" role="group" aria-label="Темы новостей">
          {TOPICS.map((t) => (
            <Check
              key={t.id}
              checked={topics.includes(t.id)}
              onChange={(v) =>
                save.mutate({
                  topics: v ? [...topics, t.id] : topics.filter((x) => x !== t.id),
                })
              }
            >
              {t.name}
            </Check>
          ))}
        </div>
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
                {n.published && ` · ${ago(n.published, new Date())}`}
              </small>
            </li>
          ))}
      </ul>
      {news.data && <Stale stale={news.data.stale} />}
    </>
  );
}
