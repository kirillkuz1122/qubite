import { Material } from "../Materials";
import { BrandNav, CTA, Capabilities } from "./LandingParts";
import type { PageProps } from "../types";
export default function Folio(p: PageProps) {
  return (
    <div className="landing folio-landing">
      <BrandNav open={p.open} />
      <div className="folio-rule">
        <span>Личная цифровая среда</span>
        <span>Том I / начало</span>
      </div>
      <section className="folio-hero">
        <div className="hero-copy">
          <span className="eyebrow">ХОРОШИЕ МЫСЛИ ЗАСЛУЖИВАЮТ МЕСТА</span>
          <h1>
            {p.concept.title.map((t, i) => (
              <span key={t} className={i === 1 ? "accent-line" : ""}>
                {t}
              </span>
            ))}
          </h1>
          <p className="hero-description">{p.concept.description}</p>
          <CTA open={p.open} label="Открыть чистый лист" />
          <div className="folio-signature">С вниманием к твоему времени.</div>
        </div>
        <div className="hero-art">
          <Material direction="folio" mood={p.mood} event={p.event} />
        </div>
      </section>
      <div className="folio-chapter">
        <span>01 / Внутри</span>
        <p>
          Меньше вкладок.
          <br />
          <em>Больше связей.</em>
        </p>
      </div>
      <Capabilities open={p.open} />
    </div>
  );
}
