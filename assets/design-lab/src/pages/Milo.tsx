import { Material } from "../Materials";
import { BrandNav, CTA, Capabilities } from "./LandingParts";
import type { PageProps } from "../types";
export default function Milo(p: PageProps) {
  return (
    <div className="landing milo-landing">
      <BrandNav open={p.open} />
      <div className="milo-note">
        Psst… это пространство на твоей стороне. <span>↘</span>
      </div>
      <section className="milo-hero">
        <div className="hero-copy">
          <span className="eyebrow">ДЕЛАТЬ ВАЖНОЕ. ЧУВСТВОВАТЬ ЖИВОЕ.</span>
          <h1>
            {p.concept.title.map((t, i) => (
              <span key={t} className={i === 2 ? "accent-line" : ""}>
                {t}
              </span>
            ))}
          </h1>
          <p className="hero-description">{p.concept.description}</p>
          <CTA open={p.open} label="Познакомиться ближе" />
          <div className="milo-stamp">
            100%
            <br />
            <span>на твоей стороне</span>
          </div>
        </div>
        <div className="hero-art">
          <Material direction="milo" mood={p.mood} event={p.event} />
          <div className="milo-bubble">Идея? Мы слушаем.</div>
        </div>
      </section>
      <Capabilities open={p.open} />
      <div className="milo-bottom">
        Большие идеи начинаются с маленького «а что если?» <span>↗</span>
      </div>
    </div>
  );
}
