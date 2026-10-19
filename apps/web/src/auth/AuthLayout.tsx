import { DotGrid, DotText, Gang, useLook, useMedia, WIDE, type GangHandle } from '@qubite/ui';
import { Link, Outlet } from '@tanstack/react-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import './auth.css';
import { Ctx, LEGAL_LINKS, type PageHead } from './page';

/**
 * Рамка Qubite Auth (D-034): сетка точек, помощники группой, заголовок из точек,
 * карточка с формой и юридические ссылки внизу. Одна на все страницы — при переходе
 * заголовок перестраивается из тех же точек, помощники не пересоздаются.
 */
export function AuthLayout() {
  const wide = useMedia(WIDE);
  const { set, theme } = useLook();
  const gang = useRef<GangHandle>(null);
  const [head, setHeadState] = useState<PageHead>({ dots: '', title: 'Qubite' });
  const [away, setAway] = useState(false);

  const setHead = useCallback((h: PageHead) => setHeadState(h), []);
  const shy = useCallback((on: boolean) => setAway(on), []);
  const sad = useCallback(() => gang.current?.setMood('sad', 1600), []);
  const cheer = useCallback(() => gang.current?.cheer(), []);
  const ctx = useMemo(() => ({ setHead, shy, sad, cheer }), [setHead, shy, sad, cheer]);

  return (
    <Ctx.Provider value={ctx}>
      <div className={head.wide ? 'auth auth-wide' : 'auth'}>
        <DotGrid />
        <header className="auth-top">
          <Link className="auth-mark" to="/" aria-label="Qubite — на главную">
            <DotText text="qubite" pitch={3} assemble={false} repel={0} label="Qubite" />
            <span className="q-dot" />
            <span className="auth-badge">Auth</span>
          </Link>
          <button
            type="button"
            className="auth-theme"
            aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              set('theme', theme === 'dark' ? 'light' : 'dark', {
                x: r.left + r.width / 2,
                y: r.top + r.height / 2,
              });
            }}
          >
            <i />
          </button>
        </header>
        <main className="auth-main">
          <div className="auth-gang">
            <Gang
              ref={gang}
              pitch={wide ? 4 : 3.2}
              away={away}
              label={away ? 'Помощники закрыли глаза' : 'Помощники'}
            />
          </div>
          <h1 className="q-sr">{head.title}</h1>
          <div className="auth-title" aria-hidden="true">
            {head.dots && (
              <DotText
                key={head.dots}
                text={head.dots}
                pitch={wide ? 5 : head.dots.length > 8 ? 3.2 : 4}
                color="orange"
                repel={30}
                label=""
              />
            )}
          </div>
          {head.lead && <p className="auth-lead">{head.lead}</p>}
          <div className="auth-card panel">
            <Outlet />
          </div>
        </main>
        <footer className="auth-foot">
          <nav aria-label="Документы">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.doc} to="/legal/$doc" params={{ doc: l.doc }}>
                {l.label}
              </Link>
            ))}
          </nav>
          <span>Qubite · только нужные cookies</span>
        </footer>
      </div>
    </Ctx.Provider>
  );
}
