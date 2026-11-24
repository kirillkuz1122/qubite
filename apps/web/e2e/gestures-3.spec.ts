import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { touchInput } from './gesture-input';
import { mockSync } from './sync-mock';

const title = 'Купить билеты';
const today = () => new Date().toLocaleDateString('sv-SE');
const actions = (page: Page) => page.getByRole('group', { name: 'Действия свайпа' });
const rowFor = (page: Page, id: string) => page.locator(`.row[data-obj="${id}"]`);
const column = (page: Page, status: string) => page.locator(`.board > [data-status="${status}"]`);
const frontFor = (page: Page, row: Locator) => page.locator('.q-swipe-front').filter({ has: row });

async function startAt(row: Locator, fraction = 0.7) {
  const box = (await row.boundingBox())!;
  return { x: box.x + box.width * fraction, y: box.y + box.height / 2 };
}

async function swipeBy(page: Page, row: Locator, delta: number) {
  const touch = await touchInput(page);
  const start = await startAt(row, delta < 0 ? 0.7 : 0.3);
  await touch.start(start);
  await touch.move({ ...start, x: start.x + delta });
  await touch.end();
}

async function waitForScrollEnd(page: Page) {
  await expect
    .poll(async () => {
      const before = await page.evaluate(() => window.scrollY);
      await page.waitForTimeout(150);
      return before === (await page.evaluate(() => window.scrollY));
    })
    .toBe(true);
}

async function shot(page: Page, info: TestInfo, name: string) {
  const path = fileURLToPath(
    new URL(`../../../docs/design/screens/MOB-002/task-swipe-${name}.png`, import.meta.url),
  );
  await page.screenshot({ path });
  await info.attach(`task-swipe-${name}`, { path, contentType: 'image/png' });
}

test.describe('MOB-002, свайп задачи', { tag: '@gestures-touch' }, () => {
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

      test('меню действий, закрытие и восстановление удалённого дела', async ({ page }, info) => {
        const server = await mockSync(page);
        const id = server.addTask(title, { due_date: today(), place_text: 'Касса' });
        await page.goto('/today');
        const row = rowFor(page, id);
        await expect(row).toBeInViewport();

        async function openActions() {
          await expect(frontFor(page, row)).toHaveCSS('transform', 'none');
          await swipeBy(page, row, -165);
          await expect(actions(page)).toBeVisible();
          await expect
            .poll(() =>
              row.evaluate((el) => {
                const front = el.parentElement!;
                const panel = front.parentElement!;
                const buttons = panel.querySelector<HTMLElement>('.q-swipe-actions')!;
                const transform = getComputedStyle(front).transform;
                return (
                  transform !== 'none' && new DOMMatrix(transform).m41 === -buttons.offsetWidth
                );
              }),
            )
            .toBe(true);
        }

        await openActions();
        for (const name of ['Изменить', 'Перенести', 'Удалить']) {
          const box = (await actions(page).getByRole('button', { name }).boundingBox())!;
          expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
        }
        await shot(page, info, `actions-${theme}`);
        await page.keyboard.press('Escape');
        await expect(actions(page)).toHaveCount(0);

        await openActions();
        await page.touchscreen.tap(180, 100);
        await expect(actions(page)).toHaveCount(0);

        await openActions();
        await actions(page).getByRole('button', { name: 'Изменить' }).tap();
        const edit = page.getByRole('dialog', { name: 'Место и дорога' });
        await expect(edit.getByLabel('Место', { exact: true })).toHaveValue('Касса');
        await page.keyboard.press('Escape');
        await expect(edit).toHaveCount(0);

        await openActions();
        await actions(page).getByRole('button', { name: 'Перенести' }).tap();
        const place = page.getByRole('dialog', { name: 'Перенести в…' });
        await place.getByRole('button', { name: 'В работе' }).tap();
        await expect(place).toHaveCount(0);
        await expect
          .poll(() =>
            server.ops.some(
              (op) =>
                op.object_id === id &&
                op.kind === 'patch' &&
                (op.fields as Record<string, unknown>).status === 'doing',
            ),
          )
          .toBe(true);

        await openActions();
        await actions(page).getByRole('button', { name: 'Удалить' }).tap();
        await expect(row).toHaveCount(0);
        const deleted = page.getByRole('status').filter({ hasText: 'Задача удалена' });
        await deleted.getByRole('button', { name: 'Отменить' }).tap();
        await expect(row).toContainText(title);
        await expect
          .poll(() =>
            server.ops
              .filter(
                (op) => op.object_id === id && (op.kind === 'delete' || op.kind === 'restore'),
              )
              .map((op) => op.kind),
          )
          .toEqual(['delete', 'restore']);
      });

      test('свайп вправо, возврат пальца и прокрутка', async ({ page }, info) => {
        const server = await mockSync(page);
        const id = server.addTask(title, { status: 'doing', due_date: today(), due_time: '08:00' });
        for (let i = 0; i < 12; i++) server.addTask(`Дело ${i}`, { due_date: today() });
        await page.goto('/today');
        const row = rowFor(page, id);
        const front = frontFor(page, row);
        const ring = row.getByRole('checkbox', { name: `Готово: ${title}` });
        await expect(row).toBeInViewport();
        const touch = await touchInput(page);
        const start = await startAt(row, 0.3);

        await touch.start(start);
        await touch.move({ ...start, x: start.x + 160 });
        await expect(front).not.toHaveCSS('transform', 'none');
        await touch.move(start);
        await touch.end();
        await expect(front).toHaveCSS('transform', 'none');
        await expect(ring).not.toBeChecked();

        await swipeBy(page, row, 65);
        await expect(front).toHaveCSS('transform', 'none');
        await expect(ring).not.toBeChecked();

        await touch.start(start);
        await touch.move({ ...start, y: start.y - 130 });
        await touch.end();
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
        await expect(actions(page)).toHaveCount(0);
        await expect(front).toHaveCSS('transform', 'none');
        await expect(ring).not.toBeChecked();
        await waitForScrollEnd(page);
        await page.evaluate(() => window.scrollTo(0, 0));

        await swipeBy(page, row, 165);
        await expect(ring).toBeChecked();
        const closed = page.getByRole('status').filter({ hasText: 'Задача закрыта' });
        await expect(closed).toBeVisible();
        await shot(page, info, `done-${theme}`);
        await closed.getByRole('button', { name: 'Отменить' }).tap();
        await expect(ring).not.toBeChecked();
        await expect
          .poll(() =>
            server.ops
              .filter((op) => op.object_id === id && op.kind === 'patch')
              .map((op) => (op.fields as Record<string, unknown>).status),
          )
          .toEqual(['done', 'doing']);
      });

      test('Канбан: свайп и удержание работают на одной карточке', async ({ page }) => {
        const server = await mockSync(page);
        const id = server.addTask(title);
        await page.goto('/planner');
        await page.getByRole('radio', { name: 'Доска' }).click();
        const card = page.locator(`[data-card="${id}"]`);
        await expect(card).toBeInViewport();

        await swipeBy(page, card, -150);
        await expect(actions(page)).toBeVisible();
        await expect(card).not.toHaveClass(/\bdragging\b/);
        await page.keyboard.press('Escape');
        await expect(frontFor(page, card)).toHaveCSS('transform', 'none');

        const touch = await touchInput(page);
        await touch.start(await startAt(card.locator('.card-title'), 0.35));
        await expect(card).toHaveClass(/\bdragging\b/);
        const doing = column(page, 'doing');
        await touch.move(await startAt(doing, 0.45));
        await expect(doing).toHaveClass(/\bover\b/);
        await touch.end();
        await expect(doing.locator(card)).toBeVisible();
        await expect(actions(page)).toHaveCount(0);

        await swipeBy(page, card, 150);
        await expect(column(page, 'done').locator(card)).toBeVisible();
        await page
          .getByRole('status')
          .filter({ hasText: 'Задача закрыта' })
          .getByRole('button', { name: 'Отменить' })
          .tap();
        await expect(doing.locator(card)).toBeVisible();
      });

      test('Главная: свайп дела без даты; проект: свайп карточки', async ({ page }) => {
        const server = await mockSync(page);
        const projectTitle = 'Поездка';
        const project = server.addProject(projectTitle);
        const id = server.addTask(title, { project_id: project, due_date: null });
        await page.route(`**/api/v1/projects/${project}`, (route) =>
          route.fulfill({
            json: {
              project: { id: project, title: projectTitle, color: 'orange', status: 'active' },
              tasks: [],
              files: [],
              docs: [],
              feed: [],
              events: [],
              agent: false,
            },
          }),
        );
        await page.goto('/home');
        await page.getByRole('button', { name: 'Без даты · 1' }).tap();
        const row = rowFor(page, id);
        await row.scrollIntoViewIfNeeded();
        await waitForScrollEnd(page);
        await swipeBy(page, row, -165);
        await expect(actions(page)).toBeVisible();

        await page.goto(`/planner/project/${project}`);
        const card = page.locator(`[data-card="${id}"]`);
        await card.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await waitForScrollEnd(page);
        await swipeBy(page, card, -150);
        await expect(actions(page)).toBeVisible();
      });
    });
  }

  test.describe('ПК', () => {
    test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: true });

    test('касания и мышь не включают свайп дела', async ({ page }, info) => {
      const server = await mockSync(page);
      const id = server.addTask(title, { due_date: today() });
      await page.goto('/today');
      const row = rowFor(page, id);
      await expect(row).toBeInViewport();

      await swipeBy(page, row, -210);
      await swipeBy(page, row, 240);
      const start = await startAt(row);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x - 210, start.y, { steps: 3 });
      await page.mouse.up();

      await expect(actions(page)).toHaveCount(0);
      await expect(row.getByRole('checkbox')).not.toBeChecked();
      expect(server.ops).toHaveLength(0);
      await shot(page, info, 'desktop');
    });
  });
});
