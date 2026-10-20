import { expect, test, type Page } from '@playwright/test';
import { mockSync } from './sync-mock';

/*
 * Лента «Что сделал агент» (AGT-002): сервер подделан, браузер настоящий. Откат натыкается на
 * более позднюю правку — три значения и решение человека; «Исправить» — поправка.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const year = new Date().getFullYear();
const date = (d: number) => `${year}-10-${pad(d)}`;

async function go(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name }).click();
}

function action(over: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    seq: 1,
    at: new Date().toISOString(),
    actor: 'agent',
    run_id: null,
    batch_id: crypto.randomUUID(),
    skill_id: null,
    tool: 'task.create',
    summary: '',
    reason: null,
    reverts: null,
    corrects: null,
    cost_usd_micros: null,
    changes: [],
    state: { reverted_by: null as string | null, corrected_by: [] as string[], batch_size: 1 },
    ...over,
  };
}

async function mockAgent(page: Page, projectId: string, taskId: string) {
  const batch = crypto.randomUUID();
  const created = action({
    seq: 1,
    batch_id: batch,
    summary: 'Разложил мысль «упр. 145» → дело «Упр. 145»: в «Русский», срок 22.10',
    reason: 'урок русского по четвергам',
    tool: 'inbox.file',
    state: { reverted_by: null, corrected_by: [], batch_size: 2 },
    changes: [
      {
        object_id: taskId,
        object_type: 'planner.task',
        title: 'Упр. 145',
        created: true,
        diff: [
          { field: 'title', before: null, after: 'Упр. 145' },
          { field: 'project_id', before: null, after: projectId },
          { field: 'due_date', before: null, after: date(22) },
        ],
      },
    ],
  });
  const moved = action({
    seq: 2,
    summary: 'Перенёс «Упр. 145» на 23.10',
    reason: 'в среду контрольная',
    tool: 'task.reschedule',
    changes: [
      {
        object_id: taskId,
        object_type: 'planner.task',
        title: 'Упр. 145',
        created: false,
        diff: [{ field: 'due_date', before: date(22), after: date(23) }],
      },
    ],
  });
  const calls: { url: string; body: unknown }[] = [];
  const queries: string[] = [];
  await page.route('**/api/v1/agent/timeline**', (route) => {
    queries.push(new URL(route.request().url()).search);
    route.fulfill({ json: { items: [moved, created], next: null } });
  });
  await page.route('**/api/v1/agent/actions/*/revert', (route) => {
    const body = route.request().postDataJSON() as { force: boolean };
    calls.push({ url: route.request().url(), body });
    if (!body.force) {
      route.fulfill({
        json: {
          status: 'conflict',
          actions: [],
          conflicts: [
            {
              action_id: moved.id,
              object_id: taskId,
              object_type: 'planner.task',
              title: 'Упр. 145',
              field: 'due_date',
              before: date(22),
              action: date(23),
              now: date(25),
            },
          ],
        },
      });
      return;
    }
    moved.state = { ...moved.state, reverted_by: crypto.randomUUID() };
    route.fulfill({
      json: { status: 'reverted', actions: [action({ actor: 'owner' })], conflicts: [] },
    });
  });
  await page.route('**/api/v1/agent/actions/*/fix', (route) => {
    calls.push({ url: route.request().url(), body: route.request().postDataJSON() });
    route.fulfill({ json: action({ actor: 'owner', corrects: created.id }) });
  });
  return { calls, queries, created, moved };
}

test('лента агента: было → стало, конфликт отката с тремя значениями, «Исправить»', async ({
  page,
}) => {
  const server = await mockSync(page);
  const russian = server.addProject('Русский', { color: 'sky', tag: 'русский' });
  const task = server.addTask('Упр. 145', { project_id: russian, due_date: date(25) });
  const agent = await mockAgent(page, russian, task);
  await page.goto('/today');
  await go(page, 'Агент');
  await expect(page).toHaveURL(/\/agent$/);

  const list = page.getByRole('list', { name: 'Что сделал агент' });
  const filed = list.getByRole('listitem').filter({ hasText: 'Разложил мысль' }).first();
  await expect(filed).toContainText('почему: урок русского по четвергам');
  await expect(filed).toContainText('пакет · 2');
  await expect(filed.getByRole('list', { name: 'Изменения: Упр. 145' })).toContainText(
    'Проект: — → «Русский»',
  );
  await expect(filed).toContainText('Срок: — → 22.10');
  await expect(filed.getByRole('button', { name: 'Откатить пакет' })).toBeVisible();

  // Откат переноса: после агента срок меняли — ничего не трогаем, показываем три значения.
  const moved = list.getByRole('listitem').filter({ hasText: 'Перенёс «Упр. 145»' }).first();
  await expect(moved).toContainText('Срок: 22.10 → 23.10');
  await moved.getByRole('button', { name: 'Откатить', exact: true }).click();
  const conflict = moved.getByRole('group', { name: 'После агента это уже меняли' });
  await expect(conflict).toBeVisible();
  const row = conflict.getByRole('row').filter({ hasText: 'Срок' });
  await expect(row).toContainText('22.10');
  await expect(row).toContainText('23.10');
  await expect(row).toContainText('25.10');
  expect(agent.calls[0]).toMatchObject({ body: { force: false } });

  await conflict.getByRole('button', { name: 'Вернуть как было' }).click();
  await expect(moved).toContainText('откачено');
  expect(agent.calls[1]).toMatchObject({ body: { force: true } });
  await expect(moved.getByRole('button', { name: 'Откатить', exact: true })).toHaveCount(0);

  // «Исправить»: не 22-го, а 21-го.
  await filed.getByRole('button', { name: 'Исправить' }).click();
  const form = filed.getByRole('form', { name: 'Исправить' });
  await form.getByLabel('Срок').fill(date(21));
  await form.getByRole('button', { name: 'Сохранить' }).click();
  await expect(form).toHaveCount(0);
  const fix = agent.calls.find((c) => c.url.endsWith('/fix'));
  expect(fix?.body).toMatchObject({ object_id: task, fields: { due_date: date(21) } });
});

test('лента у проекта и у дела в Planner', async ({ page }) => {
  const server = await mockSync(page);
  const russian = server.addProject('Русский', { color: 'sky', tag: 'русский' });
  const today = new Date();
  const task = server.addTask('Упр. 145', {
    project_id: russian,
    due_date: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
  });
  const agent = await mockAgent(page, russian, task);
  await page.goto('/planner');

  await page.locator('.proj').filter({ hasText: 'Русский' }).click();
  const trail = page.getByRole('list', { name: 'Что делал агент' });
  await expect(trail).toContainText('Разложил мысль');
  expect(agent.queries.some((q) => q.includes(`project=${russian}`))).toBe(true);

  await page.locator('.row').filter({ hasText: 'Упр. 145' }).click();
  await expect.poll(() => agent.queries.some((q) => q.includes(`object=${task}`))).toBe(true);
});

test('без доступа к агенту — понятное сообщение', async ({ page }) => {
  await mockSync(page);
  await page.route('**/api/v1/agent/timeline**', (route) =>
    route.fulfill({
      status: 403,
      json: { error: 'module_not_granted', message: 'Нет доступа к модулю' },
    }),
  );
  await page.goto('/agent');
  await expect(page.getByText('Агент выключен', { exact: false })).toBeVisible();
});
