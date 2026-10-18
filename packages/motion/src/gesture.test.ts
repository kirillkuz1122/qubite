import { describe, expect, it } from 'vitest';
import { drag, project, rubber, Tracker, type DragEnd } from './gesture';

describe('резинка у края', () => {
  it('внутри границ — как есть, за ними — всё туже и не дальше dim', () => {
    expect(rubber(30, 0, 100)).toBe(30);
    const a = rubber(120, 0, 100, 60);
    const b = rubber(200, 0, 100, 60);
    const c = rubber(10_000, 0, 100, 60);
    expect(a).toBeGreaterThan(100);
    expect(a).toBeLessThan(120);
    expect(b - 100).toBeGreaterThan(a - 100);
    expect(b - 100).toBeLessThan((200 - 100) / 2);
    expect(c).toBeLessThan(160);
    expect(rubber(-20, 0, 100)).toBeLessThan(0);
    expect(rubber(-20, 0, 100)).toBeGreaterThan(-20);
  });
});

describe('бросок', () => {
  it('скорость пальца считается по последним 100 мс', () => {
    const t = new Tracker();
    t.reset(0, 0, 0);
    for (let i = 1; i <= 20; i++) t.add(i * 10, 0, i * 16); // 10 px за 16 мс
    expect(t.velocity().vx).toBeCloseTo(625, 0);
    expect(t.velocity().vy).toBe(0);
  });

  it('брошенное докатывается дальше в сторону броска', () => {
    expect(project(50, 0)).toBe(50);
    expect(project(50, 1000)).toBeGreaterThan(100);
    expect(project(50, -1000)).toBeLessThan(0);
  });
});

/** Ненастоящий элемент: только события и захват пальца. */
function fakeEl() {
  const el = new EventTarget() as EventTarget & {
    setPointerCapture(id: number): void;
    releasePointerCapture(id: number): void;
    captured: number | null;
  };
  el.captured = null;
  el.setPointerCapture = (id) => (el.captured = id);
  el.releasePointerCapture = () => (el.captured = null);
  let now = 0;
  const fire = (type: string, x: number, y = 0, dt = 16) => {
    now += dt;
    const e = Object.assign(new Event(type, { cancelable: true }), {
      clientX: x,
      clientY: y,
      pointerId: 1,
      button: 0,
    });
    el.dispatchEvent(e);
  };
  return { el, fire, now: () => now };
}

function setup(axis: 'x' | 'y' | 'both' = 'x') {
  const f = fakeEl();
  const log: string[] = [];
  let end: DragEnd | null = null;
  const h = drag(f.el as unknown as HTMLElement, {
    axis,
    now: f.now,
    onStart: () => log.push('start'),
    onMove: (m) => log.push(`move ${m.dx}`),
    onEnd: (e) => {
      log.push('end');
      end = e;
    },
    onTap: () => log.push('tap'),
    onCancel: () => log.push('cancel'),
  });
  return { ...f, h, log, end: () => end };
}

describe('перетаскивание', () => {
  it('короткое касание — нажатие, а не перетаскивание', () => {
    const g = setup();
    g.fire('pointerdown', 10);
    g.fire('pointermove', 12);
    g.fire('pointerup', 12);
    expect(g.log).toEqual(['tap']);
  });

  it('перетаскивание сообщает смещение и скорость броска, палец захвачен', () => {
    const g = setup();
    g.fire('pointerdown', 0);
    for (let x = 10; x <= 80; x += 10) g.fire('pointermove', x);
    expect(g.h.active).toBe(true);
    expect(g.el.captured).toBe(1);
    g.fire('pointerup', 90);
    expect(g.log[0]).toBe('start');
    expect(g.log.at(-1)).toBe('end');
    expect(g.end()?.dx).toBe(90);
    expect(g.end()?.vx).toBeGreaterThan(500);
    expect(g.h.active).toBe(false);
    expect(g.el.captured).toBe(null);
  });

  it('отмена: система забрала палец — onCancel, без onEnd и без нажатия', () => {
    const g = setup();
    g.fire('pointerdown', 0);
    g.fire('pointermove', 30);
    g.fire('pointercancel', 30);
    g.fire('pointerup', 30);
    expect(g.log).toEqual(['start', 'move 30', 'cancel']);
  });

  it('отмена вручную (Escape) посреди жеста', () => {
    const g = setup();
    g.fire('pointerdown', 0);
    g.fire('pointermove', 30);
    g.h.cancel();
    g.fire('pointermove', 60);
    g.fire('pointerup', 60);
    expect(g.log).toEqual(['start', 'move 30', 'cancel']);
  });

  it('палец пошёл в другую ось — отдаём жест прокрутке', () => {
    const g = setup('x');
    g.fire('pointerdown', 0, 0);
    g.fire('pointermove', 2, 20);
    g.fire('pointermove', 40, 20);
    g.fire('pointerup', 40, 20);
    expect(g.log).toEqual([]);
  });

  it('вложенная кнопка теряет палец — это не отмена жеста', () => {
    const g = setup();
    g.fire('pointerdown', 0);
    g.fire('pointermove', 30);
    const child = new EventTarget();
    // событие с чужой целью: как будто всплыло от вложенной кнопки
    const e = Object.assign(new Event('lostpointercapture'), { pointerId: 1 });
    Object.defineProperty(e, 'target', { value: child });
    g.el.dispatchEvent(e);
    g.fire('pointerup', 40);
    expect(g.log.at(-1)).toBe('end');
    expect(g.log).not.toContain('cancel');
  });
});
