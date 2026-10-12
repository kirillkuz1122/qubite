import { useState } from "react";
import { Material } from "./Materials";
import { BrandNav } from "./pages/LandingParts";
import { Icon } from "./Icons";
import type { Mood, PageProps } from "./types";
export function Playground(p: PageProps) {
  const [energy, setEnergy] = useState(60);
  const scenarios: { name: string; mood: Mood; icon: string }[] = [
    { name: "Фокус", mood: "focus", icon: "today" },
    { name: "Ввод", mood: "capture", icon: "writing" },
    { name: "Сохранить", mood: "success", icon: "check" },
    { name: "Ошибка", mood: "error", icon: "close" },
    { name: "Приватность", mood: "private", icon: "lock" },
    { name: "Поиск", mood: "search", icon: "search" },
    { name: "Соединение", mood: "connect", icon: "vpn" },
    { name: "Покой", mood: "idle", icon: "sun" },
  ];
  return (
    <div className="playground">
      <BrandNav open={p.open} />
      <header className="playground-heading">
        <span className="eyebrow">{p.concept.number} / MATERIAL STUDY</span>
        <h1>Почувствуй {p.concept.russian.toLowerCase()}.</h1>
        <p>{p.concept.detail}</p>
      </header>
      <div className="playground-grid">
        <div
          className="material-stage"
          style={{ "--energy": energy / 100 } as React.CSSProperties}
        >
          <Material direction={p.concept.id} mood={p.mood} event={p.event} />
          <span className="stage-instruction">
            Проведи курсором или коснись. Затем поменяй состояние.
          </span>
        </div>
        <div className="material-controls">
          <span className="eyebrow">РЕАКЦИИ МАТЕРИАЛА</span>
          <div className="scenario-buttons">
            {scenarios.map((s) => (
              <button
                aria-pressed={p.mood === s.mood}
                key={s.mood}
                onClick={() => p.react(s.mood)}
              >
                <Icon name={s.icon} />
                {s.name}
              </button>
            ))}
          </div>
          <label className="energy-label">
            Податливость <span>{energy}%</span>
            <input
              aria-label="Податливость материала"
              type="range"
              min="0"
              max="100"
              value={energy}
              onChange={(e) => {
                setEnergy(Number(e.target.value));
                p.react("capture");
              }}
            />
          </label>
          <div className="motion-description">
            <h3>Свой язык движения</h3>
            <p>{p.concept.motion}</p>
          </div>
          <div className="type-specimen">
            <span className="eyebrow">ТИПОГРАФИКА</span>
            <div>Аа 0123</div>
            <p>{p.concept.font}</p>
          </div>
          <div className="palette">
            {p.concept.palette.map((c) => (
              <div key={c}>
                <span style={{ background: c }} />
                <code>{c}</code>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="material-explainer">
        <Icon name="spark" />
        <p>
          Материал отвечает на события, а текст остаётся стабильным. На телефоне
          — реакция на касание и ввод. В режиме спокойствия анимации
          отключаются.
        </p>
      </div>
    </div>
  );
}
