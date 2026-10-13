import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  modules,
  demoVisibility,
  liveVisibility,
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
type Preferences = { quiet: boolean; dark: boolean };
function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem("qubite.ui.v1") || "null");
    return { quiet: value?.quiet === true, dark: value?.dark === true };
  } catch {
    return { quiet: false, dark: false };
  }
}

export function App() {
  // Build-time branch: no demo actor can be selected in the live artifact.
  return __QUBITE_DEMO__ ? <Demo /> : <Runtime />;
}
function Runtime() {
  const { identity, refresh } = useIdentity();
  if (identity.status === "authenticated")
    return <Shell session={identity.session} demo={false} />;
  const loading = identity.status === "loading";
  return (
    <div className="entry-screen">
      <div className="brand">
        <Brand />
        <span>Qubite</span>
      </div>
      <main>
        <Empty
          title={
            loading
              ? "Открываем твоё пространство"
              : identity.status === "anonymous"
                ? "Начнём с твоего аккаунта"
                : "Не удалось открыть пространство"
          }
          text={
            loading
              ? "Проверяем подключение и доступ."
              : identity.status === "anonymous"
                ? "Войди, чтобы открыть профиль и доступные тебе модули."
                : "Подключение недоступно. Попробуй ещё раз, когда связь восстановится."
          }
          icon={loading ? "orbit" : "lock"}
        >
          {!loading && (
            <button className="button orange" onClick={refresh}>
              Проверить снова <Icon name="arrow" />
            </button>
          )}
        </Empty>
        {!loading && (
          <p className="release-note">
            Экран входа появится в следующем этапе. Аккаунт проверяется через
            единый API Qubite.
          </p>
        )}
      </main>
    </div>
  );
}
function Demo() {
  const [persona, setPersona] = useState<Persona>("owner"),
    [visibility, setVisibility] = useState(demoVisibility);
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
  visibility = liveVisibility(),
  setVisibility,
  persona,
  onPersona,
}: {
  session: Session;
  demo: boolean;
  visibility?: VisibilityMap;
  setVisibility?: (v: VisibilityMap) => void;
  persona?: Persona;
  onPersona?: (v: Persona) => void;
}) {
  const [route, setRoute] = useState(readRoute),
    [dialog, setDialog] = useState<"preview" | "voice" | null>(null);
  const [notes, setNotes] = useState<Note[]>([]),
    [draft, setDraft] = useState("");
  const [notice, setNotice] = useState(""),
    [prefs, setPrefs] = useState(readPreferences);
  const root = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    dock = useRef<HTMLFormElement>(null),
    initial = useRef(true);
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
  useEffect(() => {
    try {
      localStorage.setItem("qubite.ui.v1", JSON.stringify(prefs));
    } catch {
      /* Browser may disallow preference storage. */
    }
  }, [prefs]);
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
  const grantedModules = modules.filter((m) => hasGrant(session, m.id, "read"));
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
      state = moduleState(session, id, visibility);
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
        title={`${m.name} — скоро в твоём пространстве`}
        text="Доступ выдан. Сам модуль ещё готовится и пока не открывает твои данные."
      >
        <button className="button blue" onClick={() => navigate("/modules")}>
          К модулям <Icon name="arrow" />
        </button>
      </Empty>
    );
  };
  const page = () => {
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
              <a className="text-link" href="#/modules">
                Посмотреть модули <Icon name="arrow" size={18} />
              </a>
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
            <a href="#/modules">
              Все модули <Icon name="arrow" size={17} />
            </a>
          </div>
          {grantedModules.length ? (
            <div className="quick-grid">
              {grantedModules.slice(0, 3).map((m) => (
                <a
                  href={`#/modules/${m.id}`}
                  className={`quick-card ${m.tone}`}
                  key={m.id}
                >
                  <span className="card-symbol">
                    <Icon name={m.icon} size={25} />
                  </span>
                  <span>
                    <strong>{m.name}</strong>
                    <small>Модуль готовится</small>
                  </span>
                  <Icon name="arrow" size={18} />
                </a>
              ))}
            </div>
          ) : (
            <div className="plain-card welcome">
              <Icon name="grid" />
              <div>
                <h3>Пока только твой аккаунт</h3>
                <p>Когда владелец выдаст доступ, здесь появятся твои модули.</p>
              </div>
              <a href="#/profile">
                К профилю <Icon name="arrow" size={18} />
              </a>
            </div>
          )}
          <div className="home-columns">
            <section className="plain-card incoming">
              <div className="section-heading">
                <h2>Входящие</h2>
                {canReadInbox && (
                  <a href="#/inbox">
                    Открыть <Icon name="arrow" size={17} />
                  </a>
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
      const visible = modules.filter(
        (m) => moduleState(session, m.id, visibility) !== "missing",
      );
      return (
        <>
          <p className="page-intro">
            Каждая часть — для своего дела. Доступ к модулям выдаётся отдельно.
          </p>
          {visible.length ? (
            <div className="module-grid">
              {visible.map((m) => {
                const locked = !hasGrant(session, m.id, "read");
                return (
                  <a
                    className={`module-card ${m.tone}`}
                    href={`#/modules/${m.id}`}
                    key={m.id}
                  >
                    <div className="module-card-top">
                      <span className="card-symbol">
                        <Icon name={m.icon} size={30} />
                      </span>
                      <span className="module-status">
                        <Icon name={locked ? "lock" : "orbit"} size={14} />
                        {locked ? "Нет доступа" : "Готовится"}
                      </span>
                    </div>
                    <span className="eyebrow">{m.label}</span>
                    <h2>{m.name}</h2>
                    <p>{m.summary}</p>
                    <span className="text-link">
                      {locked ? "О доступе" : "Подробнее"}
                      <Icon name="arrow" size={18} />
                    </span>
                  </a>
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
            <a href="#/settings" className="button blue">
              Настройки <Icon name="settings" size={18} />
            </a>
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
            {!session.grants.length && <p>Разрешений на модули пока нет.</p>}
          </section>
        </div>
      );
    if (route === "/settings")
      return (
        <div className="settings-stack">
          <section className="plain-card">
            <span className="eyebrow">НА ТВОЙ ВКУС</span>
            <h2>Вид и настроение</h2>
            <div className="setting-row">
              <label htmlFor="dark">
                <Icon name="sun" />
                Тёмная тема
              </label>
              <input
                id="dark"
                type="checkbox"
                role="switch"
                checked={prefs.dark}
                onChange={(e) => setPrefs({ ...prefs, dark: e.target.checked })}
              />
            </div>
            <div className="setting-row">
              <label htmlFor="quiet">
                <Icon name="orbit" />
                Спокойное движение
              </label>
              <input
                id="quiet"
                type="checkbox"
                role="switch"
                checked={prefs.quiet}
                onChange={(e) =>
                  setPrefs({ ...prefs, quiet: e.target.checked })
                }
              />
            </div>
            <p className="muted small">
              Выбранный вид сохраняется в этом браузере. Настройка уменьшения
              движения системы тоже учитывается.
            </p>
          </section>
          <section className="plain-card">
            <span className="eyebrow">АККАУНТ</span>
            <a href="#/profile" className="settings-link">
              <span>
                <Icon name="user" />
                Профиль и мои разрешения
              </span>
              <Icon name="arrow" />
            </a>
          </section>
          {session.profile.platform_owner && (
            <section className="plain-card owner-entry">
              <span className="eyebrow">ДЛЯ ВЛАДЕЛЬЦА</span>
              <a href="#/settings/owner" className="settings-link">
                <span>
                  <Icon name="shield" />
                  Управление Qubite
                </span>
                <Icon name="arrow" />
              </a>
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
              <section className="plain-card visibility-card">
                <div className="visibility-heading">
                  <h2>Видимость модулей</h2>
                  <span className="status-chip">Без доступа</span>
                </div>
                {modules.map((m) => (
                  <div className="visibility-row" key={m.id}>
                    <span className={`note-icon ${m.tone}`}>
                      <Icon name={m.icon} />
                    </span>
                    <label htmlFor={`visibility-${m.id}`}>
                      <strong>{m.name}</strong>
                      <small>{m.label}</small>
                    </label>
                    <select
                      id={`visibility-${m.id}`}
                      value={visibility[m.id]}
                      onChange={(e) =>
                        setVisibility({
                          ...visibility,
                          [m.id]: e.target.value as "hidden" | "locked",
                        })
                      }
                    >
                      <option value="hidden">Скрывать</option>
                      <option value="locked">Показывать с замком</option>
                    </select>
                  </div>
                ))}
              </section>
              <button
                className="button blue"
                onClick={() => {
                  onPersona?.("new");
                  navigate("/modules");
                }}
              >
                Посмотреть новым пользователем <Icon name="arrow" />
              </button>
            </>
          ) : (
            <Empty
              icon="settings"
              title="Настройка каталога готовится"
              text="Переключатели видимости появятся после подключения серверных настроек. Показ или скрытие модуля не выдаёт доступ к нему."
            />
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
    <div
      className="app-shell"
      ref={root}
      data-theme={prefs.dark ? "dark" : "light"}
      data-quiet={prefs.quiet}
    >
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          heading.current?.focus();
        }}
      >
        К содержимому
      </a>
      <aside className="sidebar">
        <a href="#/" className="brand" aria-label="Qubite — главная">
          <Brand />
          <span>
            Qubite
            <i />
          </span>
        </a>
        <nav aria-label="Главная навигация" className="main-navigation">
          {navigation.map((n) => (
            <a
              key={n.path}
              className={route === n.path ? "selected" : ""}
              aria-current={route === n.path ? "page" : undefined}
              href={`#${n.path}`}
            >
              <Icon name={n.icon} />
              <span>{n.name}</span>
              <i />
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <a href="#/settings" className="settings-link">
            <span>
              <Icon name="settings" />
              Настройки
            </span>
          </a>
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
              <button
                className="preview-button"
                onClick={() => setDialog("preview")}
              >
                <span className="demo-dot" />
                Демо <span className="demo-button-detail">/ роли</span>
              </button>
            )}
            <a href="#/profile" className="avatar" aria-label="Открыть профиль">
              {session.profile.display_name?.[0] || "Q"}
            </a>
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
          <div className="page-content" key={route}>
            {page()}
          </div>
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
          <button
            className="icon-button voice-button"
            type="button"
            aria-label="Голосовой ввод"
            disabled={!canWriteInbox}
            onClick={() => setDialog("voice")}
          >
            <Icon name="mic" />
          </button>
          <button
            className="send-button"
            type="submit"
            aria-label="Добавить мысль"
            disabled={!demo || !canReadInbox || !canWriteInbox || !draft.trim()}
          >
            <Icon name="up" />
          </button>
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
          onClose={() => setDialog(null)}
        >
          <p>
            Вымышленные аккаунты для проверки оболочки. Выбор роли доступен
            только в демо-сборке.
          </p>
          <div className="persona-list">
            {(["owner", "member", "new"] as Persona[]).map((p) => (
              <button
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
                        member: "Документы и входящие по отдельным разрешениям",
                        new: "Только аккаунт, без модулей",
                      }[p]
                    }
                  </small>
                </span>
                {persona === p && <Icon name="check" />}
              </button>
            ))}
          </div>
          <p className="muted small">
            Записи Command в этом примере очищаются при смене аккаунта.
            Настройки видимости остаются в демо до перезагрузки.
          </p>
        </Dialog>
      )}
      {dialog === "voice" && (
        <Dialog title="Голос — тоже мысль" onClose={() => setDialog(null)}>
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
          <button className="button orange" onClick={() => setDialog(null)}>
            Вернуться к тексту <Icon name="arrow" />
          </button>
        </Dialog>
      )}
    </div>
  );
}
