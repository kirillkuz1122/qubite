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
  useMedia,
  useSpring,
  type CrewHandle,
  type NavItem,
  type ParsedCommand,
} from '@qubite/ui';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CommandField } from './CommandField';
import { ShellCtx, type ShellApi } from './context';
import { SECTIONS, plural, dayLabel, isoWeek, weekLabel, type SectionId } from './data';
import { DocsScreen } from './screens/Docs';
import { InboxScreen } from './screens/Inbox';
import { PlannerScreen } from './screens/Planner';
import { SettingsScreen } from './screens/Settings';
import { TodayScreen } from './screens/Today';
import { todayIndex, useStore, type State } from './state';
import { useInbox } from './inbox-context';
import './app.css';

const SCREENS: Record<SectionId, () => ReactNode> = {
  today: () => <TodayScreen />,
  inbox: () => <InboxScreen />,
  planner: () => <PlannerScreen />,
  docs: () => <DocsScreen />,
  settings: () => <SettingsScreen />,
};

/** Куда ляжет запись из Command. */
const DEST: Record<ParsedCommand['kind'], SectionId> = {
  task: 'planner',
  thought: 'inbox',
  search: 'docs',
  journal: 'today',
  note: 'docs',
};

function sectionOf(path: string): SectionId {
  return SECTIONS.find((s) => path.startsWith(s.path))?.id ?? 'today';
}

function left(s: State) {
  return s.week[todayIndex(s)]?.tasks.filter((t) => !t.done).length ?? 0;
}

function subtitle(id: SectionId, s: State, wide: boolean, inbox: number): ReactNode {
  const today = s.week[todayIndex(s)]!;
  switch (id) {
    case 'today': {
      const n = left(s);
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
          неделя {isoWeek(today.date)} · <b>{weekLabel(s.week)}</b>
        </>
      );
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
  const { state, dispatch } = useStore();
  const inbox = useInbox();
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
    (to: SectionId) => void navigate({ to: SECTIONS.find((s) => s.id === to)!.path }),
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

  /* ---------- Command ---------- */
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const menuOpen = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const parsed = value.trim() ? parseCommand(value) : null;

  const openCmd = useCallback(() => {
    if (!wide) setOpen(true);
    requestAnimationFrame(() => input.current?.focus());
  }, [wide]);
  const closeCmd = useCallback(() => {
    setOpen(false);
    setValue('');
    input.current?.blur();
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCmd();
      } else if (e.key === 'Escape' && !menuOpen.current) closeCmd();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [openCmd, closeCmd]);

  function save() {
    if (!parsed) return;
    const to = DEST[parsed.kind];
    const text = parsed.text || value.trim();
    if (parsed.kind === 'search') {
      closeCmd();
      go('docs');
      return;
    }
    const r = card.current?.getBoundingClientRect();
    const owner = COMMAND_OWNER[parsed.kind];
    api.fly(
      { x: (r?.left ?? innerWidth / 2) + 26, y: (r?.top ?? innerHeight - 100) + 22 },
      to,
      COMMAND_COLOR[parsed.kind],
      () => {
        if (parsed.kind === 'thought') void inbox.capture(text);
        if (parsed.kind === 'task') dispatch({ type: 'task.add', title: text, time: parsed.when });
        if (parsed.kind === 'note') dispatch({ type: 'doc.add', name: text || 'Новый конспект' });
        api.cheer(owner);
      },
    );
    setValue('');
    setTimeout(() => (wide ? input.current?.blur() : closeCmd()), 120);
  }

  const field = (
    <CommandField
      inputRef={input}
      value={value}
      wide={wide}
      onChange={setValue}
      onMenu={(o) => (menuOpen.current = o)}
      onFocus={() => focusOn(() => (input.current ? caretPoint(input.current) : null))}
      onBlur={() => {
        focusOn(null);
        setTimeout(() => {
          if (!input.current?.value && !menuOpen.current && !wide) setOpen(false);
        }, 150);
      }}
    />
  );

  /* ---------- навигация ---------- */
  const items: NavItem<SectionId>[] = SECTIONS.map((s) => ({
    id: s.id,
    label: s.name,
    icon: s.icon,
    count:
      s.id === 'inbox'
        ? inbox.items.length
        : s.id === 'planner'
          ? left(state)
          : s.id === 'docs'
            ? state.docs.length
            : 0,
    badge: s.id === 'inbox',
  }));

  const pitch = wide ? 5.6 : 4.4;
  const headH = wide ? 136 : 112;
  const leftToday = left(state);

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
          <div className="side-crew">
            <b>Помощники рядом.</b> Элик поймал {inbox.items.length}{' '}
            {plural(inbox.items.length, 'мысль', 'мысли', 'мыслей')}, Прото держит {leftToday}{' '}
            {plural(leftToday, 'дело', 'дела', 'дел')} на сегодня.
          </div>
          <div className="side-me">
            <span className="side-av">К</span>
            <div>
              Кирилл
              <small>владелец</small>
            </div>
          </div>
        </aside>
      )}

      <div className="main">
        <div className="main-in">
          <header className="head" style={{ height: headH }}>
            <h1 className="q-sr">{sec.name}</h1>
            <div className="head-title" aria-hidden="true">
              <DotText text={sec.title} pitch={pitch} label={sec.name} />
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
              {subtitle(id, state, wide, inbox.items.length)}
            </div>
          </header>
          <div className="screen" ref={screen} data-screen={view}>
            {SCREENS[view]()}
          </div>
        </div>
      </div>

      <CommandSuggest ref={card} parsed={parsed} className={wide ? 'suggest wide' : 'suggest'} />
      {wide ? (
        <form
          className="pc-cmd"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            save();
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
              save();
            }}
          >
            {field}
          </form>
        </Dock>
      )}
    </ShellCtx.Provider>
  );
}

const HELPER_NAME = { elik: 'Элик', proto: 'Прото', neit: 'Нейт', foti: 'Фоти' } as const;

/** Пункт раздела, который сейчас виден (на ПК — в боковой панели, на телефоне — в капле). */
function visibleTarget(id: SectionId): Element | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-nav-target="${id}"]`);
  for (const el of all) if (el.offsetParent !== null || el.getClientRects().length) return el;
  return all[0] ?? null;
}
