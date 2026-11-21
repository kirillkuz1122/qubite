import { expect, test, type Locator, type Page } from '@playwright/test';
import { shot, touchInput } from './gesture-input';
import { goSection } from './nav';
import { mockSync } from './sync-mock';

async function pointAt(locator: Locator, fraction = 0.5) {
  await expect(locator).toBeVisible();
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width * fraction, y: box.y + box.height / 2 };
}

function plannerTabs(page: Page) {
  return page.getByRole('radiogroup', { name: 'Вид', exact: true });
}

const weekContent = (page: Page) => page.locator('[data-screen="planner"] [data-view="week"]');

const projectsHeading = (page: Page) =>
  weekContent(page)
    .locator('.sec-h')
    .filter({
      has: page.getByRole('heading', { name: 'Проекты', exact: true }),
    });

test.describe('MOB-002, часть 2', { tag: '@gestures-touch' }, () => {
  for (const theme of ['dark', 'light'] as const) {
    test.describe(theme, () => {
      test.use({
        viewport: { width: 360, height: 780 },
        hasTouch: true,
        isMobile: true,
        reducedMotion: theme === 'light' ? 'reduce' : 'no-preference',
      });

      test.beforeEach(async ({ page }) => {
        await page.addInitScript(
          (value) => localStorage.setItem('qubite.look.v1', JSON.stringify({ theme: value })),
          theme,
        );
        await mockSync(page);
      });

      test('Свайп из содержимого, возврат пальца и соседняя вкладка', async ({ page }, info) => {
        await page.goto('/planner');
        const tabs = plannerTabs(page);
        const week = tabs.getByRole('radio', { name: 'Неделя' });
        const board = tabs.getByRole('radio', { name: 'Доска' });
        const indicator = tabs.locator('.q-tab-flow').first();
        // Под днями недели, внутри содержимого вкладки.
        const y = (await pointAt(projectsHeading(page))).y;
        const start = { x: 265, y };
        const end = { x: 120, y };
        const touch = await touchInput(page);
        await expect(week).toHaveAttribute('aria-checked', 'true');
        await expect(indicator).not.toHaveCSS('transform', 'none');
        const initial = await indicator.evaluate((el) => getComputedStyle(el).transform);

        await touch.start(start);
        await touch.move(end);
        await expect(indicator).not.toHaveCSS('transform', initial);
        await expect(week).toHaveAttribute('aria-checked', 'true');
        await shot(page, info, `tabs-drag-${theme}`);
        await touch.move(start);
        await touch.end();
        await expect(indicator).toHaveCSS('transform', initial);
        await expect(week).toHaveAttribute('aria-checked', 'true');

        await touch.start(start);
        await touch.move(end);
        await touch.end();
        await expect(board).toHaveAttribute('aria-checked', 'true');
        await expect(page.locator('[data-screen="planner"] [data-view="board"]')).toBeVisible();

        const from = await pointAt(tabs, 0.35);
        await touch.start(from);
        await touch.move({ ...from, x: from.x + 120 });
        await touch.end();
        await expect(week).toHaveAttribute('aria-checked', 'true');
      });

      test('На первой вкладке история приложения решает, можно ли вернуться', async ({ page }) => {
        await page.goto('/planner');
        const touch = await touchInput(page);
        const back = async () => {
          const from = await pointAt(plannerTabs(page), 0.3);
          await touch.start(from);
          await touch.move({ ...from, x: from.x + 155 });
          await touch.end();
        };

        await back();
        await expect(page).toHaveURL(/\/planner$/);
        await goSection(page, 'Главная');
        await expect(page).toHaveURL(/\/home$/);
        await goSection(page, 'Planner');
        await expect(page).toHaveURL(/\/planner$/);
        await back();
        await expect(page).toHaveURL(/\/home$/);
      });

      test('Горизонтальная и вертикальная прокрутка сохраняют вкладку', async ({ page }) => {
        await page.goto('/planner');
        const week = plannerTabs(page).getByRole('radio', { name: 'Неделя' });
        const content = weekContent(page);
        await content.evaluate((el) => {
          const scroller = document.createElement('div');
          const line = document.createElement('div');
          scroller.dataset.testid = 'horizontal-scroll';
          Object.assign(scroller.style, { width: '240px', overflowX: 'auto' });
          Object.assign(line.style, { width: '640px', height: '48px' });
          scroller.append(line);
          el.prepend(scroller);
          el.style.minHeight = '1200px';
        });
        const scroller = content.getByTestId('horizontal-scroll');
        const touch = await touchInput(page);
        const from = await pointAt(scroller, 0.75);
        await touch.start(from);
        await touch.move({ ...from, x: from.x - 110 });
        await touch.end();
        await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
        await expect(week).toHaveAttribute('aria-checked', 'true');

        await touch.start({ x: 160, y: 540 });
        await touch.move({ x: 160, y: 350 });
        await touch.end();
        await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
        await expect(week).toHaveAttribute('aria-checked', 'true');
      });

      test('Зажать, подсветить модуль и открыть одним касанием', async ({ page }, info) => {
        await page.goto('/home');
        const nav = page.getByRole('navigation', { name: 'Разделы' });
        const touch = await touchInput(page);
        const picker = nav.getByRole('group', { name: 'Выбор модуля' });
        await touch.start(await pointAt(nav.getByRole('button', { name: 'Ещё', exact: true })));
        await expect(picker).toBeVisible();
        await expect(picker.getByRole('button', { name: 'Главная', exact: true })).toBeVisible();
        const docs = picker.getByRole('button', { name: 'Docs', exact: true });
        await expect(nav.locator('.q-dock-picker-panel')).toHaveCSS('transform', 'none');
        await touch.move(await pointAt(docs));
        await expect(docs).toHaveAttribute('data-highlight', '');
        await shot(page, info, `picker-highlight-${theme}`);
        await touch.end();
        await expect(page).toHaveURL(/\/docs$/);
        await expect(picker).toBeHidden();
        await expect(page.getByRole('dialog', { name: 'Ещё' })).toBeHidden();
      });

      test('Отпускание мимо отменяет выбор, короткий тап открывает «Ещё»', async ({ page }) => {
        await page.goto('/home');
        const nav = page.getByRole('navigation', { name: 'Разделы' });
        const more = nav.getByRole('button', { name: 'Ещё', exact: true });
        const picker = nav.getByRole('group', { name: 'Выбор модуля' });
        const sheet = page.getByRole('dialog', { name: 'Ещё' });
        const touch = await touchInput(page);
        await touch.start(await pointAt(more));
        await expect(picker).toBeVisible();
        await touch.move({ x: 28, y: 380 });
        await touch.end();
        await expect(picker).toBeHidden();
        await expect(sheet).toBeHidden();
        await expect(page).toHaveURL(/\/home$/);

        await more.tap();
        await expect(sheet).toBeVisible();
        await expect(picker).toBeHidden();
      });
    });
  }

  test.describe('ПК', () => {
    test.use({ viewport: { width: 1440, height: 900 }, hasTouch: true, isMobile: false });

    test('Свайп касанием по содержимому не переключает вкладку', async ({ page }, info) => {
      await mockSync(page);
      await page.goto('/planner');
      const from = await pointAt(projectsHeading(page));
      const touch = await touchInput(page);
      await touch.start(from);
      await touch.move({ ...from, x: from.x - 115 });
      await touch.end();
      await expect(plannerTabs(page).getByRole('radio', { name: 'Неделя' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await shot(page, info, 'tabs-desktop');
    });
  });
});
