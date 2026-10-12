import { Material } from "../Materials";
import { BrandNav, CTA, Capabilities } from "./LandingParts";
import type { PageProps } from "../types";
export default function Prism(p: PageProps) {
  return (
    <div className="landing prism-landing">
      <BrandNav open={p.open} />
      <section className="prism-hero">
        <div className="prism-axis" aria-hidden="true">
          <span>01 / IDEA</span>
          <span>02 / CONNECTION</span>
          <span>03 / POSSIBILITY</span>
        </div>
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="status-dot" /> ТВОЁ ЛИЧНОЕ СОЗВЕЗДИЕ
          </span>
          <h1>
            {p.concept.title.map((t, i) => (
              <span key={t} className={i === 1 ? "accent-line" : ""}>
                {t}
              </span>
            ))}
          </h1>
          <p className="hero-description">{p.concept.description}</p>
          <CTA open={p.open} label="Найти свою связь" />
        </div>
        <div className="hero-art">
          <Material direction="prism" mood={p.mood} event={p.event} />
          <div className="prism-orbit-label">
            <span>Связь, которую можно почувствовать.</span>
            <span>∿</span>
          </div>
        </div>
      </section>
      <div className="prism-divider">
        <span />
        <span>ОТ ОТДЕЛЬНОЙ МЫСЛИ К ЦЕЛОЙ КАРТИНЕ</span>
        <span />
      </div>
      <Capabilities open={p.open} />
    </div>
  );
}
