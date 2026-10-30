/**
 * Оболочка приложения (DS-007) по макету app.html: на ПК — боковая панель и плавающая Command,
 * на телефоне — нижняя «капля» разделов, которая превращается в строку Command.
 * Шапка: заголовок из точек перестраивается при переходе, помощник раздела выпрыгивает.
 */
import { loop, MASS } from '@qubite/motion';
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
import './app.css';

// CAL-001b ограничен подключением раздела в оболочке: общий Command пока не меняем.
type ShellSectionId = SectionId | 'calendar';
type ShellSection = Omit<Section, 'id' | 'path'> & { id: ShellSectionId; path: string };
const SECTIONS = BASE_SECTIONS.flatMap<ShellSection>((section) =>
  section.id === 'planner'
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
    case 'agent':
      return 'что сделал и почему · любое — откатить';
    case 'docs':
      return (
        <>
          <b>{s.docs.length}</b> {plural(s.docs.length, 'документ', 'документа', 'документов')} ·
          Нейт помнит связи
        </>
      );
    case 'settings':
      return 'вид, помощники и аккаунт';
  }
}

export function AppShell() {
  const wide = useMedia(WIDE);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { state } = useStore();
  const inbox = useInbox();
  const planner = usePlanner();
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
  const api = useMemo<ShellApi>(
    () => ({
      wide,
      go,
      cheer: (kind) => crew.current?.jump(kind),
      fly: (from, to, color, done) => flyDot(from, visibleTarget(to), color, done),
    }),
    [wide, go],
  );

  /* ---------- Command: запись, поиск, навигация (CMD-002) ---------- */
  const look = useLook();
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  /** пункт, выбранный стрелками; null — тот, что выбран сам */
  const [picked, setPicked] = useState<number | null>(null);
  const [history, setHistory] = useState(loadHistory);
  const menuOpen = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const parsed = value.trim() ? parseCommand(value) : null;
  const cmd = commandView(
    value,
    parsed,
    { ...state, week: planner.week, projects: planner.projects },
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
      } else if (e.key === 'Escape' && !menuOpen.current) closeCmd();
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
      onFocus={() => {
        setFocused(true);
        focusOn(() => (input.current ? caretPoint(input.current) : null));
      }}
      onBlur={() => {
        setFocused(false);
        focusOn(null);
        setTimeout(() => {
          if (!input.current?.value && !menuOpen.current && !wide) setOpen(false);
        }, 150);
      }}
    />
  );

  /* ---------- навигация ---------- */
  const items: NavItem<ShellSectionId>[] = SECTIONS.map((s) => ({
    id: s.id,
    label: s.name,
    icon: s.icon,
    count:
      s.id === 'inbox'
        ? inbox.items.length
        : s.id === 'planner'
          ? left(planner)
          : s.id === 'docs'
            ? state.docs.length
            : 0,
    badge: s.id === 'inbox',
  }));

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
          items={items}
          current={id}
          onGo={go}
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
    </ShellCtx.Provider>
  );
}

const LIST_ID = 'q-command-list';

const HELPER_NAME = { elik: 'Элик', proto: 'Прото', neit: 'Нейт', foti: 'Фоти' } as const;

/** Пункт раздела, который сейчас виден (на ПК — в боковой панели, на телефоне — в капле). */
function visibleTarget(id: SectionId): Element | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-nav-target="${id}"]`);
  for (const el of all) if (el.offsetParent !== null || el.getClientRects().length) return el;
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
