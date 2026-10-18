import { drag, loop, project, rubber } from '@qubite/motion';
import { useEffect, useRef } from 'react';
import { feelOf, scaled } from './feel';
import { useSpring } from './useSpring';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

/** Сколько пикселей проходит ручка от «выкл» до «вкл». */
const TRAVEL = 22;

/**
 * Переключатель: точка-ручка вытягивается в сторону движения и собирается на месте.
 * Ручку можно тянуть пальцем и бросать; у краёв она тянется резинкой. Escape или прокрутка
 * посреди жеста — ручка возвращается, значение не меняется.
 */
export function Switch({ checked, onChange, label }: SwitchProps) {
  const el = useRef<HTMLButtonElement>(null);
  const knob = useRef<HTMLElement>(null);
  const tail = useRef(checked ? 1 : 0);
  const draw = () => {
    if (!knob.current) return;
    const w = 1 + Math.abs(tailS.x - headS.x) * 0.9;
    knob.current.style.transform = `translateX(${(headS.x * TRAVEL).toFixed(2)}px) scaleX(${w.toFixed(3)})`;
  };
  const headS = useSpring(checked ? 1 : 0, 0.7, draw);
  const tailS = useSpring(checked ? 1 : 0, 0.5, draw);
  const latest = useRef({ checked, onChange });
  useEffect(() => {
    latest.current = { checked, onChange };
  });
  /** ручку протащили — щелчок после жеста не считается */
  const dragged = useRef(false);

  const go = (v: number) => {
    const L = loop();
    const f = feelOf('switch');
    L.to(headS, v, f);
    const id = setTimeout(() => L.to(tailS, v, scaled(f, 0.72)), 70);
    return () => clearTimeout(id);
  };

  useEffect(() => {
    const v = checked ? 1 : 0;
    if (tail.current === v) {
      draw();
      return;
    }
    tail.current = v;
    return go(v);
  });

  useEffect(() => {
    const b = el.current;
    if (!b) return;
    const L = loop();
    let from = 0;
    let p = 0;
    const h = drag(b, {
      axis: 'x',
      threshold: 4,
      onDown: () => (dragged.current = false),
      onStart: () => {
        dragged.current = true;
        from = latest.current.checked ? 1 : 0;
      },
      onMove: ({ dx }) => {
        p = rubber(from + dx / TRAVEL, 0, 1, 0.3);
        L.hold(headS, p);
        // хвост догоняет — ручка вытягивается по ходу пальца
        L.to(tailS, p, scaled(feelOf('switch'), 0.72));
      },
      onEnd: ({ vx }) => {
        const next = project(p, vx / TRAVEL, 0.98) > 0.5;
        if (next !== latest.current.checked) latest.current.onChange(next);
        else go(from);
      },
      onCancel: () => go(latest.current.checked ? 1 : 0),
    });
    return () => h.destroy();
    // go трогает только эти же пружины
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headS, tailS]);

  return (
    <button
      ref={el}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={checked ? 'q-switch q-on' : 'q-switch'}
      onClick={(e) => {
        if (dragged.current && e.detail > 0) {
          dragged.current = false;
          return;
        }
        onChange(!checked);
      }}
    >
      <i ref={knob} />
    </button>
  );
}
