import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { MotionContext } from "../milo/motion";
import { profiles } from "../milo/profiles";
import { LivingButton, LivingTabs } from "../milo/Controls";
import { ControlRoom } from "../milo/ControlRoom";
import { MorphContent } from "../milo/Transition";
import { CompanionHint, PetCrew, type PetEvent } from "../milo/Pets";
import { Workspace } from "../Workspace";
import { Auth } from "../Auth";
import { concepts } from "../concepts";
import { Icon } from "../Icons";
import type { Mood, View } from "../types";
import { palettes, fonts, bodyFonts, themeVariables } from "./preferences";
import { Mark, Marks, families, type MarkFamily } from "./Marks";
import { Appearance } from "./Appearance";
import { Atoms } from "./Atoms";
import { ConversationSpecimen } from "./Conversation";
const pages = [
  { id: "components", label: "Материал" },
  { id: "appearance", label: "Образ" },
  { id: "marks", label: "Знаки" },
  { id: "pets", label: "Помощники" },
  { id: "workspace", label: "Пример" },
  { id: "auth", label: "Вход" },
];
const getSection = () => {
  const part = location.hash.split("/")[2];
  return pages.some((p) => p.id === part) ? part : "components";
};
export function FluxStudio() {
  const [section, setSection] = useState(getSection),
    [palette, setPalette] = useState("toy"),
    [heading, setHeading] = useState("unbounded"),
    [body, setBody] = useState("manrope"),
    [family, setFamily] = useState<MarkFamily>("ribbon");
  const [strength, setStrength] = useState(100),
    [duration, setDuration] = useState(503),
    [quiet, setQuiet] = useState(false),
    [hints, setHints] = useState(true),
    [night, setNight] = useState(false);
  const [lite, setLite] = useState(
      () => matchMedia("(pointer: coarse)").matches,
    ),
    [systemQuiet, setSystemQuiet] = useState(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  const [mood, setMood] = useState<Mood>("idle"),
    [event, setEvent] = useState(0),
    [hint, setHint] = useState<PetEvent | null>(null),
    [scope, setScope] = useState("today");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    stage = useRef<HTMLElement>(null);
  const stopped = quiet || systemQuiet || strength === 0;
  const motion = useMemo(
    () => ({
      profile: profiles[1],
      strength: strength / 100,
      quiet: stopped,
      selectionMs: duration,
      lite,
    }),
    [strength, stopped, duration, lite],
  );
  const p = palettes.find((p) => p.id === palette)!;
  const styles = {
    ...themeVariables(p, night),
    "--heading-font": fonts.find((f) => f.id === heading)!.family,
    "--body-font": bodyFonts.find((f) => f.id === body)!.family,
    "--strength": strength / 100,
  } as CSSProperties;
  useEffect(() => {
    const hash = () => {
      setSection(getSection());
      setHint(null);
    };
    const media = matchMedia("(prefers-reduced-motion: reduce)"),
      change = () => setSystemQuiet(media.matches);
    window.addEventListener("hashchange", hash);
    media.addEventListener("change", change);
    return () => {
      window.removeEventListener("hashchange", hash);
      media.removeEventListener("change", change);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    document.title = `Qubite · Поток · ${pages.find((p) => p.id === section)!.label}`;
  }, [section]);
  function go(id: string) {
    setSection(id);
    location.hash = `/flux/${id}`;
    setHint(null);
    setMood("idle");
  }
  function react(m: Mood, s = section) {
    setMood(m);
    setEvent((n) => n + 1);
    if (hints && (m === "success" || m === "error")) {
      setHint(m);
      setScope(s);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setHint(null), 10000);
    }
  }
  const props = {
    concept: concepts[4],
    mood,
    event,
    react,
    open: (v: View) =>
      go(v === "material" ? "components" : v === "landing" ? "components" : v),
  };
  return (
    <MotionContext.Provider value={motion}>
      <div
        className={`milo-lab concept-milo flux-studio ${night ? "night" : ""} ${stopped ? "quiet" : ""}`}
        style={styles}
        data-material="flux"
        data-lite={lite}
        data-palette={palette}
        data-heading={heading}
        data-body={body}
        data-plastic={"treatment" in p ? p.treatment : undefined}
      >
        <a
          className="skip-link"
          href="#flux-stage"
          onClick={(e) => {
            e.preventDefault();
            stage.current?.focus();
          }}
        >
          К интерфейсу
        </a>
        <header className="flux-header">
          <button
            type="button"
            className="flux-brand"
            aria-label="Qubite — материал"
            onClick={() => go("components")}
          >
            <Mark family={family} />
            <span>
              qubite<b>.</b>
              <small>Поток / дизайн-система</small>
            </span>
          </button>
          <div className="flux-header-tools">
            <LivingButton
              className="flux-customize"
              onClick={() => go("appearance")}
            >
              <Icon name="settings" size={17} />
              Настроить
            </LivingButton>
            <LivingButton
              className="lab-theme"
              aria-label={night ? "Светлый режим" : "Тёмный режим"}
              onClick={() => setNight(!night)}
            >
              <Icon name={night ? "moon" : "sun"} size={18} />
            </LivingButton>
          </div>
        </header>
        <div className="flux-intro-line">
          <span>
            <i />
            Непрозрачный. Отзывчивый. Твой.
          </span>
          <span>Исследование 04 · цветной пластик</span>
        </div>
        <nav className="flux-page-nav" aria-label="Разделы дизайн-системы">
          <LivingTabs
            items={pages}
            label="Раздел витрины"
            value={section}
            onChange={go}
          />
        </nav>
        <div className="flux-chosen">
          <LivingButton
            onClick={() => go("appearance")}
            aria-label={`Выбранная палитра: ${p.name}`}
          >
            <i style={{ background: p.colors[0] }} />
            <i style={{ background: p.colors[1] }} />
            <i style={{ background: p.colors[2] }} />
            {p.name}
          </LivingButton>
          <LivingButton onClick={() => go("appearance")}>
            {fonts.find((f) => f.id === heading)!.name} /{" "}
            {bodyFonts.find((f) => f.id === body)!.name}
          </LivingButton>
          <LivingButton onClick={() => go("marks")}>
            {families.find((f) => f.id === family)!.name} ↗
          </LivingButton>
        </div>
        <main
          className={`concept concept-milo milo-stage flux-stage ${night ? "night" : ""} ${stopped ? "quiet" : ""}`}
          style={styles}
          id="flux-stage"
          ref={stage}
          tabIndex={-1}
        >
          <MorphContent identity={section} className="screen-morph">
            {section === "components" ? (
              <>
                <ControlRoom studio />
                <div className="specimen-extra">
                  <div className="token-row">
                    <div>
                      <span>Поверхность</span>
                      <i className="token-surface" />
                    </div>
                    <div>
                      <span>Материал</span>
                      <i className="token-pigment" />
                    </div>
                    <div>
                      <span>Контур</span>
                      <i className="token-line" />
                    </div>
                    <div>
                      <span>Акцент</span>
                      <i className="token-accent" />
                    </div>
                  </div>
                  <Atoms />
                  <ConversationSpecimen />
                </div>
              </>
            ) : section === "appearance" ? (
              <Appearance
                palette={palette}
                onPalette={setPalette}
                night={night}
                heading={heading}
                body={body}
                onHeading={setHeading}
                onBody={setBody}
                strength={strength}
                onStrength={setStrength}
                duration={duration}
                onDuration={setDuration}
                lite={lite}
                onLite={setLite}
                quiet={quiet}
                onQuiet={setQuiet}
                hints={hints}
                onHints={(v) => {
                  setHints(v);
                  if (!v) setHint(null);
                }}
                systemQuiet={systemQuiet}
              />
            ) : section === "marks" ? (
              <Marks family={family} onFamily={setFamily} />
            ) : section === "pets" ? (
              <>
                <PetCrew />
                <div className="specimen-extra">
                  <ConversationSpecimen />
                </div>
              </>
            ) : section === "workspace" ? (
              <Workspace {...props} />
            ) : (
              <Auth {...props} />
            )}
          </MorphContent>
        </main>
        <footer className="flux-footer">
          <p>
            Витрина компонентов и поведения. Это основа для сборки экранов;
            окончательное расположение экранов выбираем позже.
          </p>
          <a href="#/milo/v2/flux/controls">Предыдущие механики ↗</a>
          <span>Настройки этого просмотра · без реальных API</span>
        </footer>
        {hint && hints && section !== "pets" && (
          <CompanionHint
            event={hint}
            section={scope}
            onDismiss={() => setHint(null)}
          />
        )}
      </div>
    </MotionContext.Provider>
  );
}
