import { loop } from '@qubite/motion';
import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { feelOf } from './feel';
import { useFlip } from './flip';
import { Presence } from './Presence';
import { useSlide } from './Slide';
import { useSpring } from './useSpring';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  /** короткое объяснение простыми словами */
  hint?: ReactNode;
  /** вариант виден, но выбрать его пока нельзя; почему — в `note` */
  disabled?: boolean;
  note?: string;
  /** настройки варианта: появляются прямо под ним, пока он выбран (поля, кнопки) */
  detail?: ReactNode;
}

export interface ChoiceProps<T extends string> {
  /** название группы для читалки */
  label: string;
  /** выбранный вариант; `null` — пока неизвестно */
  value: T | null;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
  /** выбор сохраняется — другой пока не выбрать */
  busy?: boolean;
}

/**
 * Выбор одного варианта из нескольких с объяснением у каждого (Segmented — для коротких подписей,
 * Choice — когда каждому варианту нужна строка пояснения). Подложка выбранного перетекает
 * к новому (useSlide), точка в кружке вырастает пружиной. Недоступные варианты видны
 * полупрозрачными, с причиной. Стрелки ↑↓ выбирают соседний доступный вариант.
 * У варианта могут быть свои настройки (`detail`): они проявляются под ним (Presence),
 * а варианты ниже доезжают пружиной (useFlip).
 */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  busy = false,
}: ChoiceProps<T>) {
  const box = useRef<HTMLDivElement>(null);
  const btns = useRef(new Map<T, HTMLButtonElement>());
  const { node, to, hide } = useSlide(64, 'q-slide q-choice-slide');
  const first = useRef(true);
  /* настройки варианта появились или ушли — варианты ниже доезжают на новое место */
  const [moved, setMoved] = useState(0);
  useFlip(box, moved);
  const relayout = useCallback(() => setMoved((n) => n + 1), []);

  useLayoutEffect(() => {
    const place = (jump: boolean) => {
      const b = value === null ? undefined : btns.current.get(value);
      if (b) to(b.offsetTop, b.offsetHeight, jump);
      else hide(jump);
    };
    place(first.current);
    first.current = false;
    const el = box.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    let width = el.offsetWidth;
    const ro = new ResizeObserver(() => {
      // ширина поменялась — строки переносятся иначе: подложка встаёт на место сразу;
      // только высота (раскрылись настройки варианта) — доезжает вместе с вариантом
      const w = el.offsetWidth;
      place(w !== width);
      width = w;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, to, hide]);

  const open = options.filter((o) => !o.disabled);
  const tabbable = open.some((o) => o.value === value) ? value : (open[0]?.value ?? null);
  const pick = (o: ChoiceOption<T>) => {
    if (o.disabled || busy || o.value === value) return;
    onChange(o.value);
  };
  const arrows = (e: KeyboardEvent, from: T) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step || open.length === 0) return;
    e.preventDefault();
    const i = open.findIndex((o) => o.value === from);
    const next = open[(i + step + open.length) % open.length]!;
    btns.current.get(next.value)?.focus();
    pick(next);
  };

  return (
    <div
      className="q-choice"
      role="radiogroup"
      aria-label={label}
      aria-busy={busy || undefined}
      ref={box}
    >
      {node}
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Fragment key={o.value}>
            <button
              data-flip={o.value}
              ref={(el) => {
                if (el) btns.current.set(o.value, el);
                else btns.current.delete(o.value);
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={o.disabled || undefined}
              tabIndex={o.value === tabbable ? 0 : -1}
              className={on ? 'q-choice-opt q-on' : 'q-choice-opt'}
              onClick={() => pick(o)}
              onKeyDown={(e) => arrows(e, o.value)}
            >
              <Mark on={on} />
              <span className="q-choice-text">
                <span className="q-choice-label">{o.label}</span>
                {o.hint && <small>{o.hint}</small>}
                {o.note && <small className="q-choice-note">{o.note}</small>}
              </span>
            </button>
            {o.detail !== undefined && (
              <Presence
                show={on && !o.disabled}
                className="q-choice-detail"
                flip={`${o.value}:detail`}
                onLayout={relayout}
              >
                <div role="group" aria-label={o.label}>
                  {o.detail}
                </div>
              </Presence>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/** Кружок с точкой: выбран — точка вырастает, снят — сжимается. */
function Mark({ on }: { on: boolean }) {
  const dot = useRef<HTMLElement>(null);
  // начальный вид — один раз; дальше точку двигает только пружина
  const [start] = useState(() => (on ? 1 : 0));
  const s = useSpring(on ? 1 : 0, 0.5, (x) => {
    if (dot.current) dot.current.style.transform = `scale(${Math.max(0, x).toFixed(3)})`;
  });
  useLayoutEffect(() => {
    loop().to(s, on ? 1 : 0, feelOf('switch'));
  }, [on, s]);
  return (
    <span className="q-choice-mark" aria-hidden="true">
      <i ref={dot} style={{ transform: `scale(${start})` }} />
    </span>
  );
}
