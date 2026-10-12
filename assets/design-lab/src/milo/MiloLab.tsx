import { useEffect, useRef, useState } from "react";
import { concepts } from "../concepts";
import { Workspace } from "../Workspace";
import { Auth } from "../Auth";
import Milo from "../pages/Milo";
import { Icon } from "../Icons";
import { MotionContext } from "./motion";
import { useNeighborhood } from "./neighborhood";
import { profiles, type MaterialKind } from "./profiles";
import {
  LivingButton,
  LivingSlider,
  LivingSwitch,
  LivingTabs,
} from "./Controls";
import { ControlRoom } from "./ControlRoom";
import { MorphContent } from "./Transition";
import { CompanionHint, PetCrew, type PetEvent } from "./Pets";
import type { Mood, View } from "../types";
const screens = [
  { id: "controls", label: "Потрогать" },
  { id: "workspace", label: "Интерфейс" },
  { id: "auth", label: "Вход" },
  { id: "landing", label: "Лендинг" },
  { id: "pets", label: "Помощники" },
];
function route() {
  const [, , material, screen] = location.hash.replace("#/", "").split("/");
  return {
    material: profiles.some((p) => p.id === material)
      ? (material as MaterialKind)
      : ("souffle" as MaterialKind),
    screen: screens.some((s) => s.id === screen) ? screen : "controls",
  };
}
export function MiloLab() {
  const [current, setCurrent] = useState(route);
  const [strength, setStrength] = useState(70);
  const [quiet, setQuiet] = useState(false),
    [night, setNight] = useState(false);
  const [hints, setHints] = useState(true),
    [settings, setSettings] = useState(false);
  const [systemQuiet, setSystemQuiet] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [device, setDevice] = useState("auto"),
    [mood, setMood] = useState<Mood>("idle"),
    [event, setEvent] = useState(0);
  const [hint, setHint] = useState<PetEvent | null>(null);
  const [hintScope, setHintScope] = useState("today");
  const frame = useRef<HTMLDivElement>(null),
    hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profile = profiles.find((p) => p.id === current.material)!;
  const concept = concepts[4];
  const stopped = quiet || systemQuiet || strength === 0;
  const neighborhood = useNeighborhood(
    profile.id === "halo" && !stopped,
    strength / 100,
  );
  useEffect(() => {
    const hash = () => {
      setCurrent(route());
      setHint(null);
    };
    window.addEventListener("hashchange", hash);
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystemQuiet(media.matches);
    media.addEventListener("change", change);
    return () => {
      window.removeEventListener("hashchange", hash);
      media.removeEventListener("change", change);
      if (hintTimer.current) clearTimeout(hintTimer.current);
    };
  }, []);
  useEffect(() => {
    document.title = `Qubite · Milo ${profile.name} · ${screens.find((s) => s.id === current.screen)!.label}`;
  }, [current, profile.name]);
  function go(screen: string, material = current.material) {
    setCurrent({ material, screen });
    location.hash = `/milo/v2/${material}/${screen}`;
    setMood("idle");
    setHint(null);
  }
  function react(m: Mood, scope = current.screen) {
    setMood(m);
    setEvent((n) => n + 1);
    if (hints && (m === "error" || m === "success")) {
      setHint(m);
      setHintScope(scope);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHint(null), 10000);
    }
  }
  const props = {
    concept,
    mood,
    event,
    react,
    open: (v: View) => go(v === "material" ? "controls" : v),
  };
  return (
    <MotionContext.Provider
      value={{ profile, strength: strength / 100, quiet: stopped }}
    >
      <div
        ref={neighborhood.ref}
        {...neighborhood.handlers}
        className={`milo-lab concept-milo ${night ? "night" : ""} ${stopped ? "quiet" : ""}`}
        data-material={profile.id}
        style={{ "--strength": strength / 100 } as React.CSSProperties}
      >
        <a
          className="skip-link"
          href="#milo-stage"
          onClick={(e) => {
            e.preventDefault();
            frame.current?.focus();
          }}
        >
          К интерфейсу
        </a>
        <header className="milo-lab-header">
          <div className="milo-lab-brand">
            <span className="milo-q">q.</span>
            <div>
              <strong>Milo</strong>
              <span>Живой интерфейс · исследование 02</span>
            </div>
          </div>
          <div className="milo-header-actions">
            <LivingButton
              className="lab-adjust"
              aria-label="Ощущения"
              aria-expanded={settings}
              aria-controls="motion-settings"
              onClick={() => setSettings(!settings)}
            >
              <Icon name="settings" size={17} />
              <span>Ощущения</span>
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
        <nav className="material-picker" aria-label="Пять механик Milo">
          {profiles.map((p, i) => (
            <LivingButton
              key={p.id}
              aria-pressed={p.id === profile.id}
              className={`material-choice ${p.id === profile.id ? "selected" : ""}`}
              onClick={() => go(current.screen, p.id)}
            >
              <span
                className={`finish-swatch swatch-${p.id}`}
                style={{ "--pigment": p.color } as React.CSSProperties}
              />
              <span>
                <small>
                  0{i + 1} / {p.release}
                </small>
                <strong>{p.name}</strong>
              </span>
            </LivingButton>
          ))}
        </nav>
        <div
          className={`motion-settings ${settings ? "open" : ""}`}
          id="motion-settings"
          inert={!settings}
          aria-hidden={!settings}
        >
          <div>
            <div className="settings-intro">
              <strong>Настрой под себя.</strong>
              <p>
                0 — неподвижно. 100 — максимально податливо.
                <br />
                Настройки этого просмотра сбрасываются после перезагрузки.
              </p>
            </div>
            <LivingSlider
              label="Податливость интерфейса"
              value={strength}
              onChange={setStrength}
            />
            <LivingSwitch
              label="Спокойный режим"
              checked={quiet || systemQuiet}
              onChange={(v) => {
                if (!systemQuiet) setQuiet(v);
              }}
            />
            <LivingSwitch
              label="Подсказки персонажей"
              checked={hints}
              onChange={(v) => {
                setHints(v);
                if (!v) setHint(null);
              }}
            />
            {systemQuiet && (
              <p className="system-motion-note">
                Уменьшение движения включено в системе.
              </p>
            )}
          </div>
        </div>
        <div className="milo-toolbar">
          <LivingTabs
            label="Экран Milo"
            items={screens}
            value={current.screen}
            onChange={(id) => go(id)}
          />
          <div className="milo-device-tools">
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
              <LivingButton
                aria-label={d.label}
                aria-pressed={device === d.id}
                key={d.id}
                onClick={() => setDevice(d.id)}
              >
                <Icon name={d.icon} size={17} />
              </LivingButton>
            ))}
          </div>
        </div>
        <div className={`preview-frame preview-${device}`}>
          <div
            className={`concept concept-milo milo-stage ${night ? "night" : ""} ${stopped ? "quiet" : ""}`}
            id="milo-stage"
            tabIndex={-1}
            ref={frame}
            data-material={profile.id}
          >
            <MorphContent identity={current.screen} className="screen-morph">
              {current.screen === "controls" ? (
                <ControlRoom />
              ) : current.screen === "workspace" ? (
                <Workspace {...props} />
              ) : current.screen === "auth" ? (
                <Auth {...props} />
              ) : current.screen === "landing" ? (
                <Milo {...props} />
              ) : (
                <PetCrew />
              )}
            </MorphContent>
          </div>
        </div>
        <footer className="milo-lab-footer">
          <span>
            <b>Milo / {profile.name}</b> — {profile.caption}. Один стиль, разные
            физические ощущения.
          </span>
          <a href="#/milo/workspace">Первое исследование ↗</a>
        </footer>
        {hint && hints && current.screen !== "pets" && (
          <CompanionHint
            event={hint}
            section={hintScope}
            onDismiss={() => setHint(null)}
          />
        )}
      </div>
    </MotionContext.Provider>
  );
}
