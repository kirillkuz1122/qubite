import { MASS } from '@qubite/motion';
import { forwardRef, useEffect, useRef } from 'react';
import { COMMAND_COLOR, type ParsedCommand } from './command';
import { loop, useSpring } from './useSpring';

export interface CommandSuggestProps {
  /** что поняла строка; null — карточка прячется */
  parsed: ParsedCommand | null;
  className?: string;
}

/**
 * Карточка над строкой Command: что это (дело, мысль, поиск…) и куда ляжет.
 * Вырастает из строки, при смене вида запись пружинит заново.
 */
export const CommandSuggest = forwardRef<HTMLDivElement, CommandSuggestProps>(
  function CommandSuggest({ parsed, className }, ref) {
    const bg = useRef<HTMLDivElement>(null);
    const inner = useRef<HTMLDivElement>(null);
    const last = useRef<ParsedCommand | null>(null);
    if (parsed) last.current = parsed;
    const shown = parsed ?? last.current;
    const draw = () => {
      const v = Math.max(0, sv.x);
      if (bg.current)
        bg.current.style.transform = `scale(${(0.2 + 0.8 * Math.min(1.05, v)).toFixed(4)}, ${Math.min(1.1, v).toFixed(4)})`;
      if (inner.current) inner.current.style.opacity = Math.min(1, Math.max(0, so.x)).toFixed(3);
    };
    const sv = useSpring(0, 0.9, draw);
    const so = useSpring(0, MASS.dot + 0.05, draw);
    const kind = useRef<string | null>(null);
    useEffect(() => {
      const L = loop();
      const k = parsed?.kind ?? null;
      if (k === kind.current) return;
      kind.current = k;
      if (!k) {
        L.to(so, 0);
        L.to(sv, 0);
        return;
      }
      if (sv.x > 0.5) sv.x = 0.7;
      L.to(sv, 1);
      L.set(so, 0.2);
      L.to(so, 1);
    }, [parsed, sv, so]);
    return (
      <div ref={ref} className={['q-suggest', className].filter(Boolean).join(' ')}>
        <div ref={bg} className="q-suggest-bg" />
        <div ref={inner} className="q-suggest-in" role="status" aria-live="polite">
          {shown && (
            <>
              <div>
                <div className="q-suggest-k">
                  <span
                    className="q-dot"
                    style={{ background: `var(--q-${COMMAND_COLOR[shown.kind]})` }}
                  />
                  {shown.title}
                </div>
                <div className="q-suggest-w">
                  → {shown.where}
                  {shown.kind === 'task' && <b> · {shown.when ?? 'без срока'}</b>}
                </div>
              </div>
              <kbd>Enter</kbd>
            </>
          )}
        </div>
      </div>
    );
  },
);
