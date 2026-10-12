import { useEffect, useRef, useState } from "react";
import { concepts } from "./concepts";
import { Icon } from "./Icons";
import Nacre from "./pages/Nacre";
import Ferro from "./pages/Ferro";
import Folio from "./pages/Folio";
import Prism from "./pages/Prism";
import Milo from "./pages/Milo";
import { Workspace } from "./Workspace";
import { Auth } from "./Auth";
import { Playground } from "./Playground";
import type { Direction, Mood, View } from "./types";
const pages = {
  nacre: Nacre,
  ferro: Ferro,
  folio: Folio,
  prism: Prism,
  milo: Milo,
};
const views: { id: View; name: string }[] = [
  { id: "landing", name: "Лендинг" },
  { id: "workspace", name: "Интерфейс" },
  { id: "auth", name: "Вход" },
  { id: "material", name: "Материал" },
];
function route() {
  const [id, v] = location.hash.replace("#/", "").split("/");
  return {
    id: concepts.some((c) => c.id === id)
      ? (id as Direction)
      : ("nacre" as Direction),
    view: views.some((x) => x.id === v) ? (v as View) : ("landing" as View),
  };
}
export function App() {
  const [current, setCurrent] = useState(route);
  const [mood, setMood] = useState<Mood>("idle");
  const [event, setEvent] = useState(0);
  const [device, setDevice] = useState("auto");
  const [night, setNight] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [systemQuiet, setSystemQuiet] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const surface = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const c = concepts.find((c) => c.id === current.id)!;
  const Page = pages[c.id];
  const isDark = ["ferro", "prism"].includes(c.id) ? !night : night;
  useEffect(() => {
    document.title = `Qubite · ${c.name} · ${views.find((v) => v.id === current.view)!.name}`;
  }, [c.name, current.view]);
  useEffect(() => {
    const fn = () => {
      setCurrent(route());
      setMood("idle");
    };
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const fn = () => setSystemQuiet(query.matches);
    query.addEventListener("change", fn);
    return () => query.removeEventListener("change", fn);
  }, []);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  function go(id: Direction, view: View) {
    setCurrent({ id, view });
    setMood("idle");
    location.hash = `/${id}/${view}`;
    document.title = `Qubite · ${concepts.find((c) => c.id === id)!.name} · ${views.find((v) => v.id === view)!.name}`;
  }
  function react(next: Mood) {
    setMood(next);
    setEvent((n) => n + 1);
  }
  function pointer(e: React.PointerEvent<HTMLDivElement>) {
    if (quiet || systemQuiet) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(
      -1,
      Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1),
    );
    const y = Math.max(
      -1,
      Math.min(
        1,
        ((e.clientY - rect.top) / Math.min(rect.height, 800)) * 2 - 1,
      ),
    );
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      surface.current?.style.setProperty("--mx", String(x));
      surface.current?.style.setProperty("--my", String(y));
      surface.current?.style.setProperty("--px", `${(x + 1) * 50}%`);
      surface.current?.style.setProperty("--py", `${(y + 1) * 50}%`);
    });
  }
  const props = {
    concept: c,
    mood,
    event,
    react,
    open: (v: View) => go(c.id, v),
  };
  return (
    <div className="lab-shell">
      <a
        className="skip-link"
        href="#concept-stage"
        onClick={(e) => {
          e.preventDefault();
          surface.current?.focus();
        }}
      >
        К концепции
      </a>
      <header className="lab-header">
        <div className="lab-logo">
          <span>q.</span>
          <div>
            QUBITE <i>MATERIAL LAB</i>
          </div>
        </div>
        <p>
          Пять характеров.
          <br />
          <span>Найди свой.</span>
        </p>
        <span className="lab-tag">Исследование дизайна · 01</span>
      </header>
      <nav className="direction-rail" aria-label="Пять дизайн-концепций">
        {concepts.map((x) => (
          <button
            className={c.id === x.id ? "selected" : ""}
            style={{ "--swatch": x.palette[2] } as React.CSSProperties}
            key={x.id}
            aria-pressed={c.id === x.id}
            onClick={() => go(x.id, current.view)}
          >
            <span
              className={`direction-mark mark-${x.id}`}
              style={{ background: x.palette[0], color: x.palette[2] }}
            >
              {x.number}
            </span>
            <span>
              <strong>{x.name}</strong>
              <small>{x.russian}</small>
            </span>
            <span className="direction-arrow">↗</span>
          </button>
        ))}
      </nav>
      <div className="lab-controls">
        <div className="view-tabs" role="group" aria-label="Экран концепции">
          {views.map((v) => (
            <button
              key={v.id}
              aria-pressed={current.view === v.id}
              onClick={() => go(c.id, v.id)}
            >
              {v.name}
            </button>
          ))}
        </div>
        <div className="preview-controls">
          <div className="devices" role="group" aria-label="Размер макета">
            {[
              { id: "auto", icon: "desktop", label: "Автоматическая ширина" },
              { id: "tablet", icon: "tablet", label: "Планшет" },
              { id: "phone", icon: "phone", label: "Телефон" },
              {
                id: "landscape",
                icon: "phone",
                label: "Телефон горизонтально",
              },
            ].map((d) => (
              <button
                key={d.id}
                className={d.id === "landscape" ? "landscape-icon" : ""}
                aria-label={d.label}
                aria-pressed={device === d.id}
                onClick={() => setDevice(d.id)}
              >
                <Icon name={d.icon} size={17} />
              </button>
            ))}
          </div>
          <button
            className="control-icon"
            aria-label={isDark ? "Светлый режим" : "Тёмный режим"}
            aria-pressed={isDark}
            onClick={() => setNight(!night)}
          >
            <Icon name={isDark ? "moon" : "sun"} size={17} />
          </button>
          <button
            className="control-icon"
            aria-label="Спокойный режим"
            aria-pressed={quiet || systemQuiet}
            disabled={systemQuiet}
            title={
              systemQuiet
                ? "Системное уменьшение движения включено"
                : "Остановить анимации"
            }
            onClick={() => setQuiet(!quiet)}
          >
            <Icon name={quiet || systemQuiet ? "play" : "pause"} size={17} />
          </button>
        </div>
      </div>
      <div className={`preview-frame preview-${device}`}>
        <div
          id="concept-stage"
          tabIndex={-1}
          className={`concept concept-${c.id} ${night ? "night" : ""} ${quiet || systemQuiet ? "quiet" : ""}`}
          ref={surface}
          data-mood={mood}
          data-event={event % 2}
          onPointerMove={pointer}
          onPointerDown={() => react("capture")}
          onPointerLeave={() => {
            if (frame.current !== null) cancelAnimationFrame(frame.current);
            surface.current?.style.setProperty("--mx", "0");
            surface.current?.style.setProperty("--my", "0");
          }}
          key={c.id}
        >
          {current.view === "landing" ? (
            <Page {...props} />
          ) : current.view === "workspace" ? (
            <Workspace {...props} />
          ) : current.view === "auth" ? (
            <Auth {...props} />
          ) : (
            <Playground {...props} />
          )}
        </div>
      </div>
      <footer className="lab-footer">
        <span>
          <b>
            {c.number} / {c.name}
          </b>{" "}
          {c.detail}
        </span>
        <a href={`#/${c.id}/material`} onClick={() => go(c.id, "material")}>
          Цвета, шрифты и реакции ↗
        </a>
      </footer>
    </div>
  );
}
