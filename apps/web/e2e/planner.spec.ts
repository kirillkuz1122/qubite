import { expect, test, type Page } from '@playwright/test';
import { mockSync } from './sync-mock';

/* «Сегодня» и Planner на настоящих данных (PLAN-001): сервер подделан, браузер настоящий. */

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 900;
const pad = (n: number) => String(n).padStart(2, '0');
const day = (shift = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + shift);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function go(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name }).click();
}

async function openCommand(page: Page) {
  if (isPhone(page)) await page.getByRole('button', { name: 'Открыть Command' }).click();
  else await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: 'Строка Command' });
  await expect(input).toBeFocused();
  return input;
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
  const col = (name: string) => page.locator('.col').filter({ hasText: name });
  await expect(col('Надо')).toContainText('Эссе по литературе');
  await expect(col('В работе')).toContainText('Бот: напоминания');
  await expect(col('Готово')).toContainText('Конспект по физике');
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
