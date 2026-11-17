/**
 * Оболочка приложения (DS-007) по макету app.html: на ПК — боковая панель и плавающая Command,
 * на телефоне — нижняя «капля» разделов, которая превращается в строку Command.
 * Шапка: заголовок из точек перестраивается при переходе, помощник раздела выпрыгивает.
 */
import { loop, MASS } from '@qubite/motion';
import { docList } from '@qubite/sync-client';
import {
  COMMAND_COLOR,
  COMMAND_OWNER,
  CommandSuggest,
  Crew,
  Dock,
  DotGrid,
  DotText,
  EdgeScroll,
  SideNav,
  WIDE,
  caretPoint,
  flyDot,
  focusOn,
  parseCommand,
  suggestOptionId,
  useLook,
  useMedia,
  useSpring,
  type CrewHandle,
  type NavItem,
  type ParsedCommand,
} from '@qubite/ui';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { commandView, loadHistory, remember, saveHistory, type CommandEntry } from './command';
import { Bell } from './Bell';
import { CommandField } from './CommandField';
import { MoreSheet } from './MoreSheet';
import { CommandVoiceNote } from './VoiceCapture';
import { useVoice } from './voice-context';
import { ShellCtx, type ShellApi } from './context';
import {
  SECTIONS as BASE_SECTIONS,
  plural,
  dayLabel,
  isoWeek,
  weekLabel,
  type Section,
  type SectionId,
} from './data';
import { AgentScreen } from './screens/Agent';
import { CalendarScreen } from './screens/Calendar';
import { EnglishScreen } from './screens/English';
import { PultScreen } from './screens/Pult';
import { PultSubtitle } from './PultSubtitle';
import { usePult } from './pult';
import { DocsScreen } from './screens/Docs';
import { HomeScreen } from './screens/Home';
import { InboxScreen } from './screens/Inbox';
import { PlannerScreen } from './screens/Planner';
import { SettingsScreen } from './screens/Settings';
import { TodayScreen } from './screens/Today';
import { reveal } from './reveal';
import { useStore, type State } from './state';
import { useInbox } from './inbox-context';
import { usePlanner, type PlannerApi } from './planner-context';
import { useMe } from '../auth/client';
import { useSync } from './sync-context';
import './app.css';

// CAL-001b ограничен подключением раздела в оболочке: общий Command пока не меняем.
type ShellSectionId = SectionId | 'calendar' | 'english' | 'pult';
type ShellSection = Omit<Section, 'id' | 'path'> & { id: ShellSectionId; path: string };
/* «Английский» — отдельный модуль, а не вкладка Агента (DS-013, находка 22, D-914) */
const ENGLISH: ShellSection = {
  id: 'english',
  path: '/english',
  name: 'Английский',
  title: 'АНГЛИЙСКИЙ',
  icon: 'learn',
  who: 'neit',
};
/* «Пульт» агентов (HAR-002, AOS-5) — модуль только для владельца (D-949) */
const PULT: ShellSection = {
  id: 'pult',
  path: '/pult',
  name: 'Пульт',
  title: 'ПУЛЬТ',
  icon: 'pult',
  who: 'proto',
};
const SECTIONS = [...BASE_SECTIONS, PULT].flatMap<ShellSection>((section) =>
  section.id === 'docs'
    ? [section, ENGLISH]
    : section.id === 'planner'
      ? [
          section,
          {
            id: 'calendar',
            path: '/calendar',
            name: 'Календарь',
            title: 'КАЛЕНДАРЬ',
            icon: 'calendar',
            who: 'proto',
          },
        ]
      : [section],
);

const SCREENS: Record<ShellSectionId, () => ReactNode> = {
  home: () => <HomeScreen />,
  today: () => <TodayScreen />,
  inbox: () => <InboxScreen />,
  planner: () => <PlannerScreen />,
  calendar: () => <CalendarScreen />,
  english: () => <EnglishScreen />,
  pult: () => <PultScreen />,
  agent: () => <AgentScreen />,
  docs: () => <DocsScreen />,
  settings: () => <SettingsScreen />,
};

/**
 * Куда летит точка из Command. Дело, в котором разбор уверен, — сразу в Planner (PLAN-001, D-263);
 * остальное, пока нет заметок (DOC-002), — во «Входящие» черновиком с разбором (CMD-003, D-240).
 */
/** Уверенное дело с сутью — в Planner; без сути («#учёба завтра !») — во «Входящие» (D-289). */
const toPlanner = (p: ParsedCommand) =>
  p.kind === 'task' && p.review === null && p.text.trim() !== '';

function sectionOf(path: string): ShellSectionId {
  if (path === '/account') return 'settings';
  return SECTIONS.find((s) => path.startsWith(s.path))?.id ?? 'home';
}

function left(p: PlannerApi) {
  return p.week[p.today]?.tasks.filter((t) => !t.done).length ?? 0;
}

function subtitle(
  id: ShellSectionId,
  s: State,
  p: PlannerApi,
  wide: boolean,
  inbox: number,
): ReactNode {
  const today = p.week[p.today]!;
  switch (id) {
    case 'home': {
      const n = left(p);
      return (
        <>
          {dayLabel(today.date, !wide)} · <b>{n}</b> {plural(n, 'дело', 'дела', 'дел')} ·{' '}
          {inbox ? (
            <>
              <b>{inbox}</b> {plural(inbox, 'мысль', 'мысли', 'мыслей')}
            </>
          ) : (
            'всё разобрано'
          )}
        </>
      );
    }
    case 'today': {
      const n = left(p);
      return (
        <>
          {dayLabel(today.date, !wide)} · <b>{n}</b> {plural(n, 'дело', 'дела', 'дел')} осталось
        </>
      );
    }
    case 'inbox': {
      const n = inbox;
      return n ? (
        <>
          <b>{n}</b> {plural(n, 'мысль', 'мысли', 'мыслей')} · Элик ловит
        </>
      ) : (
        'всё разобрано'
      );
    }
    case 'planner':
      return (
        <>
          неделя {isoWeek(today.date)} · <b>{weekLabel(p.week)}</b>
        </>
      );
    case 'calendar':
      return 'события, дела и уроки';
    case 'english':
      return 'уроки с Нейтом · голос, глаголы, огонёк';
    case 'agent':
      return 'что сделал и почему · любое — откатить';
    case 'docs':
      return 'заметки и документы · доступны без сети';
    case 'settings':
      return 'вид, помощники, голос и аккаунт';
    case 'pult':
      return <PultSubtitle />;
  }
}

export function AppShell() {
  const wide = useMedia(WIDE);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { state } = useStore();
  const inbox = useInbox();
  const planner = usePlanner();
  const sync = useSync();
  /* Пульт и его точка «ждёт тебя» — только у владельца (D-949, D-961) */
  const owner = !!useMe().data?.is_owner;
  const pult = usePult(owner);
  const waiting = pult.data?.counts.waiting ?? 0;
  const [documents, setDocuments] = useState<State['docs']>([]);
  useEffect(() => {
    let alive = true;
    if (!sync.client) return;
    void sync.client
      .all()
      .then((objects) => {
        if (alive)
          setDocuments(
            docList(objects).map((doc) => ({
              id: doc.id,
              name: doc.title,
              pre: doc.preview,
              tags: [],
              when: '',
            })),
          );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sync.client, sync.version]);
  const id = sectionOf(path);
  const sec = SECTIONS.find((s) => s.id === id)!;
  const crew = useRef<CrewHandle>(null);

  /* ---------- переход между экранами: старый уезжает, новый въезжает с той стороны ---------- */
  const [view, setView] = useState(id);
  const screen = useRef<HTMLDivElement>(null);
  const sp = useSpring(0, MASS.pill, (v) => {
    const el = screen.current;
    if (!el) return;
    el.style.opacity = Math.min(1, Math.max(0, 1 - Math.abs(v))).toFixed(3);
    el.style.transform = v === 0 ? '' : `translateX(${(v * 28).toFixed(2)}px)`;
  });
  useEffect(() => {
    if (id === view) return;
    const L = loop();
    const ids = SECTIONS.map((s) => s.id);
    const dir = ids.indexOf(id) > ids.indexOf(view) ? 1 : -1;
    L.to(sp, -dir * 0.6);
    const t = setTimeout(
      () => {
        setView(id);
        scrollTo(0, 0);
        L.set(sp, dir);
        L.to(sp, 0);
      },
      L.reduced ? 0 : 110,
    );
    return () => clearTimeout(t);
  }, [id, view, sp]);

  useEffect(() => {
    document.title = `${sec.name} · Qubite`;
  }, [sec.name]);

  /* ---------- подзаголовок проявляется снизу ---------- */
  const sub = useRef<HTMLDivElement>(null);
  const subS = useSpring(1, MASS.dot + 0.05, (x) => {
    if (!sub.current) return;
    sub.current.style.opacity = Math.min(1, Math.max(0, x)).toFixed(3);
    sub.current.style.transform = `translateY(${((1 - x) * 6).toFixed(2)}px)`;
  });
  useEffect(() => {
    const L = loop();
    L.set(subS, 0);
    L.to(subS, 1);
  }, [id, subS]);

  /* ---------- что оболочка даёт разделам ---------- */
  const go = useCallback(
    (to: ShellSectionId) => void navigate({ to: SECTIONS.find((s) => s.id === to)!.path }),
    [navigate],
  );
  const helperOn = state.helpers[sec.who];
  const write = useRef(() => {});
  const api = useMemo<ShellApi>(
    () => ({
      wide,
      go,
      write: () => write.current(),
      cheer: (kind) => crew.current?.jump(kind),
      fly: (from, to, color, done) => flyDot(from, visibleTarget(to), color, done),
    }),
    [wide, go],
  );

  /* ---------- Command: запись, поиск, навигация (CMD-002) ---------- */
  const look = useLook();
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  /** пункт, выбранный стрелками; null — тот, что выбран сам */
  const [picked, setPicked] = useState<number | null>(null);
  const [history, setHistory] = useState(loadHistory);
  const menuOpen = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  /* голос (CMD-005b): пока идёт запись, строка на телефоне не сворачивается, Escape её отменяет */
  const voice = useVoice();
  const voiceNow = useRef({ phase: voice.phase, cancel: voice.cancel, value });
  useEffect(() => {
    voiceNow.current = { phase: voice.phase, cancel: voice.cancel, value };
  });
  const card = useRef<HTMLDivElement>(null);
  const parsed = value.trim() ? parseCommand(value) : null;
  const cmd = commandView(
    value,
    parsed,
    { docs: documents, week: planner.week, projects: planner.projects },
    inbox.items,
    history,
  );
  const shown = focused && (wide || open);
  const count = (cmd.parsed ? 1 : 0) + cmd.hits.length;
  const active = shown ? Math.min(picked ?? cmd.active, count - 1) : -1;

  const change = useCallback((v: string) => {
    setValue(v);
    setPicked(null);
  }, []);
  const openCmd = useCallback(() => {
    if (!wide) setOpen(true);
    requestAnimationFrame(() => input.current?.focus());
  }, [wide]);
  useEffect(() => {
    write.current = openCmd;
  }, [openCmd]);
  const closeCmd = useCallback(() => {
    setOpen(false);
    change('');
    input.current?.blur();
  }, [change]);
  const finish = () => {
    change('');
    setTimeout(() => (wide ? input.current?.blur() : closeCmd()), 120);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // физическая клавиша K: в русской раскладке e.key — «л», а Ctrl+K должен работать всегда
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyK' || e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        openCmd();
      } else if (e.key === 'Escape' && !menuOpen.current) {
        const v = voiceNow.current;
        if (v.phase === 'recording' || v.phase === 'asking') v.cancel();
        else closeCmd();
      }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [openCmd, closeCmd]);

  /**
   * Сохранить запись: уверенное дело — в Planner, остальное во «Входящие» строкой как есть —
   * сервер разберёт её тем же разбором, что показан в карточке, и положит черновик в элемент (CMD-003).
   */
  function save(p: ParsedCommand, raw = value.trim()) {
    if (!raw) return;
    setHistory(remember(history, raw, p.kind));
    const r = card.current?.getBoundingClientRect();
    const owner = COMMAND_OWNER[p.kind];
    api.fly(
      { x: (r?.left ?? innerWidth / 2) + 26, y: (r?.bottom ?? innerHeight - 100) - 30 },
      toPlanner(p) ? 'planner' : 'inbox',
      COMMAND_COLOR[p.kind],
      () => {
        if (toPlanner(p)) void planner.add(raw);
        else void inbox.capture(raw);
        api.cheer(owner);
      },
    );
    finish();
  }

  /** Выбран найденный пункт. */
  function run(hit: CommandEntry) {
    const r = hit.run;
    if (r.type === 'fill') {
      change(r.text);
      requestAnimationFrame(() => input.current?.focus());
      return;
    }
    if (r.type === 'history.clear') {
      saveHistory([]);
      setHistory([]);
      change('');
      return;
    }
    if (r.type === 'project.new') {
      setHistory(remember(history, value, 'search'));
      void planner.newProject(r.name).then(({ id }) => {
        go('planner');
        reveal('planner', `proj-${id}`, true);
        api.cheer('proto');
      });
      finish();
      return;
    }
    if (r.type === 'save') {
      // «найди квазары» не нашлось — сохраняем то, что искали, как мысль
      const text = parsed?.text || value.trim();
      const thought = parseCommand(`/м ${text}`);
      if (text && thought) save(thought, text);
      return;
    }
    if (value.trim()) setHistory(remember(history, value, parsed?.kind ?? 'search'));
    if (r.type === 'theme') {
      const box = card.current?.getBoundingClientRect();
      look.set('theme', r.value, box && { x: box.left + box.width / 2, y: box.bottom });
    } else {
      if (r.to === 'docs' && r.obj) {
        void navigate({ to: '/docs/$id', params: { id: r.obj } });
        finish();
        return;
      }
      go(r.to);
      if (r.obj) reveal(r.to, r.obj, r.open);
    }
    finish();
  }

  function submit(i = active) {
    if (i < 0) return;
    if (cmd.parsed && i === 0) return save(cmd.parsed);
    const hit = cmd.hits[i - (cmd.parsed ? 1 : 0)];
    if (hit) run(hit);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!count || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const from = active < 0 ? (e.key === 'ArrowDown' ? -1 : count) : active;
    setPicked((from + (e.key === 'ArrowDown' ? 1 : -1) + count) % count);
  }

  const field = (
    <CommandField
      inputRef={input}
      value={value}
      wide={wide}
      listId={LIST_ID}
      expanded={shown && count > 0}
      activeId={active >= 0 ? suggestOptionId(LIST_ID, active) : undefined}
      onChange={change}
      onKeyDown={onKey}
      onMenu={(o) => (menuOpen.current = o)}
      onVoiceSaved={() => {
        // как записанная мысль: точка летит во «Входящие», Элик радуется
        const r = card.current?.getBoundingClientRect();
        api.fly(
          { x: (r?.left ?? innerWidth / 2) + 26, y: (r?.bottom ?? innerHeight - 100) - 30 },
          'inbox',
          'yellow',
          () => api.cheer('elik'),
        );
        if (!wide && !voiceNow.current.value) setOpen(false);
      }}
      onFocus={() => {
        setFocused(true);
        focusOn(() => (input.current ? caretPoint(input.current) : null));
      }}
      onBlur={() => {
        setFocused(false);
        focusOn(null);
        setTimeout(() => {
          if (voiceNow.current.phase !== 'idle') return;
          if (!input.current?.value && !menuOpen.current && !wide) setOpen(false);
        }, 150);
      }}
    />
  );

  /* ---------- навигация ---------- */
  const all: NavItem<ShellSectionId>[] = SECTIONS.filter((s) => owner || s.id !== 'pult').map(
    (s) => ({
      id: s.id,
      label: s.name,
      icon: s.icon,
      count:
        s.id === 'inbox'
          ? inbox.items.length
          : s.id === 'planner'
            ? left(planner)
            : s.id === 'docs'
              ? documents.length
              : s.id === 'pult'
                ? waiting
                : 0,
      badge: s.id === 'inbox' || s.id === 'pult',
    }),
  );
  /* ПК: модули — отдельной группой под разделами, Пульт первый (D-955) */
  const items = all.filter((i) => !MODULES.includes(i.id));
  const modules = all.filter((i) => MODULES.includes(i.id));
  /* телефон: Главная, Сегодня, Planner и «Ещё» (D-866, «Входящие» — в «Ещё» по D-945);
     у владельца между Сегодня и Planner — Пульт с точкой «ждёт тебя» (D-945, D-952, D-961) */
  const dockMain = owner ? DOCK_OWNER : DOCK_MAIN;
  const inDock = (i: NavItem<ShellSectionId>) => dockMain.includes(i.id);
  const rest = all.filter((i) => !inDock(i));
  const dockItems: NavItem<DockId>[] = [
    ...dockMain.flatMap((id) => all.filter((i) => i.id === id)),
    {
      id: 'more',
      label: 'Ещё',
      icon: 'more',
      count: rest.reduce((n, i) => n + (i.badge ? (i.count ?? 0) : 0), 0),
      badge: true,
    },
  ];
  const dockCurrent: DockId = dockMain.includes(id) ? id : 'more';

  const pitch = wide ? 5.6 : 4.4;
  const headH = wide ? 136 : 112;

  return (
    <ShellCtx.Provider value={api}>
      <DotGrid />
      {/* своя прокрутка: точки заголовков у края, на телефоне — выше капли */}
      <EdgeScroll bottom={wide ? 24 : 100} />
      {wide && (
        <aside className="side" aria-label="Боковая панель">
          <div className="side-logo">
            <DotText text="qubite" pitch={3.2} assemble={false} label="Qubite" repel={0} />
            <span className="q-dot" />
          </div>
          <SideNav items={items} current={id} onGo={go} />
          {modules.length > 0 && (
            <>
              <div className="side-group">Модули</div>
              <SideNav items={modules} current={id} onGo={go} label="Модули" />
            </>
          )}
          <div className="side-foot">
            <SideMe />
            <Bell wide />
          </div>
        </aside>
      )}

      <div className="main">
        <div className="main-in">
          <header className="head" style={{ height: headH }}>
            <h1 className="q-sr">{sec.name}</h1>
            <div className="head-title">
              <span className="head-dots" aria-hidden="true">
                <DotText text={sec.title} pitch={pitch} label={sec.name} />
              </span>
              {!wide && <Bell wide={false} />}
            </div>
            <div className="head-crew">
              <Crew
                ref={crew}
                active={helperOn ? sec.who : null}
                pitch={wide ? 3.9 : 3.3}
                height={headH}
                label={helperOn ? HELPER_NAME[sec.who] : 'Помощник спрятан'}
              />
            </div>
            <div className="head-sub" ref={sub}>
              {subtitle(id, state, planner, wide, inbox.items.length)}
            </div>
          </header>
          <div className="screen" ref={screen} data-screen={view}>
            {SCREENS[view]()}
          </div>
        </div>
      </div>

      <CommandVoiceNote wide={wide} />
      <CommandSuggest
        ref={card}
        parsed={shown ? cmd.parsed : null}
        hits={shown ? cmd.hits : []}
        heading={cmd.heading}
        active={active}
        listId={LIST_ID}
        onPick={submit}
        className={wide ? 'suggest wide' : 'suggest'}
      />
      {wide ? (
        <form
          className="pc-cmd"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {field}
        </form>
      ) : (
        <Dock
          items={dockItems}
          current={dockCurrent}
          onGo={(to) => {
            if (to !== 'more') return go(to);
            setMoreOpen(true);
            return false; // «Ещё» — окно, а не раздел: подсветка остаётся на текущем
          }}
          open={open && !wide}
          onOpenChange={(o) => (o ? openCmd() : closeCmd())}
        >
          <form
            className="dock-form"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {field}
          </form>
        </Dock>
      )}
      {!wide && (
        <MoreSheet
          open={moreOpen}
          items={rest}
          current={id}
          onGo={go}
          onClose={() => setMoreOpen(false)}
        />
      )}
    </ShellCtx.Provider>
  );
}

const LIST_ID = 'q-command-list';

type DockId = ShellSectionId | 'more';
const DOCK_MAIN: ShellSectionId[] = ['home', 'today', 'planner'];
const DOCK_OWNER: ShellSectionId[] = ['home', 'today', 'pult', 'planner'];
const MODULES: ShellSectionId[] = ['pult'];

const HELPER_NAME = { elik: 'Элик', proto: 'Прото', neit: 'Нейт', foti: 'Фоти' } as const;

/** Пункт раздела, который сейчас виден (на ПК — в боковой панели, на телефоне — в капле). */
function visibleTarget(id: SectionId): Element | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-nav-target="${id}"]`);
  for (const el of all) if (el.offsetParent !== null || el.getClientRects().length) return el;
  // на телефоне раздел может жить в листе «Ещё» — точка летит в кнопку «Ещё»
  const more = document.querySelector<HTMLElement>('.q-dock [data-nav-target="more"]');
  if (more?.getClientRects().length) return more;
  return all[0] ?? null;
}

/** Внизу боковой панели — кто вошёл на самом деле, ссылка на «Аккаунт». */
function SideMe() {
  const me = useMe().data;
  if (!me) return null;
  const name = me.display_name || me.email;
  return (
    <Link className="side-me" to="/account" aria-label={`Аккаунт: ${name}`}>
      <span className="side-av" aria-hidden="true">
        {name.trim().charAt(0).toUpperCase()}
      </span>
      <span className="side-me-who">
        {name}
        <small>{me.is_owner ? 'владелец' : me.email}</small>
      </span>
    </Link>
  );
}
