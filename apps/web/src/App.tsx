import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  modules as demoModules,
  demoVisibility,
  moduleState,
  type VisibilityMap,
} from "./catalog";
import {
  demoSession,
  hasGrant,
  useIdentity,
  type Persona,
  type Session,
} from "./identity";
import { Brand, Dialog, Empty, Icon } from "./ui";
import {
  LivingButton,
  LivingLink,
  LivingSlider,
  LivingSwitch,
  LivingTabs,
  LivingNavigation,
} from "./material/Controls";
import { MotionContext } from "./material/motion";
import { useAppearance } from "./appearance";
import { Public } from "./auth/Public";
import { consumeAuthLink, type AuthEntry } from "./auth/routes";
import { Security } from "./auth/Security";
import { useCatalog, statusText, type Card } from "./catalog-api";
import { OwnerCatalog } from "./OwnerCatalog";
import { MorphContent } from "./material/Transition";
import { Mark } from "./material/Marks";
import "./material/material.css";

const navigation = [
  { path: "/", name: "Главная", icon: "home" },
  { path: "/modules", name: "Модули", icon: "grid" },
  { path: "/inbox", name: "Входящие", icon: "inbox" },
  { path: "/profile", name: "Профиль", icon: "user" },
];
function readRoute() {
  const route = location.hash.slice(1) || "/";
  return route.startsWith("/") && !route.includes("?") ? route : "/404";
}
function navigate(route: string) {
  location.hash = route;
}
type Note = { id: number; text: string };
export function App({ initialEntry }: { initialEntry: AuthEntry }) {
  const [entry, setEntry] = useState(initialEntry);
  useEffect(() => {
    const update = () => setEntry(consumeAuthLink());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return __QUBITE_DEMO__ ? <Demo entry={entry} /> : <Runtime entry={entry} />;
}
function Runtime({ entry }: { entry: AuthEntry }) {
  const { identity, refresh } = useIdentity();
  const route = entry.route;
  useEffect(() => {
    if (route === "/auth/complete" || route === "/auth/linked") refresh();
  }, [route, refresh]);
  useEffect(() => {
    if (
      identity.status === "authenticated" &&
      [
        "/auth/login",
        "/auth/register",
        "/auth/complete",
        "/auth/linked",
      ].includes(route)
    )
      navigate(route === "/auth/linked" ? "/profile" : "/");
  }, [identity.status, route]);
  if (
    identity.status === "authenticated" &&
    !route.startsWith("/auth/") &&
    !route.startsWith("/legal/")
  )
    return (
      <Shell
        key={identity.session.profile.id}
        session={identity.session}
        demo={false}
        onIdentityChange={refresh}
      />
    );
  return (
    <Public
      route={route}
      entry={entry}
      status={identity.status}
      refresh={refresh}
      onAuthenticated={() => {
        navigate("/");
        refresh();
      }}
    />
  );
}
function Demo({ entry }: { entry: AuthEntry }) {
  const [persona, setPersona] = useState<Persona>("owner"),
    [visibility, setVisibility] = useState(demoVisibility);
  if (
    entry.route === "/welcome" ||
    entry.route.startsWith("/auth/") ||
    entry.route.startsWith("/legal/")
  )
    return (
      <Public
        demo
        route={entry.route}
        entry={entry}
        onAuthenticated={() => {}}
      />
    );
  return (
    <Shell
      key={persona}
      session={demoSession(persona)}
      demo
      visibility={visibility}
      setVisibility={setVisibility}
      persona={persona}
      onPersona={setPersona}
    />
  );
}

function Shell({
  session,
  demo,
  visibility = {},
  setVisibility,
  persona,
  onPersona,
  onIdentityChange,
}: {
  session: Session;
  demo: boolean;
  visibility?: VisibilityMap;
  setVisibility?: (v: VisibilityMap) => void;
  persona?: Persona;
  onPersona?: (v: Persona) => void;
  onIdentityChange?: () => void;
}) {
  const [route, setRoute] = useState(readRoute),
    [dialog, setDialog] = useState<"preview" | "voice" | null>(null);
  const liveCatalog = useCatalog(demo, route, onIdentityChange);
  const modules = demo ? demoModules : liveCatalog.catalog.items;
  const stateOf = (id: string) => {
    if (demo) {
      const state = moduleState(session, id, visibility);
      return state === "unavailable"
        ? id === "planner"
          ? "unavailable"
          : "preparing"
        : state;
    }
    const m = modules.find((m) => m.id === id) as Card | undefined;
    if (!m || liveCatalog.missing) return "missing";
    return m.status === "locked" ? "denied" : m.status;
  };
  const [notes, setNotes] = useState<Note[]>([]),
    [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const { prefs, setPrefs, stopped, motion } = useAppearance();
  const root = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    dock = useRef<HTMLFormElement>(null),
    initial = useRef(true);
  const closing = useRef(false);
  function dismissDialog(after?: () => void) {
    if (closing.current) return;
    const el = root.current?.querySelector<HTMLDialogElement>("dialog");
    const finish = () => {
      closing.current = false;
      setDialog(null);
      after?.();
    };
    if (!el || stopped) {
      finish();
      return;
    }
    closing.current = true;
    const animation = el.animate(
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "translateY(16px) scale(.96,1.02)" },
      ],
      {
        duration: Math.min(300, prefs.duration * 0.45),
        easing: "cubic-bezier(.3,0,.7,1)",
        fill: "forwards",
      },
    );
    void animation.finished.then(finish).catch(() => {
      closing.current = false;
    });
  }
  const canReadInbox = hasGrant(session, "inbox", "read"),
    canWriteInbox = hasGrant(session, "inbox", "write");
  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [route]);
  useLayoutEffect(() => {
    const measure = () => {
      const v = window.visualViewport;
      const inset =
        v && v.scale === 1
          ? Math.max(0, innerHeight - v.height - v.offsetTop)
          : 0;
      root.current?.style.setProperty("--keyboard-inset", `${inset}px`);
      root.current?.setAttribute(
        "data-keyboard",
        inset > 100 ? "true" : "false",
      );
      root.current?.style.setProperty(
        "--dock-height",
        `${dock.current?.offsetHeight || 100}px`,
      );
    };
    const observer = new ResizeObserver(measure);
    if (dock.current) observer.observe(dock.current);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const active = navigation.find((n) => n.path === route)?.name;
  const title =
    active ||
    (route === "/settings"
      ? "Настройки"
      : route === "/settings/owner"
        ? "Управление Qubite"
        : route.startsWith("/modules/")
          ? "Модуль"
          : "Страница не найдена");
  const grantedModules = modules.filter((m) =>
    demo ? hasGrant(session, m.id, "read") : (m as Card).status !== "locked",
  );
  function capture() {
    if (!demo || !canWriteInbox || !draft.trim()) return;
    if (!canReadInbox) {
      setNotice("Для просмотра входящих требуется отдельное разрешение.");
      return;
    }
    setNotes((previous) => [
      { id: Date.now(), text: draft.trim().slice(0, 4000) },
      ...previous,
    ]);
    setDraft("");
    setNotice("Добавлено в демо-входящие. Данные исчезнут после перезагрузки.");
  }
  const denied = (
    <Empty
      icon="lock"
      title="Здесь пока нет доступа"
      text="Доступ к этому разделу выдаёт владелец. Профиль и настройки аккаунта остаются доступны."
    />
  );
  const moduleView = () => {
    const id = route.slice("/modules/".length),
      state = stateOf(id);
    if (state === "missing")
      return (
        <Empty
          title="Страница не найдена"
          text="Вернись в каталог, чтобы посмотреть доступные разделы."
        />
      );
    if (state === "denied") return denied;
    const m = modules.find((m) => m.id === id)!;
    return (
      <Empty
        icon={m.icon}
        title={
          state === "unavailable"
            ? `${m.name} — временно недоступен`
            : `${m.name} — скоро в твоём пространстве`
        }
        text={
          state === "unavailable"
            ? "Доступ у тебя есть. Модуль временно выключен; данные не открываются."
            : "Доступ выдан. Сам модуль ещё готовится и пока не открывает твои данные."
        }
      >
        <LivingButton
          className="button blue"
          onClick={() => navigate("/modules")}
        >
          К модулям <Icon name="arrow" />
        </LivingButton>
      </Empty>
    );
  };
  const page = () => {
    if (
      !demo &&
      (route === "/modules" || route.startsWith("/modules/")) &&
      liveCatalog.state !== "ready"
    )
      return (
        <Empty
          icon="grid"
          title={
            liveCatalog.state === "loading"
              ? "Загружаем каталог"
              : "Не удалось загрузить каталог"
          }
          text="Проверяем доступные тебе модули."
        >
          {liveCatalog.state === "unavailable" && (
            <LivingButton className="button blue" onClick={liveCatalog.reload}>
              Обновить каталог
            </LivingButton>
          )}
        </Empty>
      );

    if (route === "/")
      return (
        <>
          <section className="today-hero">
            <div className="hero-copy">
              <span className="eyebrow">
                <i />
                ТВОЙ ДЕНЬ, ТВОЙ РИТМ
              </span>
              <h2>
                Меньше шума.
                <br />
                Больше своего.
              </h2>
              <p>
                Мысли, планы и проекты — в одном пространстве.
                <br className="desktop-break" /> Можно двигаться маленькими
                шагами.
              </p>
              <LivingButton
                className="button orange"
                onClick={() => navigate("/modules")}
              >
                Посмотреть модули <Icon name="arrow" size={18} />
              </LivingButton>
            </div>
            <div className="assembly" aria-hidden="true">
              <div className="assembly-orbit" />
              <div className="piece piece-blue">
                <Icon name="layers" size={42} />
              </div>
              <div className="piece piece-yellow">
                <Icon name="spark" size={46} />
              </div>
              <div className="piece piece-orange">
                <Brand />
              </div>
              <div className="assembly-caption">ВСЁ НА СВОЁМ МЕСТЕ</div>
            </div>
          </section>
          <div className="section-heading">
            <h2>Под рукой</h2>
            <LivingLink href="#/modules">
              Все модули <Icon name="arrow" size={17} />
            </LivingLink>
          </div>
          {!demo && liveCatalog.state !== "ready" ? (
            <Empty
              icon="grid"
              title={
                liveCatalog.state === "loading"
                  ? "Загружаем каталог"
                  : "Не удалось загрузить каталог"
              }
              text="Проверяем доступные тебе модули."
            >
              {liveCatalog.state === "unavailable" && (
                <LivingButton
                  className="button blue"
                  onClick={liveCatalog.reload}
                >
                  Обновить каталог
                </LivingButton>
              )}
            </Empty>
          ) : grantedModules.length ? (
            <div className="quick-grid">
              {grantedModules.slice(0, 3).map((m) => (
                <LivingLink
                  href={`#/modules/${m.id}`}
                  className={`quick-card ${m.tone}`}
                  key={m.id}
                >
                  <span className="card-symbol">
                    <Mark service={m.id} />
                  </span>
                  <span>
                    <strong>{m.name}</strong>
                    <small>
                      {demo
                        ? m.id === "planner"
                          ? "Временно недоступен"
                          : "Модуль готовится"
                        : statusText((m as Card).status)}
                    </small>
                  </span>
                  <Icon name="arrow" size={18} />
                </LivingLink>
              ))}
            </div>
          ) : (
            <div className="plain-card welcome">
              <Icon name="grid" />
              <div>
                <h3>Пока только твой аккаунт</h3>
                <p>Когда владелец выдаст доступ, здесь появятся твои модули.</p>
              </div>
              <LivingLink href="#/profile">
                К профилю <Icon name="arrow" size={18} />
              </LivingLink>
            </div>
          )}
          <div className="home-columns">
            <section className="plain-card incoming">
              <div className="section-heading">
                <h2>Входящие</h2>
                {canReadInbox && (
                  <LivingLink href="#/inbox">
                    Открыть <Icon name="arrow" size={17} />
                  </LivingLink>
                )}
              </div>
              {canReadInbox ? (
                notes.length ? (
                  <div className="note-preview">
                    <span className="note-icon yellow">
                      <Icon name="document" />
                    </span>
                    <div>
                      <strong>{notes[0].text}</strong>
                      <small>Только в этой демонстрации</small>
                    </div>
                  </div>
                ) : (
                  <div className="calm-empty">
                    <span className="stamp">
                      <Icon name="inbox" size={28} />
                    </span>
                    <h3>Ничего не потеряется</h3>
                    <p>
                      {demo
                        ? "Скинь мысль в панель внизу. В примере она появится здесь."
                        : "Когда входящие будут подключены, новые материалы появятся здесь."}
                    </p>
                  </div>
                )
              ) : (
                <div className="calm-empty">
                  <Icon name="lock" />
                  <h3>Пока закрыто</h3>
                  <p>Входящие появятся после выдачи доступа.</p>
                </div>
              )}
            </section>
            <section className="rhythm-card">
              <div>
                <span className="eyebrow">МАЛЕНЬКИЙ ШАГ</span>
                <h2>
                  Не обязательно
                  <br />
                  всё сразу.
                </h2>
                <p>
                  Одной мысли достаточно,
                  <br />
                  чтобы начать.
                </p>
              </div>
              <div className="rhythm-lines" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </div>
            </section>
          </div>
        </>
      );
    if (route === "/modules") {
      const visible = modules.filter((m) => stateOf(m.id) !== "missing");
      return (
        <>
          <p className="page-intro">
            Каждая часть — для своего дела. Доступ к модулям выдаётся отдельно.
          </p>
          {visible.length ? (
            <div className="module-grid">
              {visible.map((m) => {
                const locked = demo
                  ? !hasGrant(session, m.id, "read")
                  : (m as Card).status === "locked";
                return (
                  <LivingLink
                    className={`module-card ${m.tone}`}
                    href={`#/modules/${m.id}`}
                    key={m.id}
                  >
                    <div className="module-card-top">
                      <span className="card-symbol">
                        <Mark service={m.id} />
                      </span>
                      <span className="module-status">
                        <Icon name={locked ? "lock" : "orbit"} size={14} />
                        {demo
                          ? locked
                            ? "Нет доступа"
                            : m.id === "planner"
                              ? "Временно недоступен"
                              : "Готовится"
                          : statusText((m as Card).status)}
                      </span>
                    </div>
                    <span className="eyebrow">{m.label}</span>
                    <h2>{m.name}</h2>
                    <p>{m.summary}</p>
                    <span className="text-link">
                      {locked ? "О доступе" : "Подробнее"}
                      <Icon name="arrow" size={18} />
                    </span>
                  </LivingLink>
                );
              })}
            </div>
          ) : (
            <Empty
              icon="grid"
              title="Модули ещё не добавлены"
              text="Пока доступны твой профиль и настройки. Разрешённые модули появятся здесь."
            />
          )}
        </>
      );
    }
    if (route.startsWith("/modules/")) return moduleView();
    if (route === "/inbox")
      return canReadInbox ? (
        <>
          <p className="page-intro">
            Сначала сохранить мысль. Разобрать — когда удобно.
          </p>
          {demo && (
            <p className="inline-note">
              Пример входящих: записи живут только до перезагрузки, без отправки
              серверу.
            </p>
          )}
          {notes.length ? (
            <div className="notes-list">
              {notes.map((n) => (
                <article className="plain-card note" key={n.id}>
                  <span className="note-icon yellow">
                    <Icon name="document" />
                  </span>
                  <div>
                    <span className="eyebrow">НОВАЯ МЫСЛЬ</span>
                    <p>{n.text}</p>
                    <small>Демо • ещё не разобрано</small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty
              icon="inbox"
              title="Здесь можно выдохнуть"
              text={
                demo
                  ? "Скинь текст в Qubite Command. Он появится в этом примере входящих."
                  : "Входящие пока не подключены. Данные с других устройств здесь ещё не загружаются."
              }
            />
          )}
        </>
      ) : (
        denied
      );
    if (route === "/profile")
      return (
        <div className="profile-layout">
          <section className="plain-card profile-card">
            <span className="avatar large">
              {session.profile.display_name?.[0] || "Q"}
            </span>
            <h2>{session.profile.display_name || "Твой аккаунт"}</h2>
            <p>{session.profile.email}</p>
            <span className="status-chip">
              <Icon name="user" size={15} />
              {demo ? "Демонстрационный аккаунт" : "Аккаунт Qubite"}
            </span>
            <LivingLink href="#/settings" className="button blue">
              Настройки <Icon name="settings" size={18} />
            </LivingLink>
          </section>
          <section className="plain-card">
            <span className="eyebrow">ТВОИ РАЗРЕШЕНИЯ</span>
            <h2>Доступ по делу</h2>
            <p className="muted">
              Просмотр, изменение и управление выдаются отдельно.
            </p>
            <ul className="access-list">
              {session.grants
                .filter((g) => hasGrant(session, g.module, g.action))
                .map((g) => (
                  <li key={`${g.module}-${g.action}`}>
                    <span>
                      {modules.find((m) => m.id === g.module)?.name ||
                        (g.module === "inbox"
                          ? "Входящие"
                          : "Отдельный модуль")}
                    </span>
                    <span className="permission-chip">
                      {
                        {
                          read: "Просмотр",
                          write: "Изменение",
                          manage: "Управление",
                          ai: "AI-разрешение",
                        }[g.action]
                      }
                    </span>
                  </li>
                ))}
            </ul>
            {!session.grants.length && (
              <p>На включённые модули разрешений пока нет.</p>
            )}
          </section>
          <Security
            demo={demo}
            onIdentityChange={onIdentityChange || (() => {})}
          />
        </div>
      );
    if (route === "/settings")
      return (
        <div className="settings-stack">
          <section className="plain-card">
            <span className="eyebrow">НА ТВОЙ ВКУС</span>
            <h2>Вид и настроение</h2>
            <LivingSwitch
              label="Тёмная тема"
              checked={prefs.dark}
              onChange={(dark) => setPrefs({ ...prefs, dark })}
            />
            <LivingSwitch
              label="Спокойное движение"
              checked={prefs.quiet}
              onChange={(quiet) => setPrefs({ ...prefs, quiet })}
            />
            <LivingSwitch
              label="Лёгкий рендеринг"
              checked={prefs.lite}
              onChange={(lite) => setPrefs({ ...prefs, lite })}
            />
            <LivingSlider
              label="Податливость интерфейса"
              value={prefs.strength}
              onChange={(strength) => setPrefs({ ...prefs, strength })}
            />
            <LivingSlider
              label="Перетекание выбора"
              value={prefs.duration}
              min={250}
              max={900}
              suffix=" мс"
              onChange={(duration) => setPrefs({ ...prefs, duration })}
            />
            <p className="muted small">
              Выбранный вид сохраняется в этом браузере. Настройка уменьшения
              движения системы тоже учитывается.
            </p>
          </section>
          <section className="plain-card">
            <span className="eyebrow">АККАУНТ</span>
            <LivingLink href="#/profile" className="settings-link">
              <span>
                <Icon name="user" />
                Профиль и мои разрешения
              </span>
              <Icon name="arrow" />
            </LivingLink>
          </section>
          {session.profile.platform_owner && (
            <section className="plain-card owner-entry">
              <span className="eyebrow">ДЛЯ ВЛАДЕЛЬЦА</span>
              <LivingLink href="#/settings/owner" className="settings-link">
                <span>
                  <Icon name="shield" />
                  Управление Qubite
                </span>
                <Icon name="arrow" />
              </LivingLink>
              <p className="muted small">
                Отдельное пространство для настройки платформы.
              </p>
            </section>
          )}
        </div>
      );
    if (route === "/settings/owner") {
      if (!session.profile.platform_owner) return denied;
      return (
        <>
          <p className="page-intro">
            Настрой, что видит пользователь до выдачи доступа.
          </p>
          {demo && setVisibility ? (
            <>
              <div className="inline-note">
                Предпросмотр настройки. Меняет каталог в этом демо; не выдаёт
                разрешений и не сохраняется на сервере.
              </div>
              <OwnerCatalog
                demo
                visibility={visibility}
                onDemoSave={setVisibility}
                onSaved={() => {}}
              />
              <LivingButton
                className="button blue"
                onClick={() => {
                  onPersona?.("new");
                  navigate("/modules");
                }}
              >
                Посмотреть новым пользователем <Icon name="arrow" />
              </LivingButton>
            </>
          ) : (
            <OwnerCatalog onSaved={liveCatalog.reload} />
          )}
        </>
      );
    }
    return (
      <Empty
        title="Страница не найдена"
        text="Открой главную, чтобы продолжить."
      />
    );
  };
  return (
    <MotionContext.Provider value={motion}>
      <div
        className="app-shell qubite-material"
        ref={root}
        data-theme={prefs.dark ? "dark" : "light"}
        data-quiet={stopped}
        data-material="flux"
        data-lite={prefs.lite}
        style={
          {
            "--selection-ms": `${prefs.duration}ms`,
            "--strength": prefs.strength / 100,
          } as React.CSSProperties
        }
      >
        <LivingLink
          className="skip-link"
          href="#main"
          onClick={(e) => {
            e.preventDefault();
            heading.current?.focus();
          }}
        >
          К содержимому
        </LivingLink>
        <aside className="sidebar">
          <LivingLink href="#/" className="brand" aria-label="Qubite — главная">
            <Brand />
            <span>
              Qubite
              <i />
            </span>
          </LivingLink>
          <LivingNavigation
            label="Главная навигация"
            className="main-navigation"
            value={route}
          >
            {navigation.map((n) => (
              <LivingLink
                key={n.path}
                className={route === n.path ? "selected" : ""}
                aria-current={route === n.path ? "page" : undefined}
                href={`#${n.path}`}
              >
                <Icon name={n.icon} />
                <span>{n.name}</span>
                <i />
              </LivingLink>
            ))}
          </LivingNavigation>
          <div className="sidebar-bottom">
            <LivingLink href="#/settings" className="settings-link">
              <span>
                <Icon name="settings" />
                Настройки
              </span>
            </LivingLink>
            <div className="sidebar-caption">
              <span className="colored-dots">
                <i />
                <i />
                <i />
              </span>
              Одно пространство.
              <br />
              Много возможностей.
            </div>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div>
              <span className="context-label">ТВОЁ ПРОСТРАНСТВО</span>
              <span className="greeting">
                Привет, {session.profile.display_name || "друг"}
                <span className="greeting-dot" />
              </span>
            </div>
            <div className="header-actions">
              {demo && (
                <LivingLink className="text-link" href="#/welcome">
                  Лендинг и вход
                </LivingLink>
              )}
              {demo && (
                <LivingButton
                  className="preview-button"
                  onClick={() => setDialog("preview")}
                >
                  <span className="demo-dot" />
                  Демо <span className="demo-button-detail">/ роли</span>
                </LivingButton>
              )}
              <LivingLink
                href="#/profile"
                className="avatar"
                aria-label="Открыть профиль"
              >
                {session.profile.display_name?.[0] || "Q"}
              </LivingLink>
            </div>
          </header>
          <main id="main" className="content">
            <div className="page-heading">
              <div>
                <span className="eyebrow">
                  {route === "/"
                    ? new Intl.DateTimeFormat("ru", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      }).format(new Date())
                    : "QUBITE / ТВОЁ ПРОСТРАНСТВО"}
                </span>
                <h1 ref={heading} tabIndex={-1}>
                  {title}
                </h1>
              </div>
              {route === "/" && (
                <span className="day-marker">
                  <Icon name="sun" size={19} />В своём темпе
                </span>
              )}
            </div>
            <MorphContent
              privateContent={!demo}
              className="page-content"
              identity={
                route +
                (route.startsWith("/modules") && !demo
                  ? ":" + liveCatalog.state + ":" + liveCatalog.catalog.revision
                  : "")
              }
            >
              {page()}
            </MorphContent>
            <footer className="page-footer">
              {demo
                ? "Демо оболочки • данные вымышлены"
                : "Твоё пространство Qubite"}
              <span className="colored-dots">
                <i />
                <i />
                <i />
              </span>
            </footer>
          </main>
        </div>
        <form
          className="command-dock"
          ref={dock}
          aria-label="Qubite Command"
          onSubmit={(e) => {
            e.preventDefault();
            capture();
          }}
        >
          <div className="command-meta">
            <span>
              <Brand />
              <strong>Qubite Command</strong>
              <span className="lite-label">LITE</span>
            </span>
            <small>
              {demo
                ? canWriteInbox
                  ? "Демо / текст во входящие"
                  : "Доступ выдаёт владелец"
                : "Сохранение пока недоступно"}
            </small>
          </div>
          <div className="command-input">
            <label className="sr-only" htmlFor="command">
              Скинь мысль в Qubite Command
            </label>
            <textarea
              id="command"
              rows={1}
              maxLength={4000}
              value={draft}
              disabled={!canWriteInbox}
              placeholder={
                canWriteInbox
                  ? "Мысль, ссылка, план — просто скинь сюда…"
                  : "Входящие пока недоступны"
              }
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  (e.ctrlKey || e.metaKey) &&
                  e.key === "Enter" &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  capture();
                }
              }}
            />
            <LivingButton
              className="icon-button voice-button"
              type="button"
              aria-label="Голосовой ввод"
              disabled={!canWriteInbox}
              onClick={() => setDialog("voice")}
            >
              <Icon name="mic" />
            </LivingButton>
            <LivingButton
              className="send-button"
              type="submit"
              aria-label="Добавить мысль"
              disabled={
                !demo || !canReadInbox || !canWriteInbox || !draft.trim()
              }
            >
              <Icon name="up" />
            </LivingButton>
          </div>
        </form>
        <div
          className={`toast ${notice ? "visible" : ""}`}
          role="status"
          aria-live="polite"
        >
          {notice}
        </div>
        {dialog === "preview" && (
          <Dialog
            title="Посмотреть другими глазами"
            onClose={() => dismissDialog()}
          >
            <p>
              Вымышленные аккаунты для проверки оболочки. Выбор роли доступен
              только в демо-сборке.
            </p>
            <div className="persona-list">
              {(["owner", "member", "new"] as Persona[]).map((p) => (
                <LivingButton
                  className={`persona-choice ${persona === p ? "chosen" : ""}`}
                  key={p}
                  onClick={() => {
                    setDialog(null);
                    onPersona?.(p);
                  }}
                >
                  <span className="note-icon blue">
                    <Icon name={p === "owner" ? "shield" : "user"} />
                  </span>
                  <span>
                    <strong>
                      {
                        {
                          owner: "Владелец",
                          member: "Пользователь",
                          new: "Новый пользователь",
                        }[p]
                      }
                    </strong>
                    <small>
                      {
                        {
                          owner: "Обычная главная + управление в настройках",
                          member:
                            "Документы и входящие по отдельным разрешениям",
                          new: "Только аккаунт, без модулей",
                        }[p]
                      }
                    </small>
                  </span>
                  {persona === p && <Icon name="check" />}
                </LivingButton>
              ))}
            </div>
            <p className="muted small">
              Записи Command в этом примере очищаются при смене аккаунта.
              Настройки видимости остаются в демо до перезагрузки.
            </p>
          </Dialog>
        )}
        {dialog === "voice" && (
          <Dialog title="Голос — тоже мысль" onClose={() => dismissDialog()}>
            <div className="voice-art">
              <Icon name="mic" size={42} />
            </div>
            <p>
              Голосовой ввод пока не подключён. Можно сохранить мысль текстом в
              демонстрации.
            </p>
            <p className="muted small">
              Микрофон не включается, звук не записывается и никуда не
              отправляется.
            </p>
            <LivingButton
              className="button orange"
              onClick={() => dismissDialog()}
            >
              Вернуться к тексту <Icon name="arrow" />
            </LivingButton>
          </Dialog>
        )}
      </div>
    </MotionContext.Provider>
  );
}
