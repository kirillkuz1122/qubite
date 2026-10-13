import type { RefObject } from "react";
import documents from "./documents.json";
import { LivingLink } from "../material/Controls";
export const legalVersion = documents.bundle_version;
export function LegalLinks() {
  return (
    <nav aria-label="Документы Qubite">
      {documents.documents.map((d) => (
        <LivingLink key={d.id} href={`#/legal/${d.id}`}>
          {d.id === "terms"
            ? "Условия"
            : d.id === "privacy"
              ? "Приватность"
              : d.id === "cookies"
                ? "Cookies"
                : "Согласие на обработку"}
        </LivingLink>
      ))}
    </nav>
  );
}
export function LegalPage({
  id,
  heading,
}: {
  id: string;
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  const doc = documents.documents.find((d) => d.id === id);
  if (!doc)
    return (
      <h1 ref={heading} tabIndex={-1}>
        Документ не найден
      </h1>
    );
  return (
    <article className="legal-document">
      <LivingLink className="text-link" href="#/auth/login">
        ← К Qubite Auth
      </LivingLink>
      <span className="eyebrow">QUBITE · ДОКУМЕНТЫ</span>
      <h1 ref={heading} tabIndex={-1}>
        {doc.title}
      </h1>
      <p className="muted">
        Версия {legalVersion} · {documents.date}
      </p>
      <div className="legal-publication">
        <strong>Перед публичным запуском</strong>
        <p>
          Нужно заполнить реквизиты оператора, контакт, страны обработки и сроки
          хранения. Эта версия описывает новый Qubite и ещё не применяется к
          публичной регистрации.
        </p>
        <p>{documents.operator}</p>
        <p>{documents.contact}</p>
        <p>{documents.jurisdiction}</p>
      </div>
      {doc.sections.map((s) => (
        <section key={s.title}>
          <h2>{s.title}</h2>
          {s.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
