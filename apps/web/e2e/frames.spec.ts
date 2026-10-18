import { expect, test } from '@playwright/test';

/*
 * DS-002: плавность кадров при замедлении процессора ×4 (как слабый телефон).
 * Отдельный проект «frames» в playwright.config.ts: идёт после остальных тестов и в одиночку,
 * иначе соседние браузеры отнимают процессор и замер нечестный. Замедление CPU есть только в Chromium.
 */

test('кадры не рвутся при замедлении процессора ×4', async ({ page }, info) => {
  await page.goto('/design');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.getByRole('radiogroup', { name: 'Раздел' }).scrollIntoViewIfNeeded();
  // меряем длительность кадров, пока подложка ездит туда-сюда, а ручка переключается
  const frames = await page.evaluate(async () => {
    const out: number[] = [];
    let last = performance.now();
    let on = true;
    const tick = (now: number) => {
      out.push(now - last);
      last = now;
      if (on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const radios = [
      ...document.querySelectorAll<HTMLButtonElement>('[aria-label="Раздел"] button'),
    ];
    const sw = document.querySelector<HTMLButtonElement>('[aria-label="Пример переключателя"]')!;
    for (let i = 0; i < 8; i++) {
      radios[i % 2 ? 0 : radios.length - 1]!.click();
      sw.click();
      await new Promise((r) => setTimeout(r, 250));
    }
    on = false;
    return out.slice(5);
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  frames.sort((a, b) => a - b);
  const p = (q: number) => frames[Math.floor(frames.length * q)]!;
  const long = frames.filter((f) => f > 50).length / frames.length;
  info.annotations.push({
    type: 'кадры',
    description: `медиана ${p(0.5).toFixed(1)} мс, 95% ${p(0.95).toFixed(1)} мс, длинных ${(long * 100).toFixed(1)}%`,
  });
  console.log(info.annotations.at(-1)?.description);
  expect(p(0.5)).toBeLessThan(20);
  expect(long).toBeLessThan(0.05);
});
