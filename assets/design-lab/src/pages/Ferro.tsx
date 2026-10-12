import { Material } from "../Materials";
import { BrandNav, CTA, Capabilities } from "./LandingParts";
import type { PageProps } from "../types";
export default function Ferro(p: PageProps) {
  return (
    <div className="landing ferro-landing">
      <BrandNav open={p.open} />
      <div className="ferro-topline">
        <span>PERSONAL OPERATING FIELD</span>
        <span>02 — MAGNETIC MATTER</span>
      </div>
      <section className="ferro-hero">
        <div className="hero-art">
          <Material direction="ferro" mood={p.mood} event={p.event} />
          <div className="ferro-signal">
            <i />
            <span>Поле активно</span>
            <span>↗ притягивает важное</span>
          </div>
        </div>
        <div className="hero-copy">
          <span className="eyebrow">QUBITE / ТВОЙ ЦЕНТР</span>
          <h1>
            {p.concept.title.map((t, i) => (
              <span key={t} className={i === 2 ? "accent-line" : ""}>
                {t}
              </span>
            ))}
          </h1>
          <p className="hero-description">{p.concept.description}</p>
          <CTA open={p.open} label="Войти в поле" />
        </div>
      </section>
      <div className="ferro-marquee" aria-hidden="true">
        <span>THINK · CONNECT · MAKE ·</span>
        <span>THINK · CONNECT · MAKE ·</span>
      </div>
      <Capabilities open={p.open} />
    </div>
  );
}
