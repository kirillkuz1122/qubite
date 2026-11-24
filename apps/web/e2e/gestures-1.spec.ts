import { expect, test, type Locator, type Page } from '@playwright/test';
import { shot, touchInput } from './gesture-input';
import { goSection } from './nav';
import { mockSync } from './sync-mock';

async function openBell(page: Page) {
  await page.getByRole('button', { name: /^Уведомления/ }).click();
  const panel = page.getByRole('dialog', { name: 'Уведомления' });
  await expect(panel).toBeVisible();
  return panel;
}

function notice(i: number) {
  return {
    id: `n${i}`,
    kind: 'reminder',
    origin: 'owner',
    title: `Напоминание ${i}`,
    body: 'Список дел на сегодня',
    why: '',
    held: false,
    channel: null,
    created_at: new Date().toISOString(),
    read_at: null,
  };
}

async function translation(locator: Locator, axis: 'x' | 'y') {
  return locator.evaluate((node, dir) => {
    const value = getComputedStyle(node).transform;
    const matrix = value === 'none' ? new DOMMatrix() : new DOMMatrix(value);
    return dir === 'x' ? matrix.m41 : matrix.m42;
  }, axis);
}

test.describe('MOB-002, часть 1', { tag: '@gestures-touch' }, () => {
  for (const theme of ['dark', 'light'] as const) {
    test.describe(theme, () => {
      test.use({
        viewport: { width: 360, height: 780 },
        hasTouch: true,
        isMobile: true,
        reducedMotion: 'no-preference',
      });

      test.beforeEach(async ({ page }) => {
        await page.addInitScript(
          (value) => localStorage.setItem('qubite.look.v1', JSON.stringify({ theme: value })),
          theme,
        );
      });

      test('Назад: прямой вход, возврат пальца и переход', async ({ page }, info) => {
        const server = await mockSync(page);
        const date = new Date().toLocaleDateString('sv-SE');
        for (let i = 0; i < 20; i++) server.addTask(`Дело на сегодня ${i}`, { due_date: date });
        await page.goto('/home');
        const main = page.locator('.main');
        const touch = await touchInput(page);
        const edge = { x: 32, y: 280 };
        await page.getByRole('heading', { name: 'Главная', exact: true }).waitFor();
        await touch.start(edge);
        await touch.move({ x: 220, y: edge.y });
        await expect(main).toHaveCSS('transform', 'none');
        await touch.end();
        await expect(page).toHaveURL(/\/home$/);

        await goSection(page, 'Сегодня');
        const screen = page.locator('[data-screen="today"]');
        await expect(screen.getByText('Дело на сегодня 19', { exact: true })).toBeVisible();
        await expect(screen).toHaveCSS('transform', 'none');
        await touch.start({ x: 32, y: 550 });
        await touch.move({ x: 32, y: 320 });
        await touch.end();
        await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
        await expect(main).toHaveCSS('transform', 'none');
        await expect(page).toHaveURL(/\/today$/);
        // Инерция прокрутки должна закончиться, иначе она утащит страницу вниз после scrollTo.
        await expect
          .poll(async () => {
            const before = await page.evaluate(() => scrollY);
            await page.waitForTimeout(150);
            return before === (await page.evaluate(() => scrollY));
          })
          .toBe(true);
        await page.evaluate(() => scrollTo(0, 0));

        await touch.start(edge);
        await touch.move({ x: 195, y: edge.y });
        await expect.poll(() => translation(main, 'x')).toBeGreaterThan(150);
        await shot(page, info, `back-drag-${theme}`);
        await touch.move(edge);
        await expect(main).toHaveCSS('transform', 'none');
        await touch.end();
        await expect(page).toHaveURL(/\/today$/);

        await touch.start(edge);
        await touch.move({ x: 220, y: edge.y });
        await touch.end();
        await expect(page).toHaveURL(/\/home$/);
      });

      test('Нижняя шторка: возврат, прокрутка и закрытие', async ({ page }, info) => {
        await mockSync(page);
        await page.goto('/today');
        await goSection(page, 'Ещё');
        const sheet = page.getByRole('dialog', { name: 'Ещё' });
        await expect(sheet).toHaveCSS('transform', 'none');
        const head = (await sheet.locator('.q-sheet-head').boundingBox())!;
        const start = { x: head.x + head.width / 2, y: head.y + head.height / 2 };
        const touch = await touchInput(page);
        await touch.start(start);
        await touch.move({ ...start, y: start.y + 75 });
        await expect.poll(() => translation(sheet, 'y')).toBeGreaterThan(65);
        await shot(page, info, `sheet-drag-${theme}`);
        await touch.move(start);
        await touch.end();
        await expect(sheet).toHaveCSS('transform', 'none');

        // Добавляем высоту в тело листа «Ещё», чтобы проверить оба направления нативной прокрутки.
        const body = sheet.locator('.q-sheet-body');
        await body.evaluate((el) => {
          (el as HTMLElement).style.minHeight = '1000px';
        });
        await sheet.evaluate((el) => (el.scrollTop = 160));
        const box = (await sheet.boundingBox())!;
        await touch.start({ x: 125, y: box.y + 160 });
        await touch.move({ x: 125, y: box.y + 250 });
        await touch.end();
        await expect.poll(() => sheet.evaluate((el) => el.scrollTop)).toBeLessThan(160);
        await expect(sheet).toHaveCSS('transform', 'none');

        // Возвращаем компактный лист: с его содержимого в самом верху можно закрыть.
        await body.evaluate((el) => (el as HTMLElement).style.removeProperty('min-height'));
        // Инерция прошлой прокрутки и пересчёт высоты должны закончиться до нового жеста.
        await expect
          .poll(async () => {
            await sheet.evaluate((el) => (el.scrollTop = 0));
            const before = await sheet.boundingBox();
            await page.waitForTimeout(150);
            const after = await sheet.boundingBox();
            return before?.y === after?.y && before?.height === after?.height;
          })
          .toBe(true);
        const compact = (await sheet.boundingBox())!;
        const from = { x: 125, y: compact.y + compact.height * 0.45 };
        await touch.start(from);
        await touch.move({ ...from, y: from.y + compact.height * 0.4 });
        await touch.end();
        await expect(sheet).toHaveCount(0);
      });

      test('Уведомления: выход сверху, возврат и закрытие', async ({ page }, info) => {
        const server = await mockSync(page);
        server.notices.push(notice(1));
        await page.goto('/today');
        const panel = await openBell(page);
        await expect(panel.getByText('Напоминание 1')).toBeVisible();
        await expect(panel).toHaveCSS('transform', 'none');
        const box = (await panel.boundingBox())!;
        expect(box.y).toBe(0);
        const touch = await touchInput(page);
        const start = { x: 140, y: box.height * 0.6 };

        await touch.start(start);
        await touch.move({ ...start, y: start.y - box.height * 0.35 });
        await expect.poll(() => translation(panel, 'y')).toBeLessThan(-20);
        await shot(page, info, `notifications-drag-${theme}`);
        await touch.move(start);
        await touch.end();
        await expect(panel).toHaveCSS('transform', 'none');

        await touch.start(start);
        await touch.move({ ...start, y: start.y - box.height * 0.45 });
        await touch.end();
        await expect(panel).toHaveCount(0);

        await openBell(page);
        await page.touchscreen.tap(180, 680);
        await expect(panel).toHaveCount(0);
      });

      test('длинный список уведомлений прокручивается внутри панели', async ({ page }) => {
        const server = await mockSync(page);
        for (let i = 0; i < 20; i++) server.notices.push(notice(i));
        await page.goto('/today');
        const panel = await openBell(page);
        await expect(panel.getByText('Напоминание 19', { exact: true })).toBeAttached();
        await expect(panel).toHaveCSS('transform', 'none');
        const touch = await touchInput(page);
        await touch.start({ x: 170, y: 285 });
        await touch.move({ x: 170, y: 120 });
        await touch.end();
        await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
        await expect(panel).toHaveCSS('transform', 'none');
      });
    });
  }

  test.describe('ПК', () => {
    test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: true });

    test('край, окно и панель уведомлений не захватывают жесты', async ({ page }, info) => {
      const server = await mockSync(page);
      server.notices.push(notice(1));
      await page.goto('/home');
      await goSection(page, 'Сегодня');
      await expect(page.locator('[data-screen="today"]')).toBeVisible();
      const touch = await touchInput(page);

      await touch.start({ x: 32, y: 250 });
      await touch.move({ x: 650, y: 250 });
      await touch.end();
      await expect(page).toHaveURL(/\/today$/);
      await expect(page.locator('.main')).toHaveCSS('transform', 'none');

      const panel = await openBell(page);
      const box = (await panel.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await touch.start({ x, y });
      await touch.move({ x, y: y - 100 });
      await touch.end();
      await expect(panel).toBeVisible();
      await shot(page, info, 'notifications-desktop');
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);

      await goSection(page, 'Planner');
      await page.getByRole('button', { name: 'Новый проект' }).click();
      const sheet = page.getByRole('dialog', { name: 'Новый проект' });
      await expect(sheet).toBeVisible();
      const head = (await sheet.locator('.q-sheet-head').boundingBox())!;
      const start = { x: head.x + head.width / 2, y: head.y + head.height / 2 };
      await touch.start(start);
      await touch.move({ ...start, y: start.y + 150 });
      await touch.end();
      await expect(sheet).toBeVisible();
      await shot(page, info, 'sheet-desktop');
    });
  });
});
