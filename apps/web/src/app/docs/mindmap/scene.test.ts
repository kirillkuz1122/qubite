import { describe, expect, it } from 'vitest';
import type { Layout } from './layout';
import { Scene } from './scene';

const box = (id: string) => ({ id, x: 10, y: 20, w: 50, h: 30, side: 'r' as const, depth: 1 });

describe('сцена mind map', () => {
  it('ref нового узла, пришедший раньше sync, не теряется', () => {
    const scene = new Scene();
    const el = document.createElement('div');
    // React зовёт ref нового узла до useLayoutEffect родителя, где идёт sync.
    scene.node('a', el);
    const layout = {
      boxes: new Map([['a', box('a')]]),
      edges: [],
      bounds: { x: 0, y: 0, w: 100, h: 100 },
    } as unknown as Layout;
    scene.sync(layout, new Map([['a', null]]));
    const item = (scene as unknown as { items: Map<string, { el: HTMLElement | null }> }).items.get(
      'a',
    );
    expect(item?.el).toBe(el);
    // Узел ушёл из DOM — ссылка снимается.
    scene.node('a', null);
    expect(item?.el).toBeNull();
  });
});
