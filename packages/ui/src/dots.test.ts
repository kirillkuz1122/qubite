import { afterEach, describe, expect, it, vi } from 'vitest';
import { DotEngine } from './dots/engine';

/** Холст с подставным 2d-контекстом: считаем, сколько раз его перерисовали. */
function canvas() {
  const cv = document.createElement('canvas');
  const clears = vi.fn();
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (o, k) => (k === 'clearRect' ? clears : k in o ? o[k as string] : () => {}),
    set: (o, k, v) => ((o[k as string] = v), true),
  });
  cv.getContext = (() => ctx) as unknown as typeof cv.getContext;
  return { cv, clears };
}

const engines: DotEngine[] = [];
afterEach(() => engines.splice(0).forEach((e) => e.destroy()));

describe('холст с точками бережёт кадры (DS-010)', () => {
  it('точки стоят — холст не перерисовывается; сдвинулись — рисуется снова', () => {
    const { cv, clears } = canvas();
    const e = new DotEngine(cv, { ground: '#000', light: '#fff', repel: 0 });
    engines.push(e);
    const d = e.dot(10, 10, '#fff', 2);
    e.frame(1, 1 / 60);
    expect(clears).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) e.frame(1 + i / 60, 1 / 60);
    expect(clears).toHaveBeenCalledTimes(1);
    d.hx = 30; // точку позвали в другое место — она едет, холст рисуется
    e.frame(2, 1 / 60);
    expect(clears).toHaveBeenCalledTimes(2);
  });

  it('холст за экраном не считает и не рисует', () => {
    const { cv, clears } = canvas();
    const e = new DotEngine(cv, { ground: '#000', light: '#fff', repel: 0 });
    engines.push(e);
    e.dot(10, 10, '#fff', 2, [0, 0]);
    e.on = false;
    for (let i = 0; i < 5; i++) e.frame(1 + i / 60, 1 / 60);
    expect(clears).not.toHaveBeenCalled();
    e.on = true;
    e.frame(2, 1 / 60);
    expect(clears).toHaveBeenCalledTimes(1);
  });
});
