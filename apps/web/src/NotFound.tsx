import { Button, Companion, DotText, useMedia, WIDE } from '@qubite/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import './notfound.css';

/*
 * Цифры из точек 5×7 (как в макете «Экраны → 404»): 1 — точка есть.
 * Ноль появляется, только когда его позвали; пока его нет — на его месте Элик «за кофе».
 */
type Dot = readonly [number, number];
const FOUR_DOTS: readonly Dot[] = [
  [2, 0],
  [3, 0],
  [1, 1],
  [2, 1],
  [3, 1],
  [0, 2],
  [1, 2],
  [3, 2],
  [0, 3],
  [3, 3],
  ...[0, 1, 2, 3, 4].map((x): Dot => [x, 4]),
  [3, 5],
  [3, 6],
];
const ZERO_DOTS: readonly Dot[] = [
  [1, 0],
  [2, 0],
  [3, 0],
  ...[1, 2, 3, 4, 5].flatMap((y): Dot[] => [
    [0, y],
    [1, y],
    [3, y],
    [4, y],
  ]),
  [1, 6],
  [2, 6],
  [3, 6],
];

const TEXT = {
  away: {
    eyebrow: '404 / не по плану',
    toggle: 'Позвать ноль',
    accent: 'Ноль ушёл за кофе.',
    body: ['Адрес изменился или страница удалена.', 'Ваши данные на месте.'],
  },
  back: {
    eyebrow: '404 / все цифры в сборе',
    toggle: 'Отпустить за кофе',
    accent: 'Я отошёл на ноль минут!',
    body: ['Ноль вернулся. Страница — нет.', 'Зато ваши данные на месте.'],
  },
} as const;

function Digit({
  dots,
  tone,
  shown = true,
}: {
  dots: readonly Dot[];
  tone: 'ink' | 'orange';
  shown?: boolean;
}) {
  return (
    <svg
      className={`nf-digit nf-${tone}`}
      viewBox="0 0 5 7"
      aria-hidden="true"
      data-shown={shown || undefined}
    >
      {dots.map(([x, y], i) => (
        <circle
          key={`${x}-${y}`}
          cx={x + 0.5}
          cy={y + 0.5}
          r={0.36}
          style={{ transitionDelay: `${shown ? i * 18 : 0}ms` }}
        />
      ))}
    </svg>
  );
}

/**
 * «Такой страницы нет» — одна и та же на неизвестный адрес и на Owner Console для не-owner
 * (D-231): по странице и по названию вкладки их не отличить. Макет — Figma «Экраны → 404» (D-911).
 */
export function NotFound() {
  const wide = useMedia(WIDE);
  const navigate = useNavigate();
  const [back, setBack] = useState(false);
  const t = back ? TEXT.back : TEXT.away;
  useEffect(() => {
    document.title = 'Страницы нет · Qubite';
  }, []);

  return (
    <div className="nf">
      <header className="nf-top">
        <Link className="nf-mark" to="/" aria-label="Qubite — на главную">
          <DotText text="qubite" pitch={3} assemble={false} repel={0} label="Qubite" />
          <span className="q-dot" />
        </Link>
        <span className="nf-calm">Всё остальное — на месте.</span>
      </header>
      <main className="nf-main">
        <p className="nf-eyebrow" aria-live="polite">
          {t.eyebrow}
        </p>
        <div className="nf-art">
          <Digit dots={FOUR_DOTS} tone="ink" />
          <div className="nf-zero" data-back={back || undefined}>
            <Digit dots={ZERO_DOTS} tone="orange" shown={back} />
            <div className="nf-away" aria-hidden={back}>
              <span className="nf-away-note">{wide ? 'ушёл за кофе' : 'за кофе'} — ноль</span>
              <span className="nf-elik">
                <Companion kind="elik" pitch={wide ? 8 : 4.4} assemble={false} label="Элик" />
              </span>
            </div>
          </div>
          <Digit dots={FOUR_DOTS} tone="ink" />
        </div>
        <Button size="sm" dot={false} aria-pressed={back} onClick={() => setBack((v) => !v)}>
          {t.toggle}
        </Button>
        <h1 className="q-sr">Такой страницы нет</h1>
        <div className="nf-title" aria-hidden="true">
          <DotText
            text="ТАКОЙ СТРАНИЦЫ НЕТ"
            pitch={wide ? 3.4 : 3}
            assemble={false}
            repel={20}
            label=""
          />
        </div>
        <p className="nf-accent">{t.accent}</p>
        <p className="nf-text">
          {t.body[0]} {t.body[1]}
        </p>
        <div className="nf-actions">
          <Button variant="fill" onClick={() => void navigate({ to: '/' })}>
            На главную
          </Button>
          <Button
            variant="quiet"
            onClick={() => (history.length > 1 ? history.back() : void navigate({ to: '/' }))}
          >
            Назад
          </Button>
        </div>
      </main>
      <footer className="nf-foot">Потерялась страница, но не ваша продуктивность.</footer>
    </div>
  );
}
