import type { Page } from '@playwright/test';

type Point = { x: number; y: number };

export async function touchInput(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  let at: Point;
  return {
    async start(point: Point) {
      at = point;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    },
    async move(to: Point) {
      const from = at;
      for (const progress of [1 / 3, 2 / 3, 1]) {
        const point = {
          x: from.x + (to.x - from.x) * progress,
          y: from.y + (to.y - from.y) * progress,
        };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
      }
      at = to;
    },
    async end() {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
  };
}
