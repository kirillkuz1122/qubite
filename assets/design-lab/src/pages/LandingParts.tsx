import { Icon } from "../Icons";
import type { PageProps } from "../types";
export function BrandNav({
  open,
  light = false,
}: {
  open: PageProps["open"];
  light?: boolean;
}) {
  return (
    <nav
      className={`brand-nav ${light ? "brand-light" : ""}`}
      aria-label="Навигация концепции"
    >
      <button
        className="wordmark"
        onClick={() => open("landing")}
        aria-label="Qubite — лендинг"
      >
        <span className="brand-symbol">q</span>qubite
        <span className="brand-dot">®</span>
      </button>
      <span className="nav-caption">Твоё пространство. Твои правила.</span>
      <button className="nav-login" onClick={() => open("auth")}>
        Войти <Icon name="arrow" size={16} />
      </button>
    </nav>
  );
}
export function CTA({
  open,
  label = "Исследовать пространство",
}: {
  open: PageProps["open"];
  label?: string;
}) {
  return (
    <div className="hero-actions">
      <button className="primary" onClick={() => open("workspace")}>
        {label}
        <Icon name="arrow" />
      </button>
      <button className="text-action" onClick={() => open("material")}>
        Потрогать материал <Icon name="plus" size={16} />
      </button>
    </div>
  );
}
export function Capabilities({ open }: { open: PageProps["open"] }) {
  return (
    <div className="capabilities">
      {[
        {
          icon: "docs",
          title: "Мысли → знания",
          text: "Заметки и документы, связанные между собой.",
        },
        {
          icon: "today",
          title: "Планы → действия",
          text: "Твой день и проекты в понятном ритме.",
        },
        {
          icon: "modules",
          title: "Инструменты → возможности",
          text: "Поиск, Writer и VPN рядом, когда нужны.",
        },
      ].map((x, i) => (
        <button
          className="capability"
          key={x.title}
          onClick={() => open("workspace")}
        >
          <span className="cap-number">0{i + 1}</span>
          <Icon name={x.icon} />
          <h3>{x.title}</h3>
          <p>{x.text}</p>
          <Icon name="arrow" size={17} />
        </button>
      ))}
    </div>
  );
}
