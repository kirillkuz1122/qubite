import { expect, test, type Locator, type Page } from '@playwright/test';

/* DS-002: живые элементы — жесты, бросок, отмена жеста, настройки ощущений, плавность кадров */

/** Протащить мышью от центра элемента на dx; escape — нажать Escape посреди жеста. */
async function dragBy(
  page: Page,
  el: Locator,
  dx: number,
  o: { from?: number; escape?: boolean } = {},
) {
  await el.scrollIntoViewIfNeeded();
  const box = (await el.boundingBox())!;
  const x = box.x + (o.from ?? box.width / 2);
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y);
  if (o.escape) await page.keyboard.press('Escape');
  await page.mouse.up();
}

test('переключатель можно протащить, а Escape посреди жеста возвращает ручку', async ({ page }) => {
  await page.goto('/design');
  const sw = page.getByRole('switch', { name: 'Пример переключателя' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await dragBy(page, sw, 30, { from: 14, escape: true });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await dragBy(page, sw, 30, { from: 14 });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
});

test('подложку сегментов можно перетащить к дальнему пункту, Escape — отмена', async ({ page }) => {
  await page.goto('/design');
  const group = page.getByRole('radiogroup', { name: 'Раздел' });
  const first = group.getByRole('radio', { name: 'Сегодня' });
  const docs = group.getByRole('radio', { name: 'Docs' });
  const fb = (await first.boundingBox())!;
  const db = (await docs.boundingBox())!;
  const dx = db.x + db.width / 2 - (fb.x + fb.width / 2);
  await dragBy(page, first, dx, { escape: true });
  await expect(first).toHaveAttribute('aria-checked', 'true');
  await dragBy(page, first, dx);
  await expect(docs).toHaveAttribute('aria-checked', 'true');
  // тап по дальнему пункту и в другой ряд
  const rows = page.getByRole('radiogroup', { name: 'Модуль' });
  await rows.getByRole('radio', { name: 'Деньги' }).click();
  await expect(rows.getByRole('radio', { name: 'Деньги' })).toHaveAttribute('aria-checked', 'true');
});

test('характер элемента выбирается и запоминается', async ({ page }) => {
  await page.goto('/design');
  const pick = page
    .getByRole('radiogroup', { name: 'Характер: Кнопка' })
    .getByRole('radio', { name: 'Собранный' });
  await pick.click();
  await page.reload();
  await expect(pick).toHaveAttribute('aria-checked', 'true');
});

test('настройки движения: живость, облегчённый режим, меньше движения', async ({ page }) => {
  await page.goto('/settings');
  const tempo = page.getByRole('slider', { name: 'Живость' });
  await tempo.fill('130');
  await expect(page.getByText('130%')).toBeVisible();
  await page.getByRole('switch', { name: 'Облегчённый режим' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-lite', '');
  await page
    .getByRole('radiogroup', { name: 'Меньше движения' })
    .getByRole('radio', { name: 'Да' })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'less');
  await page.reload();
  await expect(tempo).toHaveValue('130');
  await expect(page.locator('html')).toHaveAttribute('data-lite', '');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'less');
});

test('капля: нажатие в любом месте доли раздела переключает раздел', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1280) >= 900, 'капля — только на телефоне');
  await page.setViewportSize({ width: 820, height: 780 });
  await page.goto('/today');
  const dock = page.getByRole('navigation', { name: 'Разделы' });
  const inbox = dock.getByRole('button', { name: 'Входящие' });
  const ib = (await inbox.boundingBox())!;
  const slot = await dock.evaluate((el) => parseFloat(el.style.getPropertyValue('--q-slot')));
  // не по иконке, а у края доли «Входящих»
  await page.mouse.click(ib.x + ib.width / 2 + slot * 0.45, ib.y + ib.height / 2);
  await expect(page).toHaveURL(/\/inbox$/);
});

test('подсказка Прото уходит плавно, дела ниже доезжают на место', async ({ page }) => {
  await page.goto('/today');
  const tip = page.locator('.tip');
  await expect(tip).toBeVisible();
  // нажимаем и сразу смотрим: подсказка ещё на месте и тает, а не пропадает в тот же кадр
  const fading = await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Позже')!.click();
    const t = document.querySelector('.tip');
    return !!t;
  });
  expect(fading).toBe(true);
  await expect(tip).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Дела' })).toBeAttached();
});

test('капля: подсветку можно перетащить, а быстрый свайп открывает соседний раздел', async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 1280) >= 900, 'капля — только на телефоне');
  await page.goto('/today');
  const dock = page.getByRole('navigation', { name: 'Разделы' });
  const today = (await dock.getByRole('button', { name: 'Сегодня' }).boundingBox())!;
  const planner = (await dock.getByRole('button', { name: 'Planner' }).boundingBox())!;
  const y = today.y + today.height / 2;
  // медленно тащим подсветку с «Сегодня» на Planner
  await page.mouse.move(today.x + today.width / 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++)
    await page.mouse.move(today.x + today.width / 2 + ((planner.x - today.x) * i) / 12, y);
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect(page).toHaveURL(/\/planner$/);
  // быстрый короткий свайп влево — соседний раздел
  const pb = (await dock.getByRole('button', { name: 'Planner' }).boundingBox())!;
  await page.mouse.move(pb.x + pb.width / 2, y);
  await page.mouse.down();
  for (const dx of [10, 20, 30]) {
    await page.waitForTimeout(16); // как кадры настоящего пальца: скорость считается по времени
    await page.mouse.move(pb.x + pb.width / 2 - dx, y);
  }
  await page.mouse.up();
  await expect(page).toHaveURL(/\/inbox$/);
});

test('микрофон не сворачивает строку Command', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1280) >= 900, 'микрофон — только на телефоне');
  await page.goto('/today');
  await page.getByRole('button', { name: 'Открыть Command' }).click();
  const input = page.getByRole('combobox', { name: 'Строка Command' });
  await expect(input).toBeFocused();
  await page.getByRole('button', { name: 'Голосом — скоро' }).click();
  await expect(input).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Разделы' })).toHaveClass(/q-open/);
});

test('своя прокрутка: системной полосы нет, по точке у края — к заголовку', async ({ page }) => {
  await page.goto('/design');
  await expect(page.locator('html')).toHaveClass(/q-own-scroll/);
  const edge = page.getByRole('navigation', { name: 'Заголовки страницы' });
  const label = edge.getByRole('button', { name: 'ХАРАКТЕРЫ' });
  await expect(label).toBeAttached();
  // зажали край — линии разложились ровно, нажали на название — страница едет к заголовку
  const box = (await edge.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await expect(edge).toHaveClass(/q-edge-open/);
  await label.click();
  await expect
    .poll(() =>
      page
        .getByRole('heading', { name: 'ХАРАКТЕРЫ' })
        .evaluate((h) => h.parentElement!.getBoundingClientRect().top),
    )
    .toBeLessThan(200);
});
