import { useState, type CSSProperties } from "react";
import { LivingButton } from "../milo/Controls";
export const services = [
  { id: "qubite", name: "Qubite", caption: "Общий знак платформы" },
  { id: "search", name: "Search", caption: "Поиск и ответы" },
  { id: "writing", name: "Writing", caption: "Редактор и проверка текста" },
  { id: "vpn", name: "VPN", caption: "Личное соединение" },
  { id: "vault", name: "Vault", caption: "Интеграция AliasVault" },
  { id: "memos", name: "Notes", caption: "Действующие заметки Memos" },
  { id: "vikunja", name: "Tasks", caption: "Действующие задачи Vikunja" },
  { id: "siyuan", name: "Notebook", caption: "Интеграция SiYuan" },
  { id: "brief", name: "Brief", caption: "Бот интервью и ТЗ / Specbot" },
  { id: "kwork", name: "Leads", caption: "Помощник Kwork / лиды" },
  {
    id: "tournaments",
    name: "Tournaments",
    caption: "Отдельный турнирный модуль",
  },
  { id: "telegram", name: "Telegram", caption: "Управляющий бот платформы" },
] as const;
export const families = [
  {
    id: "ribbon",
    name: "Лента",
    note: "Один мягкий жест. Q раскрывается в хвост потока.",
  },
  {
    id: "orbit",
    name: "Орбита",
    note: "Квантовое состояние: центр и две плоскости движения.",
  },
  {
    id: "seed",
    name: "Зерно",
    note: "Плотная форма, внутреннее пространство и маленький импульс.",
  },
  {
    id: "nodes",
    name: "Связи",
    note: "Точки и связи. Один знак собирает множество возможностей.",
  },
  {
    id: "portal",
    name: "Портал",
    note: "Мягкий квадрат приложения. Внутри — вход в твоё пространство.",
  },
] as const;
export type MarkFamily = (typeof families)[number]["id"];
const glyphs: Record<string, string> = {
  search: "M24 26a11 11 0 1 0 22 0a11 11 0 1 0-22 0M43 35l10 13",
  writing: "M24 44l3-12L43 16l8 8-16 16-11 4M28 32l7 8M23 50h27",
  vpn: "M21 22l16-6 16 6v11c0 12-16 19-16 19S21 45 21 33Z M30 33l5 5 10-11",
  vault: "M26 30v-7a11 11 0 0 1 22 0v7M23 30h28v22H23Z M37 38v7",
  memos: "M24 17h26v29l-8 8H24Z M42 54v-8h8M30 27h13M30 34h13M30 41h7",
  vikunja: "M23 24l4 4 6-8M23 40l4 4 6-8M39 25h12M39 41h12",
  siyuan:
    "M37 22c-6-5-13-6-20-2v29c7-4 14-3 20 2 6-5 13-6 20-2V20c-7-4-14-3-20 2Z M37 22v29",
  brief: "M20 20h34v25H38l-10 8v-8h-8Z M27 28h20M27 36h13",
  kwork: "M21 46l10-12 10 6 12-21M43 19h10v10M22 53h31",
  tournaments:
    "M27 18h20v15c0 8-5 12-10 12s-10-4-10-12Z M27 22h-9v5c0 8 6 11 11 11M47 22h9v5c0 8-6 11-11 11M37 45v9M28 54h18",
  telegram: "M17 30l40-14-9 39-13-15-10 9 2-17 22-10-22 17Z",
};
export function Mark({
  family = "ribbon",
  service = "qubite",
  className = "",
}: {
  family?: MarkFamily;
  service?: string;
  className?: string;
}) {
  const main = service === "qubite";
  return (
    <svg
      className={`brand-mark mark-${family} ${className}`}
      viewBox="0 0 74 74"
      fill="none"
      aria-hidden="true"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {family === "ribbon" &&
        (main ? (
          <path
            strokeWidth="8"
            d="M50 48C39 59 19 53 18 36c-2-18 20-29 34-16 11 10 6 23-3 25-7 2-12-6-7-10 5-5 14 7 18 18"
          />
        ) : (
          <path
            strokeWidth="2.5"
            opacity=".32"
            d="M54 57C32 67 9 49 15 28c6-24 34-21 43-9"
          />
        ))}
      {family === "orbit" && (
        <>
          <ellipse
            cx="37"
            cy="34"
            rx="28"
            ry="18"
            transform="rotate(-40 37 34)"
            strokeWidth="2.8"
          />
          <ellipse
            cx="37"
            cy="34"
            rx="28"
            ry="18"
            transform="rotate(40 37 34)"
            strokeWidth="2.8"
            opacity=".38"
          />
          {main ? (
            <>
              <circle cx="37" cy="34" r="7" fill="currentColor" stroke="none" />
              <path strokeWidth="4" d="M47 46l13 13" />
            </>
          ) : null}
          <circle cx="15" cy="49" r="3.5" fill="var(--tone-b)" stroke="none" />
        </>
      )}
      {family === "seed" &&
        (main ? (
          <>
            <path
              fill="currentColor"
              fillRule="evenodd"
              stroke="none"
              d="M14 34C14 18 25 12 39 13c18 1 23 15 19 31L64 58 49 54C28 65 14 52 14 34Zm12 0c0 10 6 16 15 13 8-3 10-13 4-20-8-9-19-3-19 7Z"
            />
            <circle cx="54" cy="17" r="5" fill="var(--tone-b)" stroke="none" />
          </>
        ) : (
          <path
            fill="var(--pigment)"
            stroke="none"
            d="M9 36C8 14 29 6 49 12c19 6 20 31 7 45-18 17-46 2-47-21Z"
          />
        ))}
      {family === "nodes" &&
        (main ? (
          <>
            <path
              strokeWidth="2.5"
              d="M21 19h29l10 18-12 19H21L12 36l9-17M48 56l14 6"
            />
            {[
              [21, 19],
              [50, 19],
              [60, 37],
              [48, 56],
              [21, 56],
              [12, 36],
            ].map(([cx, cy], i) => (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r="4.2"
                fill={i === 3 ? "var(--tone-b)" : "currentColor"}
                stroke="none"
              />
            ))}
          </>
        ) : (
          <path
            strokeWidth="2"
            opacity=".24"
            d="M20 10h34l10 23-10 28H20L10 33Z"
          />
        ))}
      {family === "portal" && (
        <>
          <rect x="9" y="9" width="56" height="56" rx="20" strokeWidth="3.5" />
          {main ? (
            <>
              <path
                strokeWidth="6"
                d="M45 46a15 15 0 1 1 5-11v12M40 40l14 14"
              />
              <circle
                cx="59"
                cy="15"
                r="5"
                fill="var(--tone-c)"
                stroke="none"
              />
            </>
          ) : null}
        </>
      )}
      {!main && (
        <path
          d={glyphs[service] || glyphs.memos}
          strokeWidth={
            family === "seed"
              ? 3.7
              : family === "nodes"
                ? 3
                : family === "orbit"
                  ? 2.3
                  : 3.8
          }
          strokeDasharray={family === "nodes" ? "1 5" : undefined}
        />
      )}
      {!main && family === "nodes" && (
        <circle cx="58" cy="14" r="3.5" fill="var(--tone-b)" stroke="none" />
      )}
    </svg>
  );
}
export function Marks({
  family,
  onFamily,
}: {
  family: MarkFamily;
  onFamily: (v: MarkFamily) => void;
}) {
  const [mono, setMono] = useState(false);
  const selected = families.find((x) => x.id === family)!;
  return (
    <div
      className={`specimen-section marks-section ${mono ? "marks-mono" : ""}`}
    >
      <div className="section-heading">
        <span className="eyebrow">03 / ЗНАКИ</span>
        <h1>
          Одна семья.
          <br />
          Разные возможности.
        </h1>
        <p>
          Пять самостоятельных языков формы. Выбери семейство — ниже все сервисы
          сразу говорят на нём.
        </p>
      </div>
      <div className="logo-choices">
        {families.map((f, i) => (
          <LivingButton
            key={f.id}
            className="logo-choice"
            aria-pressed={family === f.id}
            onClick={() => onFamily(f.id)}
          >
            <small>0{i + 1}</small>
            <Mark family={f.id} />
            <strong>{f.name}</strong>
            <span>{f.note}</span>
          </LivingButton>
        ))}
      </div>
      <div className="mark-wordmark">
        <Mark family={family} />
        <span>
          qubite<span className="wordmark-dot">.</span>
        </span>
        <small>{selected.name} / выбранное семейство</small>
      </div>
      <div className="service-mark-head">
        <h2>Вся экосистема</h2>
        <LivingButton
          className="secondary"
          aria-pressed={mono}
          onClick={() => setMono(!mono)}
        >
          {mono ? "Вернуть цвет" : "Монохром"}
        </LivingButton>
      </div>
      <div className="service-mark-grid">
        {services.map((s, i) => (
          <div
            className="service-mark-card"
            key={s.id}
            style={
              {
                "--mark-color": `var(--tone-${["a", "b", "c"][i % 3]})`,
              } as CSSProperties
            }
          >
            <Mark family={family} service={s.id} />
            <strong>{s.name}</strong>
            <span>{s.caption}</span>
            <div className="mark-small-sizes">
              <Mark family={family} service={s.id} />
              <Mark family={family} service={s.id} />
              <Mark family={family} service={s.id} />
            </div>
          </div>
        ))}
      </div>
      <div className="mark-size-proof">
        <div>
          <Mark family={family} />
          <span>Иконка приложения</span>
        </div>
        <div className="inverse-proof">
          <Mark family={family} />
          <span>На тёмной поверхности</span>
        </div>
        <div>
          <Mark family={family} />
          <span>Маленький знак · 24 px</span>
        </div>
      </div>
      <details className="mark-matrix">
        <summary>Сравнить все пять семейств на каждом сервисе</summary>
        <div>
          {services.map((s) => (
            <div className="matrix-row" key={s.id}>
              <strong>{s.name}</strong>
              {families.map((f) => (
                <div key={f.id}>
                  <Mark family={f.id} service={s.id} />
                  <span>{f.name}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </details>
      <p className="specimen-footnote">
        Notes, Tasks, Vault и Notebook — знаки разделов Qubite для интеграций
        Memos, Vikunja, AliasVault и SiYuan. Оригинальные бренды этих проектов
        остаются их собственными. Сервисные знаки — эскизы, ещё не утверждены.
      </p>
    </div>
  );
}
