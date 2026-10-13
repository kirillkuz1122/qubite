import { MorphContent } from "./milo/Transition";
import { LivingButton, LivingNavigation } from "./milo/Controls";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import { Material } from "./Materials";
import type { PageProps, Section } from "./types";
const sections: { id: Section; name: string; icon: string }[] = [
  { id: "today", name: "Сегодня", icon: "today" },
  { id: "docs", name: "Документы", icon: "docs" },
  { id: "search", name: "Поиск", icon: "search" },
  { id: "writing", name: "Writer", icon: "writing" },
  { id: "vpn", name: "VPN", icon: "vpn" },
  { id: "modules", name: "Модули", icon: "modules" },
];
const initialTasks = [
  { id: 1, text: "Собрать идеи для нового проекта", time: "09:30", done: true },
  { id: 2, text: "Дописать заметку о внимании", time: "11:00", done: false },
  {
    id: 3,
    text: "Оставить время для чего-то нового",
    time: "16:00",
    done: false,
  },
];
export function Workspace(p: PageProps) {
  const [section, setSection] = useState<Section>("today");
  const [owner, setOwner] = useState(true);
  const [tasks, setTasks] = useState(initialTasks);
  const [capture, setCapture] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [toast, setToast] = useState("");
  const [undo, setUndo] = useState<(() => void) | null>(null);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [vpn, setVpn] = useState(false);
  const [writing, setWriting] = useState(
    "Вообщем, хорошая идея начинается с внимания. Мне нравиться замечать то, что обычно остаётся за кадром.",
  );
  const [checked, setChecked] = useState(false);
  const [grant, setGrant] = useState(false);
  const [doc, setDoc] = useState("Мысли о внимании");
  const captureRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSection("search");
        respond("search");
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [p.react]);
  function respond(mood: import("./types").Mood) {
    p.react(mood, section);
  }
  function change(next: Section) {
    setSection(next);
    respond(
      next === "search"
        ? "search"
        : next === "vpn" && vpn
          ? "connect"
          : "focus",
    );
    setToast("");
    setUndo(null);
  }
  function notify(text: string, action?: () => void) {
    setToast(text);
    setUndo(action ? () => action : null);
  }
  function save() {
    if (!capture.trim()) {
      respond("error");
      notify("Сначала добавь мысль.");
      captureRef.current?.focus();
      return;
    }
    const value = capture.trim();
    setNotes((n) => [value, ...n]);
    setCapture("");
    respond("success");
    notify("Заметка добавлена в макет.", () => {
      setNotes((n) => n.filter((_, i) => i !== 0));
      setCapture(value);
      respond("idle");
    });
  }
  function taskToggle(id: number) {
    setTasks((ts) =>
      ts.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    );
    respond("success");
  }
  const title =
    sections.find((x) => x.id === section)?.name ||
    (section === "console" ? "Управление Qubite" : "Настройки");
  const done = tasks.filter((t) => t.done).length;
  return (
    <div className="workspace">
      <aside className="sidebar">
        <LivingButton className="wordmark" onClick={() => p.open("landing")}>
          <span className="brand-symbol">q</span>qubite
        </LivingButton>
        <div className="space-label">
          <span className="avatar">Я</span>
          <span>
            Личное пространство<small>Только твоё</small>
          </span>
        </div>
        <LivingNavigation value={section} label="Разделы рабочего пространства">
          {sections.map((s) => (
            <LivingButton
              className={section === s.id ? "active" : ""}
              aria-current={section === s.id ? "page" : undefined}
              aria-label={s.name}
              key={s.id}
              onClick={() => change(s.id)}
            >
              <Icon name={s.icon} />
              <span>{s.name}</span>
              {s.id === "today" && <i>3</i>}
            </LivingButton>
          ))}
        </LivingNavigation>
        <div className="sidebar-bottom">
          <div className="private-label">
            <Icon name="lock" size={14} /> Свои мысли. Свои границы.
          </div>
          <LivingButton
            className={`sidebar-settings ${section === "settings" || section === "console" ? "active" : ""}`}
            aria-label="Настройки"
            onClick={() => change("settings")}
          >
            <Icon name="settings" />
            <span>Настройки</span>
          </LivingButton>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="workspace-header">
          <span className="breadcrumb">
            Личное <span>/</span> {title}
          </span>
          <LivingButton
            className="command-button"
            aria-label="Найти в пространстве"
            onClick={() => change("search")}
          >
            <Icon name="search" size={17} />
            <span>Найти в пространстве</span>
            <kbd>⌘ K</kbd>
          </LivingButton>
          <LivingButton
            className="avatar avatar-button"
            onClick={() => change("settings")}
            aria-label="Открыть настройки профиля"
          >
            Я
          </LivingButton>
        </header>
        <MorphContent className="workspace-content" identity={section}>
          {section === "today" && (
            <>
              <section className="greeting">
                <div>
                  <span className="eyebrow">
                    ПОНЕДЕЛЬНИК, 12 ОКТЯБРЯ · ДЕМО
                  </span>
                  <h1>
                    Хороший день
                    <br />
                    <span>для твоих идей.</span>
                  </h1>
                  <p>Три небольших шага. Одна большая картина.</p>
                </div>
                <div className="greeting-material">
                  <Material
                    direction={p.concept.id}
                    mood={p.mood}
                    event={p.event}
                    small
                  />
                </div>
              </section>
              <div className="dashboard-grid">
                <section className="panel capture-panel">
                  <div className="panel-heading">
                    <span className="panel-label">
                      <Icon name="spark" size={18} /> Быстрая мысль
                    </span>
                    <span className="mini-label">Без лишних выборов</span>
                  </div>
                  <textarea
                    ref={captureRef}
                    value={capture}
                    placeholder="Что у тебя сейчас в голове?"
                    onChange={(e) => {
                      setCapture(e.target.value);
                      respond("capture");
                    }}
                    onFocus={() => respond("focus")}
                    aria-label="Быстрая заметка"
                  />
                  <div className="capture-bottom">
                    <LivingButton
                      className="icon-button"
                      aria-label="Попробовать голосовую заметку"
                      onClick={() => {
                        respond("capture");
                        notify(
                          "В будущем здесь будет голосовой ввод. Микрофон в демо не включается.",
                        );
                      }}
                    >
                      <Icon name="mic" />
                    </LivingButton>
                    <span>Останется только в этой сессии</span>
                    <LivingButton className="primary compact" onClick={save}>
                      Сохранить <Icon name="arrow" size={17} />
                    </LivingButton>
                  </div>
                </section>
                <section className="panel tasks-panel">
                  <div className="panel-heading">
                    <span className="panel-label">Небольшие шаги</span>
                    <span className="task-counter">{done} / 3</span>
                  </div>
                  <div className="progress-track">
                    <span style={{ width: `${(done / 3) * 100}%` }} />
                  </div>
                  <div className="task-list">
                    {tasks.map((t) => (
                      <label
                        key={t.id}
                        className={`task-row ${t.done ? "is-done" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={t.done}
                          onChange={() => taskToggle(t.id)}
                        />
                        <span className="task-check">
                          <Icon name="check" size={13} />
                        </span>
                        <span>{t.text}</span>
                        <time>{t.time}</time>
                      </label>
                    ))}
                  </div>
                </section>
                <section className="panel recent-panel">
                  <div className="panel-heading">
                    <span className="panel-label">Рядом с тобой</span>
                    <LivingButton
                      className="text-action"
                      onClick={() => change("docs")}
                    >
                      Все документы <Icon name="arrow" size={15} />
                    </LivingButton>
                  </div>
                  <div className="document-grid">
                    {[
                      "Мысли о внимании",
                      "Пространство для идей",
                      "Карта следующего проекта",
                    ].map((name, i) => (
                      <LivingButton
                        className="document-card"
                        key={name}
                        onClick={() => {
                          setDoc(name);
                          change("docs");
                        }}
                      >
                        <div className={`doc-art doc-art-${i}`}>
                          <span>{["Aa", "↗", "✳"][i]}</span>
                          <i />
                          <i />
                        </div>
                        <strong>{name}</strong>
                        <small>
                          {
                            [
                              "Заметка · сегодня",
                              "Коллекция · вчера",
                              "Проект · 2 дня назад",
                            ][i]
                          }
                        </small>
                      </LivingButton>
                    ))}
                  </div>
                  {notes.length > 0 && (
                    <div className="captured-notes" aria-live="polite">
                      {notes.map((n, i) => (
                        <p key={i}>
                          <Icon name="docs" size={16} />
                          <span>{n}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </section>
                <section className="panel focus-panel">
                  <span className="eyebrow">ВРЕМЯ ДЛЯ СЕБЯ</span>
                  <div className="focus-clock">
                    25<span>:00</span>
                  </div>
                  <p>
                    Одна задача.
                    <br />
                    Чуть больше внимания.
                  </p>
                  <LivingButton
                    className="secondary"
                    onClick={() => {
                      respond("focus");
                      notify(
                        "Фокус выбран. Таймер в этом макете демонстрационный.",
                      );
                    }}
                  >
                    Настроить фокус <Icon name="arrow" size={16} />
                  </LivingButton>
                </section>
              </div>
            </>
          )}
          {section === "docs" && (
            <section className="section-page">
              <span className="eyebrow">ДОКУМЕНТЫ / ЛИЧНОЕ</span>
              <h1>{doc}</h1>
              <p className="muted">Тихое место для длинной мысли.</p>
              <div className="document-editor panel">
                <div className="editor-toolbar">
                  <span>Текстовый документ</span>
                  <LivingButton
                    className="text-action"
                    onClick={() => {
                      respond("success");
                      notify("Правка остаётся в этой сессии макета.");
                    }}
                  >
                    Сохранить <Icon name="check" size={16} />
                  </LivingButton>
                </div>
                <textarea
                  aria-label="Текст документа"
                  defaultValue={
                    "Самые важные идеи часто появляются между делами.\n\nМне хочется замечать их, оставлять место для размышлений и возвращаться к тому, что действительно имеет смысл.\n\nНе больше информации — больше связей."
                  }
                  onChange={() => respond("capture")}
                  onFocus={() => respond("focus")}
                />
                <div className="editor-meta">
                  <Icon name="lock" size={15} /> Личный документ ·
                  демонстрационный текст
                </div>
              </div>
              {notes.length > 0 && (
                <div className="captured-notes">
                  {notes.map((n, i) => (
                    <p key={i}>{n}</p>
                  ))}
                </div>
              )}
            </section>
          )}
          {section === "search" && (
            <section className="section-page search-page">
              <span className="eyebrow">COMMAND / ИССЛЕДОВАНИЕ</span>
              <h1>
                Найди следующую
                <br />
                хорошую связь.
              </h1>
              <form
                className="search-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSearched(true);
                  respond("search");
                }}
              >
                <Icon name="search" />
                <input
                  aria-label="Поисковый запрос"
                  placeholder="О чём хочешь узнать?"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    respond("capture");
                  }}
                />
                <LivingButton className="primary compact">
                  Найти <Icon name="arrow" size={17} />
                </LivingButton>
              </form>
              <p className="demo-note">
                Локальный макет поиска. Никаких внешних запросов.
              </p>
              {searched ? (
                <div className="search-results">
                  <span className="eyebrow">
                    ПРИМЕР ВЫДАЧИ {query && `ДЛЯ «${query}»`}
                  </span>
                  {[
                    "Как идеи превращаются в осмысленные проекты",
                    "Почему внимание важнее количества информации",
                    "Личный граф знаний: маленькое начало",
                  ].map((s, i) => (
                    <LivingButton
                      key={s}
                      className="search-result panel"
                      onClick={() => {
                        setDoc(s);
                        change("docs");
                      }}
                    >
                      <span className="result-source">
                        Личное пространство / документ 0{i + 1}
                      </span>
                      <h3>{s}</h3>
                      <p>
                        Демонстрационный документ. Связанные мысли, источники и
                        следующий шаг.
                      </p>
                      <Icon name="arrow" />
                    </LivingButton>
                  ))}
                </div>
              ) : (
                <div className="search-empty">
                  <Material direction={p.concept.id} mood="search" small />
                  <p>Иногда нужная мысль уже рядом.</p>
                </div>
              )}
            </section>
          )}
          {section === "writing" && (
            <section className="section-page">
              <span className="eyebrow">QUBITE WRITER</span>
              <h1>
                Скажи точнее.
                <br />
                Останься собой.
              </h1>
              <div className="writing-grid">
                <div className="panel writing-editor">
                  <textarea
                    aria-label="Текст Writer"
                    value={writing}
                    onChange={(e) => {
                      setWriting(e.target.value);
                      setChecked(false);
                      respond("capture");
                    }}
                    onFocus={() => respond("focus")}
                  />
                  <div className="writing-actions">
                    <LivingButton
                      className="primary compact"
                      onClick={() => {
                        setChecked(true);
                        respond("search");
                      }}
                    >
                      Проверить текст <Icon name="check" size={16} />
                    </LivingButton>
                    <LivingButton
                      className="secondary compact"
                      onClick={() => {
                        respond("error");
                        notify(
                          "AI не запущен: в демо нет разрешённой модели и бюджета.",
                        );
                      }}
                    >
                      Помочь с AI <Icon name="spark" size={16} />
                    </LivingButton>
                  </div>
                </div>
                <aside className="panel writing-suggestions">
                  <span className="panel-label">Внимание к деталям</span>
                  {checked ? (
                    <>
                      <h3>Предложение правки</h3>
                      <p>
                        <del>Вообщем</del> → <strong>В общем</strong>
                        <br />
                        <del>Мне нравиться</del> → <strong>Мне нравится</strong>
                      </p>
                      <LivingButton
                        className="secondary"
                        onClick={() => {
                          const old = writing;
                          const replacement = old
                            .replace(/Вообщем/g, "В общем")
                            .replace(/Мне нравиться/g, "Мне нравится");
                          setWriting(replacement);
                          setChecked(false);
                          respond("success");
                          notify("Пример правки применён.", () =>
                            setWriting((latest) =>
                              latest === replacement ? old : latest,
                            ),
                          );
                        }}
                      >
                        Применить пример <Icon name="arrow" size={15} />
                      </LivingButton>
                      <small>Это фиксированный пример, не LanguageTool.</small>
                    </>
                  ) : (
                    <>
                      <Icon name="writing" size={35} />
                      <p>
                        Оригинал всегда остаётся твоим. Ни одна правка не
                        применяется без действия.
                      </p>
                    </>
                  )}
                </aside>
              </div>
            </section>
          )}
          {section === "vpn" && (
            <section className="section-page vpn-page">
              <span className="eyebrow">QUBITE VPN / ДЕМОНСТРАЦИЯ</span>
              <h1>
                Твоя связь.
                <br />
                Спокойное ощущение.
              </h1>
              <div className={`vpn-card panel ${vpn ? "connected" : ""}`}>
                <div className="vpn-art">
                  <Material
                    direction={p.concept.id}
                    mood={vpn ? "connect" : "idle"}
                    small
                  />
                </div>
                <div>
                  <span className="eyebrow">
                    {vpn
                      ? "СОСТОЯНИЕ МАКЕТА: ПОДКЛЮЧЕНО"
                      : "СОСТОЯНИЕ МАКЕТА: ОТКЛЮЧЕНО"}
                  </span>
                  <h2>{vpn ? "Контур замкнут." : "Выбери момент."}</h2>
                  <p>
                    Локальный пример ноды · Европа
                    <br />
                    Реальный VPN не запускается.
                  </p>
                  <LivingButton
                    className="primary"
                    onClick={() => {
                      setVpn(!vpn);
                      respond(!vpn ? "connect" : "idle");
                    }}
                  >
                    {vpn ? "Отключить в макете" : "Подключить в макете"}
                    <Icon name="vpn" />
                  </LivingButton>
                </div>
              </div>
            </section>
          )}
          {section === "modules" && (
            <section className="section-page">
              <span className="eyebrow">ТВОИ ИНСТРУМЕНТЫ</span>
              <h1>
                Возможности,
                <br />
                когда они нужны.
              </h1>
              <div className="module-grid">
                {[
                  {
                    name: "Документы",
                    icon: "docs",
                    state: "Доступен",
                    s: "docs",
                  },
                  {
                    name: "Qubite Search",
                    icon: "search",
                    state: "Доступен",
                    s: "search",
                  },
                  {
                    name: "Writer",
                    icon: "writing",
                    state: "Доступен",
                    s: "writing",
                  },
                  { name: "VPN", icon: "vpn", state: "Доступен", s: "vpn" },
                  {
                    name: "Qubite Ink",
                    icon: "writing",
                    state: "Не установлен",
                    s: "",
                  },
                  {
                    name: "Qubite Tournaments",
                    icon: "modules",
                    state: "Доступ не выдан",
                    s: "",
                  },
                ].map((m) => (
                  <LivingButton
                    key={m.name}
                    className="module-card panel"
                    onClick={() => {
                      if (m.s) change(m.s as Section);
                      else {
                        respond("error");
                        notify(
                          `${m.name}: ${m.state.toLowerCase()}. Настройки турниров останутся внутри модуля.`,
                        );
                      }
                    }}
                  >
                    <Icon name={m.icon} size={30} />
                    <h3>{m.name}</h3>
                    <span
                      className={
                        m.s ? "module-state available" : "module-state"
                      }
                    >
                      {m.state}
                    </span>
                    <Icon name={m.s ? "arrow" : "lock"} size={17} />
                  </LivingButton>
                ))}
              </div>
              <p className="demo-note">
                Статусы иллюстративные. Турнирный интерфейс сохраняет
                собственный старый дизайн.
              </p>
            </section>
          )}
          {section === "settings" && (
            <section className="section-page">
              <span className="eyebrow">ТВОЁ ПРОСТРАНСТВО</span>
              <h1>Настройки.</h1>
              <div className="settings-card panel">
                <div>
                  <h3>Профиль в макете</h3>
                  <p>
                    Проверь, что системное управление отделено от обычной
                    главной.
                  </p>
                </div>
                <select
                  aria-label="Роль в макете"
                  value={owner ? "owner" : "member"}
                  onChange={(e) => {
                    setOwner(e.target.value === "owner");
                    respond("focus");
                  }}
                >
                  <option value="owner">Владелец</option>
                  <option value="member">Обычный пользователь</option>
                </select>
              </div>
              <div className="settings-card panel">
                <div>
                  <h3>Приватность</h3>
                  <p>
                    Тексты и пароли этого макета существуют только в памяти
                    вкладки.
                  </p>
                </div>
                <Icon name="lock" size={28} />
              </div>
              {owner && (
                <LivingButton
                  className="settings-card panel console-link"
                  onClick={() => change("console")}
                >
                  <div>
                    <h3>Управление Qubite</h3>
                    <p>
                      Отдельная Owner Console. Пользователи, разрешения и
                      расходы AI.
                    </p>
                  </div>
                  <Icon name="arrow" />
                </LivingButton>
              )}
              <p className="demo-note">
                Выбор роли — только проверка дизайна. Серверная авторизация
                здесь отсутствует.
              </p>
            </section>
          )}
          {section === "console" && owner && (
            <section className="section-page console-page">
              <LivingButton
                className="text-action"
                onClick={() => change("settings")}
              >
                ← К настройкам
              </LivingButton>
              <span className="eyebrow">OWNER CONSOLE / ОТДЕЛЬНЫЙ КОНТУР</span>
              <h1>
                Ясность.
                <br />И немного контроля.
              </h1>
              <div className="console-metrics">
                {[
                  { n: "1", l: "пользователь" },
                  { n: "4", l: "доступных модуля" },
                  { n: "$0.00", l: "реальный расход демо" },
                ].map((x) => (
                  <div className="panel" key={x.l}>
                    <strong>{x.n}</strong>
                    <span>{x.l}</span>
                  </div>
                ))}
              </div>
              <div className="console-grid">
                <div className="panel">
                  <div className="panel-heading">
                    <span className="panel-label">Разрешения AI</span>
                    <Icon name="lock" size={17} />
                  </div>
                  <p>
                    По умолчанию платные действия закрыты, в том числе для
                    владельца.
                  </p>
                  <LivingButton
                    className="secondary"
                    onClick={() => {
                      setGrant(!grant);
                      respond(!grant ? "success" : "private");
                      notify(
                        "Изменён только визуальный пример гранта. Провайдеры не вызываются.",
                      );
                    }}
                  >
                    {grant ? "Отозвать пример гранта" : "Выдать пример гранта"}
                  </LivingButton>
                  <span className="grant-state">
                    {grant
                      ? "Пример: грант выдан, бюджет всё ещё $0.00"
                      : "Пример: доступ не выдан"}
                  </span>
                </div>
                <div className="panel">
                  <div className="panel-heading">
                    <span className="panel-label">Нагрузка · пример</span>
                    <span className="mini-label">Синтетические значения</span>
                  </div>
                  <div
                    className="load-chart"
                    aria-label="Иллюстрация нагрузки сервера"
                  >
                    {[25, 40, 36, 61, 42, 55, 32, 68, 39, 49, 30, 44].map(
                      (h, i) => (
                        <i key={i} style={{ height: `${h}%` }} />
                      ),
                    )}
                  </div>
                  <div className="chart-labels">
                    <span>09:00</span>
                    <span>12:00</span>
                    <span>15:00</span>
                  </div>
                </div>
              </div>
            </section>
          )}
        </MorphContent>
        <footer className="workspace-footer">
          <span>
            <span className="status-dot" /> Интерактивный макет · данные
            вымышлены
          </span>
          <span>
            {p.concept.name} / {p.concept.material}
          </span>
        </footer>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Icon name={p.mood === "error" ? "lock" : "check"} size={18} />
          <span>{toast}</span>
          {undo && (
            <LivingButton
              onClick={() => {
                undo();
                setToast("Действие отменено.");
                setUndo(null);
              }}
            >
              Отменить
            </LivingButton>
          )}
          <LivingButton
            className="icon-button"
            aria-label="Закрыть сообщение"
            onClick={() => setToast("")}
          >
            <Icon name="close" size={16} />
          </LivingButton>
        </div>
      )}
    </div>
  );
}
