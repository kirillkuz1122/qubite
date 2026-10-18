/**
 * Перетекающая подсветка: подложка выбранного тянется двумя краями — ведущий лёгкий и убегает вперёд,
 * хвост тяжелее и догоняет. Рисуется тремя кусками (два скруглённых конца и середина),
 * двигается только transform, поэтому скругление не искажается.
 */
import { loop } from '@qubite/motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLook } from './look';

export interface FlowHandle {
  /** подвинуть подсветку к отрезку [a, b]; jump — сразу, без движения */
  to(a: number, b: number, jump?: boolean): void;
}

export function useFlow(cross: number, offset = 0) {
  const parts = useRef<(HTMLElement | null)[]>([null, null, null]);
  const { look } = useLook();
  const [springs] = useState(() => ({ A: loop().spring(0, 1), B: loop().spring(0, 1) }));

  const paint = useCallback(() => {
    const { A, B } = springs;
    const [l, m, rr] = parts.current;
    if (!l || !m || !rr) return;
    const a = A.x;
    const r = Math.min(
      Math.max(0.5, (look.round / 100) * (cross / 2)),
      Math.max(0.5, (B.x - a) / 2),
    );
    const b = Math.max(B.x, a + 2 * r);
    const cap = 2 * r;
    for (const el of [l, rr]) {
      el.style.width = `${cap}px`;
      el.style.height = `${cross}px`;
      el.style.borderRadius = `${r}px`;
    }
    m.style.width = '1px';
    m.style.height = `${cross}px`;
    l.style.transform = `translate(${a}px, ${offset}px)`;
    rr.style.transform = `translate(${b - cap}px, ${offset}px)`;
    m.style.transform = `translate(${a + r - 0.5}px, ${offset}px) scaleX(${(b - a - cap + 1).toFixed(2)})`;
  }, [springs, look.round, cross, offset]);

  useEffect(() => {
    const draw = loop().render(paint);
    springs.A.onChange = draw;
    springs.B.onChange = draw;
    paint();
  }, [springs, paint]);

  const to = useCallback<FlowHandle['to']>(
    (a, b, jump) => {
      const { A, B } = springs;
      const L = loop();
      if (jump) {
        L.set(A, a);
        L.set(B, b);
        return;
      }
      const forward = a > A.goal;
      (forward ? B : A).m = 0.5;
      (forward ? A : B).m = 1.1;
      L.to(A, a);
      L.to(B, b);
    },
    [springs],
  );

  const setPart = useCallback(
    (i: number) => (el: HTMLElement | null) => {
      parts.current[i] = el;
    },
    [],
  );
  const node = (
    <span className="q-flow" aria-hidden="true">
      <i ref={setPart(0)} />
      <i ref={setPart(1)} />
      <i ref={setPart(2)} />
    </span>
  );
  return { node, to };
}
