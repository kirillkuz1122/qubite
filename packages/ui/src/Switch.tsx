import { loop } from '@qubite/motion';
import { useEffect, useRef } from 'react';
import { useSpring } from './useSpring';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

/** Переключатель: точка-ручка вытягивается в сторону движения и собирается на месте. */
export function Switch({ checked, onChange, label }: SwitchProps) {
  const knob = useRef<HTMLElement>(null);
  const tail = useRef(checked ? 1 : 0);
  const draw = () => {
    if (!knob.current) return;
    const w = 1 + Math.abs(tailS.x - headS.x) * 0.9;
    knob.current.style.transform = `translateX(${(headS.x * 22).toFixed(2)}px) scaleX(${w.toFixed(3)})`;
  };
  const headS = useSpring(checked ? 1 : 0, 0.7, draw);
  const tailS = useSpring(checked ? 1 : 0, 0.5, draw);
  useEffect(() => {
    const L = loop();
    const v = checked ? 1 : 0;
    if (tail.current === v) {
      draw();
      return;
    }
    tail.current = v;
    L.to(headS, v);
    const id = setTimeout(() => L.to(tailS, v), 70);
    return () => clearTimeout(id);
  });
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={checked ? 'q-switch q-on' : 'q-switch'}
      onClick={() => onChange(!checked)}
    >
      <i ref={knob} />
    </button>
  );
}
