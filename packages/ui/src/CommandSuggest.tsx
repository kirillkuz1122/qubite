import { MASS } from '@qubite/motion';
import { forwardRef, useEffect, useLayoutEffect, useRef } from 'react';
import { COMMAND_COLOR, type ParsedCommand } from './command';
import type { ColorName } from './tokens';
import { loop, useSpring } from './useSpring';

/** Что ещё можно сделать из строки: открыть раздел, найденное дело, документ, включить тему… */
export interface CommandHit {
  id: string;
  title: string;
  /** где это лежит или что произойдёт: «Planner · сегодня», «включит светлую тему» */
  where: string;
  color: ColorName;
}

export interface CommandSuggestProps {
  /** что поняла строка; null — строки «куда ляжет» нет */
  parsed: ParsedCommand | null;
  /** найденное под строкой «куда ляжет» */
  hits?: readonly CommandHit[];
  /** подпись над найденным: «Найдено», «Недавнее» */
  heading?: string | undefined;
  /** выбранный пункт: 0 — «куда ляжет» (если есть), дальше — найденное; -1 — ничего */
  active?: number;
  /** id списка — для `aria-controls` строки */
  listId?: string;
  /** выбор мышью или пальцем: номер пункта в той же нумерации, что `active` */
  onPick?: (index: number) => void;
  className?: string;
}

/** id пункта для `aria-activedescendant`. */
export const suggestOptionId = (listId: string, index: number) => `${listId}-${index}`;

/**
 * Карточка над строкой Command: что это (дело, мысль, поиск…) и куда ляжет, а под ней — найденное.
 * Вырастает из строки; при смене вида запись пружинит заново; меняется высота — фон дотягивается пружиной.
 */
export const CommandSuggest = forwardRef<HTMLDivElement, CommandSuggestProps>(
  function CommandSuggest(
    { parsed, hits = [], heading, active = -1, listId = 'q-suggest', onPick, className },
    ref,
  ) {
    const bg = useRef<HTMLDivElement>(null);
    const inner = useRef<HTMLDivElement>(null);
    const last = useRef<{
      parsed: ParsedCommand | null;
      hits: readonly CommandHit[];
      heading?: string | undefined;
    }>({ parsed: null, hits: [] });
    const visible = !!parsed || hits.length > 0;
    if (visible) last.current = { parsed, hits, heading };
    const shown = last.current;
    const draw = () => {
      const v = Math.max(0, sv.x);
      if (bg.current)
        bg.current.style.transform = `scale(${(0.2 + 0.8 * Math.min(1.05, v)).toFixed(4)}, ${(Math.min(1.1, v) * sh.x).toFixed(4)})`;
      if (inner.current) inner.current.style.opacity = Math.min(1, Math.max(0, so.x)).toFixed(3);
    };
    const sv = useSpring(0, 0.9, draw);
    const so = useSpring(0, MASS.dot + 0.05, draw);
    // высота фона: был старый размер — тянемся к новому
    const sh = useSpring(1, MASS.pill, draw);
    const kind = useRef<string | null>(null);
    const height = useRef(0);

    const k = parsed?.kind ?? (hits.length ? 'list' : null);
    useEffect(() => {
      const L = loop();
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
    }, [k, sv, so]);

    useLayoutEffect(() => {
      const h = inner.current?.offsetHeight ?? 0;
      const was = height.current;
      height.current = h;
      if (!h || !was || h === was || sv.x < 0.5) return;
      const L = loop();
      L.set(sh, Math.min(3, was / h));
      L.to(sh, 1);
    });

    const opt = (i: number) => ({
      id: suggestOptionId(listId, i),
      role: 'option' as const,
      'aria-selected': active === i,
      className: active === i ? 'q-suggest-opt on' : 'q-suggest-opt',
      // фокус остаётся в строке: на телефоне клавиатура не прячется
      onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
      onClick: () => onPick?.(i),
    });
    const base = shown.parsed ? 1 : 0;

    return (
      <div
        ref={ref}
        className={['q-suggest', className].filter(Boolean).join(' ')}
        data-open={visible || undefined}
      >
        <div ref={bg} className="q-suggest-bg" />
        {/* уходящая карточка доигрывает исчезание со старым текстом, но её уже нет для диктора и пальца */}
        <div
          ref={inner}
          className="q-suggest-in"
          aria-hidden={!visible || undefined}
          inert={!visible}
        >
          <div id={listId} role="listbox" aria-label="Что сделать" className="q-suggest-list">
            {shown.parsed && (
              <div {...opt(0)}>
                <div role="status" aria-live="polite">
                  <div className="q-suggest-k">
                    <span
                      className="q-dot"
                      style={{ background: `var(--q-${COMMAND_COLOR[shown.parsed.kind]})` }}
                    />
                    {shown.parsed.title}
                  </div>
                  <div className="q-suggest-w">
                    → {shown.parsed.where}
                    {shown.parsed.kind === 'task' && <b> · {shown.parsed.when ?? 'без срока'}</b>}
                  </div>
                </div>
                {active === 0 && <kbd>Enter</kbd>}
              </div>
            )}
            {shown.hits.length > 0 && shown.heading && (
              <div className="q-suggest-h" role="presentation">
                {shown.heading}
              </div>
            )}
            {shown.hits.map((h, i) => (
              <div key={h.id} {...opt(base + i)} data-hit={h.id}>
                <span className="q-dot" style={{ background: `var(--q-${h.color})` }} />
                <span className="q-suggest-t">
                  <span className="q-suggest-n">{h.title}</span>
                  <span className="q-suggest-w">{h.where}</span>
                </span>
                {active === base + i && <kbd>Enter</kbd>}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  },
);
