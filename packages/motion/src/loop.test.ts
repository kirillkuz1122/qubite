import { describe, expect, it } from 'vitest';
import { Loop, type LoopHost } from './loop';
import { dampingRatio, MASS, type Feel } from './spring';

/** Цикл с ручным временем: кадры крутим сами, по 1/60 секунды. */
function manual(reduced = false) {
  const queue: ((now: number) => void)[] = [];
  const host: LoopHost = {
    requestFrame: (cb) => queue.push(cb),
    hidden: () => false,
    reducedMotion: () => reduced,
  };
  const loop = new Loop(host);
  let now = 0;
  function run(seconds: number) {
    const end = now + seconds * 1000;
    while (now < end && queue.length) {
      now += 1000 / 60;
      queue.shift()!(now);
    }
  }
  return { loop, run, queue };
}

/** Через сколько секунд пружина остановится (или Infinity за 10 с). */
function settleTime(mass: number) {
  const { loop, run } = manual();
  const s = loop.spring(0, mass);
  loop.to(s, 100);
  for (let t = 0; t < 10; t += 1 / 60) {
    run(1 / 60);
    if (!loop.busy) return t;
  }
  return Infinity;
}

describe('одна физика', () => {
  it('пружина приходит ровно в цель и цикл засыпает', () => {
    const { loop, run, queue } = manual();
    const s = loop.spring(0, MASS.row);
    loop.to(s, 42);
    run(3);
    expect(s.x).toBe(42);
    expect(s.v).toBe(0);
    expect(loop.busy).toBe(false);
    expect(queue.length).toBe(0);
  });

  it('тяжёлое движется дольше лёгкого: помощник мягче кнопки', () => {
    expect(settleTime(MASS.companion)).toBeGreaterThan(settleTime(MASS.dot));
  });

  it('по пути пружина перелетает цель — так выглядит «живой» отскок', () => {
    const { loop, run } = manual();
    let max = 0;
    const s = loop.spring(0, MASS.row, (x) => (max = Math.max(max, x)));
    loop.to(s, 1);
    run(2);
    expect(max).toBeGreaterThan(1);
    expect(max).toBeLessThan(1.3);
  });

  it('при «меньше движения» всё встаёт сразу, толчки не работают', () => {
    const { loop, queue } = manual(true);
    const seen: number[] = [];
    const s = loop.spring(0, 1, (x) => seen.push(x));
    loop.to(s, 5);
    loop.kick(s, 300);
    expect(s.x).toBe(5);
    expect(seen).toEqual([5]);
    expect(queue.length).toBe(0);
  });

  it('несколько пружин за кадр — одна отрисовка', () => {
    const { loop, run } = manual();
    let draws = 0;
    const draw = loop.render(() => draws++);
    const a = loop.spring(0, 1, draw);
    const b = loop.spring(0, 1, draw);
    loop.to(a, 1);
    loop.to(b, 1);
    run(1 / 60);
    expect(draws).toBe(1);
  });

  it('живость: при 50 % движение идёт вдвое дольше, путь тот же', () => {
    const time = (tempo: number) => {
      const { loop, run } = manual();
      loop.tempo = tempo;
      const s = loop.spring(0, MASS.row);
      loop.to(s, 100);
      let t = 0;
      while (loop.busy && t < 10) {
        run(1 / 60);
        t += 1 / 60;
      }
      expect(s.x).toBe(100);
      return t;
    };
    expect(time(0.5) / time(1)).toBeGreaterThan(1.8);
    expect(time(0.5) / time(1)).toBeLessThan(2.2);
  });

  it('«меньше движения» из настроек сильнее системы', () => {
    const { loop } = manual(false);
    expect(loop.reduced).toBe(false);
    loop.reduce = true;
    expect(loop.reduced).toBe(true);
    const sys = manual(true).loop;
    sys.reduce = false;
    expect(sys.reduced).toBe(false);
  });

  it('палец держит пружину: цикл спит, а после отпускания бросок продолжается', () => {
    const { loop, run, queue } = manual();
    const s = loop.spring(0, MASS.pill);
    loop.hold(s, 30, 900);
    expect(queue.length).toBe(0);
    expect(s.x).toBe(30);
    loop.to(s, 40);
    run(1 / 60);
    expect(s.x).toBeGreaterThan(30); // скорость броска не пропала
    run(3);
    expect(s.x).toBe(40);
    expect(loop.busy).toBe(false);
  });
});

describe('характер: масса и упругость', () => {
  const peak = (feel: Feel) => {
    const { loop, run } = manual();
    let max = 0;
    const s = loop.spring(0, 1, (x) => (max = Math.max(max, x)));
    loop.to(s, 1, feel);
    run(3);
    expect(s.x).toBe(1);
    return max;
  };

  it('без отскока при упругости ≥ 1, с отскоком — меньше', () => {
    const tight = { mass: 0.45, damping: 22 };
    const bouncy = { mass: 0.7, damping: 11 };
    expect(dampingRatio(tight)).toBeGreaterThanOrEqual(1);
    expect(peak(tight)).toBeLessThanOrEqual(1.0001);
    expect(peak(bouncy)).toBeGreaterThan(1.15);
  });

  it('характер надевается в to() и остаётся у пружины', () => {
    const { loop } = manual();
    const s = loop.spring(0, 1);
    loop.to(s, 1, { mass: 0.6, damping: 12 });
    expect(s.m).toBe(0.6);
    expect(s.c).toBe(12);
  });
});
