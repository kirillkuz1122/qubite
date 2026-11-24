import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockSync } from './sync-mock';
import { goSection } from './nav';

/* «Сегодня» и Planner на настоящих данных (PLAN-001): сервер подделан, браузер настоящий. */

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 900;
const pad = (n: number) => String(n).padStart(2, '0');
const day = (shift = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + shift);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function go(page: Page, name: string) {
  await goSection(page, name);
}

async function openCommand(page: Page) {
  if (isPhone(page)) await page.getByRole('button', { name: 'Открыть Command' }).click();
  else await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: 'Строка Command' });
  await expect(input).toBeFocused();
  return input;
}

const boardColumn = (page: Page, name: string) =>
  page.getByRole('group', { name: new RegExp(`^${name}:`) });

async function openBoard(page: Page) {
  await page.goto('/planner');
  await page.getByRole('radio', { name: 'Доска' }).click();
}

async function center(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function touchInput(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return (type: 'touchStart' | 'touchMove' | 'touchEnd', point?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ ...point, id: 0 }] : [] });
}

test('дела и проекты с сервера: «Сегодня», неделя, доска, полоски проектов', async ({ page }) => {
  const server = await mockSync(page);
  const algebra = server.addProject('Алгебра', { color: 'sky', tag: 'алгебра' });
  server.addTask('Алгебра: № 214–220', {
    due_date: day(),
    due_time: '18:00',
    project_id: algebra,
    priority: 'urgent',
    subtasks: [
      { id: 'a', title: '№ 214–216', done: true },
      { id: 'b', title: '№ 217–220', done: false },
    ],
  });
  server.addTask('Эссе по литературе', { due_date: day(-1) });
  server.addTask('Конспект по физике', { due_date: day(), status: 'done', project_id: algebra });
  server.addTask('Бот: напоминания', { status: 'doing' });
  await page.goto('/today');

  const row = page.locator('.row').filter({ hasText: 'Алгебра: № 214–220' });
  await expect(row).toContainText('Алгебра · срочно · шаги 1/2');
  await expect(row).toContainText('18:00');
  await expect(page.locator('.row').filter({ hasText: 'Эссе по литературе' })).toContainText(
    'просрочено',
  );
  await expect(page.getByText('1 из 3')).toBeVisible();

  await go(page, 'Planner');
  await expect(page.getByRole('checkbox', { name: 'Готово: Алгебра: № 214–220' })).toBeVisible();
  const project = page.locator('.proj').filter({ hasText: 'Алгебра' });
  await expect(project).toContainText('1/2');

  await page.getByRole('radio', { name: 'Доска' }).click();
  await expect(boardColumn(page, 'Надо')).toContainText('Эссе по литературе');
  await expect(boardColumn(page, 'В работе')).toContainText('Бот: напоминания');
  await expect(boardColumn(page, 'Готово')).toContainText('Конспект по физике');
});

test('Сегодня: дело без даты скрыто, исчезает после отметки и возвращается', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const server = await mockSync(page);
  const title = 'ДлинноеНазваниеДелаБезДаты'.repeat(4);
  const taskId = server.addTask(title, { due_date: null });
  await page.goto('/today');

  const block = page.getByRole('button', { name: 'Без даты · 1' });
  const ring = page.getByRole('checkbox', { name: `Готово: ${title}` });
  await expect(block).toHaveAttribute('aria-expanded', 'false');
  await expect(ring).toHaveCount(0);
  await expect(page.getByText('0 из 0', { exact: true })).toBeVisible();
  await expect(page.getByText('На сегодня дел нет.', { exact: false })).toBeVisible();

  await block.click();
  await expect(block).toHaveAttribute('aria-expanded', 'true');
  await expect(ring).toBeVisible();
  const task = page.getByRole('button', { name: `Открыть дело: ${title}` });
  expect(await task.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await ring.click();
  await expect(block).toHaveCount(0);
  await expect(ring).toHaveCount(0);
  await expect
    .poll(() => server.ops.find((op) => op.kind === 'patch' && op.object_id === taskId)?.fields)
    .toEqual({ status: 'done' });

  server.patch(taskId, { status: 'todo' });
  server.ping();
  await expect(block).toBeVisible();
  await expect(ring).toBeVisible();
});

test('доска: перенести дело меню, клавишами и мышью; проект — кнопкой и из Command (D-289)', async ({
  page,
}) => {
  const server = await mockSync(page);
  server.addTask('Эссе по литературе', { due_date: day() });
  await openBoard(page);
  const col = (name: string) => boardColumn(page, name);
  const card = page.locator('[data-card]').filter({ hasText: 'Эссе по литературе' });

  await card.getByRole('button', { name: 'Перенести в…' }).click();
  await card.getByRole('menuitem', { name: 'В работе' }).click();
  await expect(col('В работе')).toContainText('Эссе по литературе');
  await expect
    .poll(() =>
      server.ops.some(
        (op) => op.kind === 'patch' && (op.fields as Record<string, unknown>).status === 'doing',
      ),
    )
    .toBe(true);

  await card.focus();
  await page.keyboard.press('ArrowRight');
  await expect(col('Готово')).toContainText('Эссе по литературе');
  await expect(card).toBeFocused();

  if (!isPhone(page)) {
    await card.dragTo(col('Надо'));
    await expect(col('Надо')).toContainText('Эссе по литературе');
  }
  // доска без горизонтальной прокрутки
  expect(await page.locator('.board').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(
    true,
  );

  await page.getByRole('radio', { name: 'Неделя' }).click();
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.getByLabel('Название проекта').fill('Физика');
  await page
    .getByRole('form', { name: 'Новый проект' })
    .getByRole('button', { name: 'Создать' })
    .click();
  await expect(page.getByRole('region', { name: 'Дела проекта Физика' })).toContainText('#физика');

  const input = await openCommand(page);
  await input.fill('новый проект Олимпиада');
  await expect(page.getByText('Создать проект «Олимпиада»')).toBeVisible();
  await input.press('Enter');
  await expect(page.locator('.proj').filter({ hasText: 'Олимпиада' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect
    .poll(() =>
      server.ops
        .filter((op) => op.kind === 'create' && op.object_type === 'planner.project')
        .map((op) => op.title),
    )
    .toEqual(['Физика', 'Олимпиада']);
});

test.describe('доска с касаниями', { tag: '@board-touch' }, () => {
  const title = 'Разобрать задачи';
  const taskCard = (page: Page) => page.locator('[data-card]').filter({ hasText: title });

  test('долгое нажатие переносит дело из «Надо» в «В работе» и сохраняет статус', async ({
    page,
  }) => {
    const server = await mockSync(page);
    const id = server.addTask(title);
    await openBoard(page);
    const card = taskCard(page);
    const target = boardColumn(page, 'В работе');
    await expect(card).toBeInViewport();
    const touch = await touchInput(page);
    await touch('touchStart', await center(card.locator('.card-title')));
    await expect(card).toHaveClass(/\bdragging\b/);
    await touch('touchMove', await center(target));
    await expect(target).toHaveClass(/\bover\b/);
    await touch('touchEnd');

    await expect(target).toContainText(title);
    await expect
      .poll(() => server.ops.find((op) => op.kind === 'patch' && op.object_id === id)?.fields)
      .toMatchObject({ status: 'doing' });
  });

  test('короткое касание со сдвигом прокручивает доску без переноса', async ({ page }) => {
    const server = await mockSync(page);
    server.addTask(title);
    for (let i = 1; i <= 12; i++) server.addTask(`Дело ${i}`, { status: 'doing' });
    await openBoard(page);
    const card = taskCard(page);
    await expect(card).toBeInViewport();
    const start = await center(card.locator('.card-title'));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const touch = await touchInput(page);
    await touch('touchStart', start);
    await touch('touchMove', { ...start, y: start.y - 32 });
    await touch('touchMove', { ...start, y: start.y - 120 });
    await touch('touchEnd');

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore);
    await expect(boardColumn(page, 'Надо')).toContainText(title);
    await expect(card).not.toHaveClass(/\bdragging\b/);
    expect(server.ops).toHaveLength(0);
  });

  test('у нижнего края доска докручивается до «Готово» и карточка остаётся под пальцем', async ({
    page,
  }) => {
    const server = await mockSync(page);
    const id = server.addTask(title);
    for (let i = 1; i <= 12; i++) server.addTask(`Дело ${i}`, { status: 'doing' });
    await openBoard(page);
    const card = taskCard(page);
    const cardTitle = card.locator('.card-title');
    const target = boardColumn(page, 'Готово');
    await expect(card).toBeInViewport();
    await expect(target).not.toBeInViewport();
    const edge = (await page.locator('.q-dock').boundingBox())!.y - 8;
    const start = await center(cardTitle);
    const touch = await touchInput(page);
    await touch('touchStart', start);
    await expect(card).toHaveClass(/\bdragging\b/);
    await touch('touchMove', { ...start, y: edge });
    await expect
      .poll(async () => {
        const box = (await target.boundingBox())!;
        return box.y + box.height;
      })
      .toBeLessThan(edge);
    await expect.poll(async () => Math.abs((await center(cardTitle)).y - edge)).toBeLessThan(2);
    await touch('touchMove', await center(target));
    await expect(target).toHaveClass(/\bover\b/);
    await touch('touchEnd');

    await expect(target).toContainText(title);
    await expect(card).not.toHaveClass(/\bdragging\b/);
    await expect
      .poll(() => server.ops.find((op) => op.kind === 'patch' && op.object_id === id)?.fields)
      .toMatchObject({ status: 'done' });
  });

  test('меню «Перенести в…» работает от касания', async ({ page }) => {
    const server = await mockSync(page);
    server.addTask(title);
    await openBoard(page);
    const card = taskCard(page);
    await card.getByRole('button', { name: 'Перенести в…' }).tap();
    const menu = card.getByRole('menu', { name: 'Перенести в…' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'В работе' }).tap();
    await expect(boardColumn(page, 'В работе')).toContainText(title);
  });
});

test('строка без сути («#учёба завтра в 15:00 !») — не дело с меткой в названии, а во «Входящие»', async ({
  page,
}) => {
  const server = await mockSync(page);
  await page.goto('/planner');
  const input = await openCommand(page);
  await input.fill('#учёба завтра в 15:00 !');
  await expect(page.getByText('Новый проект «Учеба»')).toBeVisible();
  await input.press('Enter');
  await expect.poll(() => server.ops.length).toBeGreaterThan(0);
  expect(server.ops.every((op) => op.object_type !== 'planner.task')).toBe(true);
});

test('дело из Command с #проектом создаёт проект и встаёт на сегодня', async ({ page }) => {
  const server = await mockSync(page);
  await page.goto('/today');
  await expect(page.getByText('На сегодня дел нет.', { exact: false })).toBeVisible();
  const input = await openCommand(page);
  // «сегодня» явно: вечером «в 18:00» без дня разбор переносит на завтра (D-241)
  await input.fill('/д #алгебра № 214–220 сегодня в 23:59');
  await input.press('Enter');
  const row = page.locator('.row').filter({ hasText: '№ 214–220' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('23:59');
  await expect(row).toContainText('Алгебра');

  await expect.poll(() => server.ops.filter((op) => op.kind === 'create').length).toBe(2);
  const [project, task] = server.ops.filter((op) => op.kind === 'create');
  expect(project).toMatchObject({ object_type: 'planner.project', title: 'Алгебра' });
  expect(task).toMatchObject({ object_type: 'planner.task' });
  expect(task!.fields).toMatchObject({
    due_date: day(),
    due_time: '23:59',
    project_id: project!.object_id,
  });
});

test('отметка без сети переживает перезагрузку и уходит, когда сеть вернулась', async ({
  page,
}) => {
  const server = await mockSync(page);
  server.addTask('Позвонить бабушке', { due_date: day() });
  await page.goto('/today');
  const ring = page.getByRole('checkbox', { name: 'Готово: Позвонить бабушке' });
  await expect(ring).toHaveAttribute('aria-checked', 'false');
  server.offline = true;
  await ring.click();
  await expect(ring).toHaveAttribute('aria-checked', 'true');
  await page.reload(); // вкладку перезагрузили — отметка осталась в IndexedDB
  await expect(ring).toHaveAttribute('aria-checked', 'true');
  expect(server.ops).toHaveLength(0);

  server.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(() => server.ops.find((op) => op.kind === 'patch')?.fields)
    .toEqual({
      status: 'done',
    });
});

test('новое дело с другого устройства появляется само («есть новое»)', async ({ page }) => {
  const server = await mockSync(page);
  await page.goto('/planner');
  await expect(page.getByText('Проектов пока нет', { exact: false })).toBeVisible();
  server.addProject('Олимпиада по информатике');
  server.addTask('Разобрать задачу на ДП', { due_date: day() });
  server.ping();
  await expect(
    page.getByRole('checkbox', { name: 'Готово: Разобрать задачу на ДП' }),
  ).toBeVisible();
  await expect(page.locator('.proj').filter({ hasText: 'Олимпиада по информатике' })).toContainText(
    '0/0',
  );
});
