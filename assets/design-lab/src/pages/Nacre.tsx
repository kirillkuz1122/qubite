import { Material } from "../Materials";
import { BrandNav, CTA, Capabilities } from "./LandingParts";
import type { PageProps } from "../types";
export default function Nacre(p: PageProps) {
  return (
    <div className="landing nacre-landing">
      <BrandNav open={p.open} />
      <section className="nacre-hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="status-dot" /> Цифровое, но ощущается настоящим
          </span>
          <h1>
            {p.concept.title.map((t, i) => (
              <span key={t} className={i === 2 ? "accent-line" : ""}>
                {t}
              </span>
            ))}
          </h1>
          <p className="hero-description">{p.concept.description}</p>
          <CTA open={p.open} />
          <div className="hero-footnote">
            <span className="tiny-orbit" /> Мягкая форма. Ясная мысль.
          </div>
        </div>
        <div className="hero-art">
          <Material direction="nacre" mood={p.mood} event={p.event} />
          <div className="sculpture-label">
            <span>01 / NACRE</span>
            <span>Плотность вместо прозрачности</span>
          </div>
        </div>
      </section>
      <Capabilities open={p.open} />
      <div className="landing-bottom">
        <span>Знания. Проекты. Ты.</span>
        <span>Создано, чтобы оставаться.</span>
      </div>
    </div>
  );
}
