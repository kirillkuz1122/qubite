import { Note } from '@qubite/ui';
import { Link, useParams } from '@tanstack/react-router';
import { LEGAL, LEGAL_VERSION } from './legal';
import { LEGAL_LINKS, usePage } from './page';

/** Юридическая страница: условия, приватность, cookies, согласие (черновик, Q-06). */
export function LegalPage() {
  const { doc } = useParams({ strict: false }) as { doc?: string };
  const d = LEGAL[(doc ?? '') as keyof typeof LEGAL];
  usePage({
    dots: d?.dots ?? 'НЕТ',
    title: d?.title ?? 'Документ не найден',
    wide: true,
  });
  if (!d)
    return (
      <Note tone="bad">
        Такого документа нет. <Link to="/auth">Ко входу</Link>
      </Note>
    );
  return (
    <article className="legal">
      <Note>
        <b>Черновик.</b> Реквизиты оператора и страны работы ещё не указаны — документ вступит в
        силу после публикации окончательной редакции. Редакция {LEGAL_VERSION}.
      </Note>
      <h2 className="legal-title">{d.title}</h2>
      {d.sections.map((s) => (
        <section key={s.h}>
          <h3>{s.h}</h3>
          {s.p.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </section>
      ))}
      <nav className="auth-links" aria-label="Другие документы">
        {LEGAL_LINKS.filter((l) => l.doc !== doc).map((l) => (
          <Link key={l.doc} to="/legal/$doc" params={{ doc: l.doc }}>
            {l.label}
          </Link>
        ))}
      </nav>
    </article>
  );
}
