import { DotEngine, DotIcon, ExpandPage, useLook, type Rect } from '@qubite/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useShell } from '../context';
import type { Doc } from '../data';
import { useStore } from '../state';

export function DocsScreen() {
  const { state } = useStore();
  const shell = useShell();
  const [open, setOpen] = useState<Doc | null>(null);
  const [shown, setShown] = useState<Doc | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const close = useCallback(() => setOpen(null), []);
  const dest = useCallback((): Rect => {
    if (shell.wide) {
      const m = document.querySelector('.main-in')?.getBoundingClientRect();
      if (m) return { x: m.left + 24, y: 16, w: m.width - 48, h: innerHeight - 32 };
    }
    return { x: 8, y: 8, w: innerWidth - 16, h: innerHeight - 16 };
  }, [shell.wide]);

  function openDoc(d: Doc) {
    setShown(d);
    setOpen(d);
    shell.cheer('neit');
  }

  return (
    <>
      <div className="docs">
        {state.docs.map((d) => (
          <button
            key={d.id}
            data-obj={d.id}
            type="button"
            className="doc"
            ref={(el) => {
              if (el) rows.current.set(d.id, el);
            }}
            onClick={() => openDoc(d)}
          >
            <span className="ic" aria-hidden="true">
              <span
                className="q-dot"
                style={{ background: `var(--q-${d.tags[0]?.[0] ?? 'sky'})` }}
              />
            </span>
            <span className="t">
              <span className="name">{d.name}</span>
              <span className="pre">{d.pre}</span>
              <span className="meta">
                {d.tags.map(([c, t]) => (
                  <span key={t} className="tag">
                    <span className="q-dot" style={{ background: `var(--q-${c})` }} />
                    {t}
                  </span>
                ))}
                · {d.when}
              </span>
            </span>
          </button>
        ))}
      </div>
      <ExpandPage
        open={!!open}
        label="Документ"
        from={() => (shown ? (rows.current.get(shown.id)?.getBoundingClientRect() ?? null) : null)}
        dest={dest}
        onClose={close}
      >
        {shown && <Page doc={shown} onBack={close} />}
      </ExpandPage>
    </>
  );
}

function Page({ doc, onBack }: { doc: Doc; onBack: () => void }) {
  const fenwick = doc.id === 'fenwick';
  return (
    <div className="page-in">
      <button className="back" type="button" onClick={onBack}>
        <DotIcon name="back" />
        Docs
      </button>
      <h1>{doc.name}</h1>
      <div className="pm">
        {doc.tags.map((t) => t[1]).join(' · ')} · изменён {doc.when}
        {fenwick && ' · связан с 2 делами'}
      </div>
      {fenwick ? (
        <>
          <p>
            Дерево Фенвика хранит <b>частичные суммы</b>, поэтому и обновление, и запрос суммы на
            префиксе работают за O(log n). Удобно, когда массив часто меняется.
          </p>
          <div className="formula">sum(i) = t[i] + sum(i − (i &amp; −i))</div>
          <h2>Что разобрать</h2>
          <div className="check done">
            <i />
            Как устроен i &amp; −i
          </div>
          <div className="check">
            <i />
            Задача с отбора на ДП + Фенвик
          </div>
          <div className="check">
            <i />
            Сравнить с деревом отрезков
          </div>
          <h2>Страница из Ink</h2>
          <div className="ink">
            <InkSketch />
            <small>написано стилусом на планшете · распознано: «индексы 1…8, шаг i &amp; −i»</small>
          </div>
          <h2>Связано</h2>
          <div className="links">
            <span>
              <i className="q-dot" style={{ background: 'var(--q-orange)' }} />
              Разобрать задачу на ДП
            </span>
            <span>
              <i className="q-dot" style={{ background: 'var(--q-sky)' }} />3 карточки для
              повторения
            </span>
            <span>
              <i className="q-dot" style={{ background: 'var(--q-yellow)' }} />
              Мысль от 11:40
            </span>
          </div>
        </>
      ) : (
        <>
          <p>{doc.pre}</p>
          <p>
            Это тестовая страница. Настоящие документы с редактором и синхронизацией появятся в
            задачах DOC-001 и DOC-002.
          </p>
        </>
      )}
    </div>
  );
}

/** Набросок «от руки»: столбики дерева Фенвика дописываются точками по очереди. */
function InkSketch() {
  const cv = useRef<HTMLCanvasElement>(null);
  const { palette } = useLook();
  const start = useRef(palette);
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const P = start.current;
    let e: DotEngine | null = null;
    const t = setTimeout(() => {
      e = new DotEngine(c, { ground: P.bg, light: P.ink, repel: 24 });
      const W = e.W;
      const H = e.H;
      const now = performance.now() / 1000;
      let n = 0;
      for (let i = 1; i <= 8; i++) {
        const x = W * 0.08 + (i - 1) * W * 0.12;
        const len = i & -i;
        for (let k = 0; k < len * 4; k++) {
          const d = e.dot(
            x + Math.sin(k) * 0.6,
            H * 0.82 - k * ((H * 0.62) / 32),
            i % 2 ? P.sky : P.orange,
            2.4,
            [x, H + 10],
          );
          d.wake = now + n++ * 0.012;
        }
        const d = e.dot(x, H * 0.9, P.dim, 2.4, [x, H + 10]);
        d.wake = now + n++ * 0.012;
      }
    }, 200);
    return () => {
      clearTimeout(t);
      e?.destroy();
    };
  }, []);
  return <canvas ref={cv} aria-label="Рукописный набросок" role="img" />;
}
