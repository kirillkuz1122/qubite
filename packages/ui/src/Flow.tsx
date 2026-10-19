/**
 * Перетекающая подсветка: подложка выбранного тянется двумя краями — ведущий лёгкий и убегает вперёд,
 * хвост тяжелее и догоняет. Рисуется тремя кусками (два скруглённых конца и середина),
 * двигается только transform, поэтому скругление не искажается.
 */
import { loop, type Spring } from '@qubite/motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { feelOf, scaled } from './feel';
import { useLook } from './look';

/**
 * Середина подложки — полоска шириной MID, растянутая transform-ом (только transform — без пересчёта
 * раскладки). Раньше полоска была в 1 px с поправкой на дробный масштаб экрана (D-185), но браузеры
 * округляют её по-разному: Chrome на 125 % рисует 1,25 физических пикселя без округления, и поправка
 * удлиняла середину на четверть — она вылезала за край капли, пропадали зазор и скругление; на 150 %
 * середина выходила короче и в капле появлялась «дырка» (D-244). Полоса в 64 px — целое число
 * физических пикселей при 100, 125, 150, 175 и 200 %, а где округление всё же есть, ошибка меньше
 * пикселя на всю длину. Слой маленький — не то что 1000 px, на которых кадры удваивались.
 */
const MID = 64;

export interface FlowHandle {
  /**
   * подвинуть подсветку к отрезку [a, b]; jump — сразу, без движения;
   * row — положение поперёк (другой ряд), если пункты стоят в несколько рядов
   */
  to(a: number, b: number, jump?: boolean, row?: number): void;
  /** вести подсветку пальцем: края ставятся сразу, скорость v (px/с) — для броска */
  hold(a: number, b: number, v?: number): void;
}

export interface FlowOptions {
  /** вдоль какой оси тянется: x — по горизонтали (по умолчанию), y — по вертикали */
  axis?: 'x' | 'y';
  /** класс кусков — для своего цвета подложки */
  className?: string;
}

export function useFlow(cross: number, offset = 0, opts: FlowOptions = {}) {
  const parts = useRef<(HTMLElement | null)[]>([null, null, null]);
  const sized = useRef('');
  const { look } = useLook();
  const [springs] = useState(() => ({
    A: loop().spring(0, 1),
    B: loop().spring(0, 1),
    /** поперёк: переход между рядами */
    C: loop().spring(offset, 1),
  }));
  const y = opts.axis === 'y';

  const paint = useCallback(() => {
    const { A, B, C } = springs;
    const [l, m, rr] = parts.current;
    if (!l || !m || !rr) return;
    const a = A.x;
    const r = Math.min(
      Math.max(0.5, (look.round / 100) * (cross / 2)),
      Math.max(0.5, (B.x - a) / 2),
    );
    const b = Math.max(B.x, a + 2 * r);
    const cap = 2 * r;
    // размеры и скругление меняются редко (узкая подложка, другая форма точки) — пишем только тогда,
    // иначе браузер пересчитывал бы раскладку каждый кадр; в кадре остаётся только transform
    const key = `${r.toFixed(2)}|${cross}|${y}`;
    if (sized.current !== key) {
      sized.current = key;
      const along = y ? 'height' : 'width';
      const across = y ? 'width' : 'height';
      for (const el of [l, rr]) {
        el.style[along] = `${cap}px`;
        el.style[across] = `${cross}px`;
        el.style.borderRadius = `${r}px`;
      }
      m.style[along] = `${MID}px`;
      m.style[across] = `${cross}px`;
    }
    const o = C.x;
    const t = (v: number) => (y ? `translate(${o}px, ${v}px)` : `translate(${v}px, ${o}px)`);
    l.style.transform = t(a);
    rr.style.transform = t(b - cap);
    m.style.transform = `${t(a + r - 0.5)} ${y ? 'scaleY' : 'scaleX'}(${((b - a - cap + 1) / MID).toFixed(5)})`;
  }, [springs, look.round, cross, y]);

  useEffect(() => {
    const draw = loop().render(paint);
    springs.A.onChange = draw;
    springs.B.onChange = draw;
    springs.C.onChange = draw;
    paint();
  }, [springs, paint]);

  const to = useCallback<FlowHandle['to']>(
    (a, b, jump, row = offset) => {
      const { A, B, C } = springs;
      const L = loop();
      if (jump) {
        L.set(A, a);
        L.set(B, b);
        L.set(C, row);
        return;
      }
      // ведущий край лёгкий и убегает вперёд, хвост тяжелее и догоняет (характер «Подложка»)
      const f = feelOf('flow');
      const forward = a > A.goal;
      (forward ? B : A).feel(scaled(f, 0.625));
      (forward ? A : B).feel(scaled(f, 1.375));
      L.to(A, a);
      L.to(B, b);
      if (row !== C.goal) L.to(C, row, scaled(f, 1.25));
    },
    [springs, offset],
  );

  const hold = useCallback<FlowHandle['hold']>(
    (a, b, v = 0) => {
      const L = loop();
      L.hold(springs.A, a, v);
      L.hold(springs.B, b, v);
    },
    [springs],
  );

  const setPart = useCallback(
    (i: number) => (el: HTMLElement | null) => {
      parts.current[i] = el;
      sized.current = '';
    },
    [],
  );
  const node = (
    <span className="q-flow" aria-hidden="true">
      <i ref={setPart(0)} className={opts.className} />
      <i ref={setPart(1)} className={opts.className} />
      <i ref={setPart(2)} className={opts.className} />
    </span>
  );
  /** края A и B — для своих движений (капля Command тянет их по очереди) */
  const edges: { A: Spring; B: Spring } = springs;
  return { node, to, hold, edges };
}
