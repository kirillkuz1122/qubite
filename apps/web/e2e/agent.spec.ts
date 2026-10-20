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

/** Папка агента, вопросы и разговор (AGT-001) — сервер подделан, агент «отвечает» с задержкой. */
async function mockRecords(page: Page) {
  const now = new Date().toISOString();
  const files = new Map<string, Record<string, unknown>>();
  const add = (path: string, kind: string, body: string, limit = 2200) => {
    const id = crypto.randomUUID();
    files.set(id, { id, path, kind, body, limit, revision: 1, updated_at: now, project_id: null });
    return id;
  };
  add('Кто я.md', 'core', '', 1500);
  add('О тебе.md', 'user', '# О тебе\n', 1500);
  const memory = add('Память.md', 'memory', '# Память\n\n- Русский — по средам\n');
  add('Проекты/Алгебра.md', 'project', '- Учитель — Ирина Петровна\n', 3000);
  add(
    'Расписание.md',
    'file',
    '| День | Начало | Конец | Что |\n|---|---|---|---|\n| вт | 10:05 | 10:50 | Русский |\n',
    6000,
  );
  const messages: Record<string, unknown>[] = [];
  let seq = 0;
  let thinking = 0;
  const questions = [
    {
      id: crypto.randomUUID(),
      text: 'Во сколько кончаются уроки в среду?',
      project_id: null,
      why: 'чтобы предлагать ДЗ',
      options: ['13:00', '14:00'],
      asked_at: now,
    },
  ];
  const calls: { method: string; url: string; body: unknown }[] = [];
  const info = (f: Record<string, unknown>) => ({
    ...f,
    chars: String(f.body).length,
    body: undefined,
  });
  const message = (role: string, text: string, over: Record<string, unknown> = {}) => {
    const m = {
      id: crypto.randomUUID(),
      seq: ++seq,
      role,
      channel: 'web',
      text,
      file_id: null,
      reply_to: null,
      status: 'done',
      actions: 0,
      at: new Date().toISOString(),
      ...over,
    };
    messages.push(m);
    return m;
  };
  await page.route(/\/api\/v1\/agent\/(files|chat|questions)/, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.postDataJSON() as Record<string, string> | null;
    calls.push({ method: req.method(), url: url.pathname, body });
    const parts = url.pathname.split('/').slice(4); // [files, id, fix]
    if (parts[0] === 'files' && parts.length === 1) {
      return route.fulfill({ json: { files: [...files.values()].map(info) } });
    }
    if (parts[0] === 'files') {
      const f = files.get(parts[1]!)!;
      if (parts[2] === 'fix') {
        const mine = message('owner', body!.text!, {
          channel: 'fix',
          file_id: f.id,
          status: 'pending',
        });
        thinking = 2;
        return route.fulfill({ status: 202, json: mine });
      }
      if (req.method() === 'PUT') {
        f.body = body!.body;
        f.revision = Number(f.revision) + 1;
        return route.fulfill({ json: action({ actor: 'owner', tool: 'files.edit' }) });
      }
      return route.fulfill({
        json: {
          ...info(f),
          body: f.body,
          core: f.kind === 'core' ? '# Кто я\n\nЯ — агент Qubite.' : null,
        },
      });
    }
    if (parts[0] === 'chat') {
      if (req.method() === 'POST') {
        const mine = message('owner', body!.text!, { status: 'pending' });
        thinking = 2;
        return route.fulfill({ status: 202, json: mine });
      }
      // Агент «думает» два опроса, потом отвечает и правит файл.
      const pending = messages.find((m) => m.status === 'pending');
      if (pending && --thinking <= 0) {
        pending.status = 'done';
        if (pending.channel === 'fix') {
          const f = files.get(memory)!;
          f.body = String(f.body).replace('по средам', 'по вт и чт');
          f.revision = Number(f.revision) + 1;
          message('agent', 'Исправил: русский по вт и чт.', {
            channel: 'fix',
            reply_to: pending.id,
            actions: 1,
          });
        } else {
          message('agent', 'Запомнил. Во сколько кончаются уроки в среду?', {
            reply_to: pending.id,
            actions: 2,
          });
        }
      }
      return route.fulfill({
        json: { messages, pending: messages.some((m) => m.status === 'pending') },
      });
    }
    if (parts[0] === 'questions' && parts.length === 1) {
      return route.fulfill({ json: { questions } });
    }
    questions.splice(0, 1);
    return route.fulfill({
      status: 202,
      json: { action: action({}), message: message('owner', 'Ответ') },
    });
  });
  return { calls, files, memory };
}

test('записи агента: дерево, правка руками, «Поправить», вопрос, разговор', async ({ page }) => {
  await mockSync(page);
  await page.route('**/api/v1/agent/timeline**', (route) =>
    route.fulfill({ json: { items: [], next: null } }),
  );
  const server = await mockRecords(page);
  await page.goto('/agent');
  await page.getByRole('radio', { name: 'Записи' }).click();

  const tree = page.getByRole('navigation', { name: 'Файлы агента' });
  await expect(tree.getByRole('button')).toHaveText([
    'Кто я',
    'О тебе',
    'Память',
    'Расписание',
    'Алгебра',
  ]);
  await expect(tree).toContainText('Проекты');
  // Открыта «Память»: текст и сколько места.
  const view = page.getByRole('article', { name: 'Память' });
  await expect(view).toContainText('Русский — по средам');
  await expect(view).toContainText('из 2 200 знаков');

  // «Агент хочет знать»: ответ кнопкой.
  const ask = page.getByRole('region', { name: 'Агент хочет знать' });
  await expect(ask).toContainText('Во сколько кончаются уроки в среду?');
  await ask.getByRole('button', { name: '14:00' }).click();
  await expect(ask).toHaveCount(0);
  expect(server.calls.find((c) => c.url.endsWith('/answer'))?.body).toEqual({ answer: '14:00' });

  // «Поправить»: агент исправляет сразу, ответ виден под файлом, текст обновился.
  const fix = page.getByRole('form', { name: 'Поправить' });
  await fix.getByLabel('Поправить').fill('Это не так, на самом деле по вт и чт');
  await fix.getByRole('button', { name: 'Поправить' }).click();
  await expect(fix).toContainText('Агент: Исправил: русский по вт и чт.');
  await expect(view).toContainText('Русский — по вт и чт');

  // Руками — сохранить с версией, которую видел.
  await view.getByRole('button', { name: 'Править' }).click();
  await view.getByLabel('Текст файла (Markdown)').fill('# Память\n\n- Ложусь в 23:00\n');
  await view.getByRole('button', { name: 'Сохранить' }).click();
  await expect(view).toContainText('Ложусь в 23:00');
  const put = server.calls.find((c) => c.method === 'PUT');
  expect(put?.body).toEqual({ body: '# Память\n\n- Ложусь в 23:00\n', revision: 2 });

  // «Кто я»: основа видна, но правится только «Твои правила».
  await tree.getByRole('button', { name: 'Кто я' }).click();
  const core = page.getByRole('article', { name: 'Кто я' });
  await expect(core.getByText('Основа — её пишем мы, агент её не меняет')).toBeVisible();
  await expect(core.getByRole('heading', { name: 'Твои правила' })).toBeVisible();

  // Разговор.
  await page.getByRole('radio', { name: 'Разговор' }).click();
  await page.getByRole('textbox', { name: 'Написать агенту' }).fill('Русский по вт и чт');
  await page.getByRole('button', { name: 'Отправить' }).click();
  const talk = page.getByRole('list', { name: 'Разговор с агентом' });
  await expect(talk).toContainText('Запомнил. Во сколько кончаются уроки в среду?');
  await expect(talk).toContainText('действий: 2');
});

test('«Когда писать»: как часто, «не сегодня», тишина и окна', async ({ page }) => {
  await mockSync(page);
  await page.route('**/api/v1/agent/timeline**', (route) =>
    route.fulfill({ json: { items: [], next: null } }),
  );
  const pace = {
    mode: 'auto',
    per_day: 3,
    not_today: false,
    limit: 3,
    sent: 1,
    quiet: null as string | null,
    in_qubite: true,
    windows: [{ from: '15:00', to: '17:00', minutes: 120 }],
    patterns: ['вт 16–18: свободен 3 из 3'],
  };
  const changes: Record<string, unknown>[] = [];
  await page.route('**/api/v1/agent/pace', (route) => {
    const req = route.request();
    if (req.method() === 'PATCH') {
      const change = req.postDataJSON() as Record<string, unknown>;
      changes.push(change);
      Object.assign(pace, change);
      if (change.mode === 'count') pace.limit = pace.per_day;
      if (change.not_today !== undefined)
        pace.quiet = change.not_today ? 'ты сказал «не сегодня»' : null;
    }
    return route.fulfill({ json: pace });
  });
  await page.goto('/agent');
  await page.getByRole('radio', { name: 'Когда писать' }).click();
  const box = page.locator('[data-obj="agent-pace"]');
  await expect(box).toContainText('Сегодня написал 1 из 3');
  await expect(box).toContainText('Свободно сегодня: 15:00–17:00.');
  await expect(box).toContainText('вт 16–18: свободен 3 из 3');

  await box.getByRole('radio', { name: 'Число в день' }).click();
  await expect.poll(() => changes.at(-1)).toEqual({ mode: 'count' });
  await expect(box.getByText('В день — не больше')).toBeVisible();

  await box.getByRole('button', { name: 'Не сегодня' }).click();
  await expect(box).toContainText('Сейчас молчит: ты сказал «не сегодня».');
  await expect(box.getByRole('button', { name: 'Снова можно сегодня' })).toBeVisible();
});

/** Навыки (AGT-003): экран «Навыки — все», закрепить, вернуть из архива; сервер подделан. */
test('навыки: список с описаниями, закрепить, в архив и вернуть', async ({ page }) => {
  await mockSync(page);
  await page.route('**/api/v1/agent/timeline**', (route) =>
    route.fulfill({ json: { items: [], next: null } }),
  );
  await page.route('**/api/v1/agent/questions', (route) =>
    route.fulfill({ json: { questions: [] } }),
  );
  await page.route('**/api/v1/agent/chat**', (route) =>
    route.fulfill({ json: { messages: [], pending: false } }),
  );
  const now = new Date();
  const later = new Date(now.getTime() + 30 * 86400000).toISOString();
  const skills = [
    {
      id: crypto.randomUUID(),
      path: 'Навыки/ДЗ к уроку.md',
      name: 'ДЗ к уроку',
      description: 'Как ставить домашнее задание — срок к следующему уроку.',
      version: 2,
      tools: ['task.create'],
      pinned: false,
      archived: false,
      builtin: true,
      uses: 3,
      last_used: now.toISOString(),
      archive_after: later,
      revision: 2,
      body: '---\nname: ДЗ к уроку\ndescription: Как ставить ДЗ\n---\n4. Сделать — вечером накануне урока.\n',
    },
    {
      id: crypto.randomUUID(),
      path: 'Навыки/Сходить куда-то.md',
      name: 'Сходить куда-то',
      description: 'Дела «сходить в музей» — со временем и запасом на дорогу.',
      version: 1,
      tools: ['task.create'],
      pinned: false,
      archived: true,
      builtin: true,
      uses: 0,
      last_used: now.toISOString(),
      archive_after: null,
      revision: 1,
      body: '---\nname: Сходить куда-то\ndescription: а\n---\n',
    },
  ];
  const memory = crypto.randomUUID();
  const calls: string[] = [];
  const fileInfo = (s: (typeof skills)[number]) => ({
    id: s.id,
    path: s.path,
    kind: 'skill',
    chars: s.body.length,
    limit: 6000,
    project_id: null,
    revision: s.revision,
    updated_at: now.toISOString(),
    pinned: s.pinned,
    archived: s.archived,
  });
  await page.route(/\/api\/v1\/agent\/(files|skills)/, (route) => {
    const req = route.request();
    const parts = new URL(req.url()).pathname.split('/').slice(4);
    if (parts[0] === 'skills' && parts.length === 1) {
      return route.fulfill({
        json: { skills: skills.map((s) => ({ ...s, body: undefined })), unused_days: 30 },
      });
    }
    if (parts[0] === 'skills') {
      calls.push(`${parts[2]} ${req.postData() ?? ''}`.trim());
      const s = skills.find((x) => x.id === parts[1])!;
      if (parts[2] === 'pin') s.pinned = (req.postDataJSON() as { pinned: boolean }).pinned;
      if (parts[2] === 'archive') s.archived = true;
      if (parts[2] === 'restore') s.archived = false;
      s.archive_after = s.pinned || s.archived ? null : later;
      return route.fulfill({ json: action({ actor: 'owner', tool: `skill.${parts[2]}` }) });
    }
    if (parts.length === 1) {
      return route.fulfill({
        json: {
          files: [
            {
              id: memory,
              path: 'Память.md',
              kind: 'memory',
              chars: 10,
              limit: 2200,
              project_id: null,
              revision: 1,
              updated_at: now.toISOString(),
              pinned: false,
              archived: false,
            },
            ...skills.map(fileInfo),
          ],
        },
      });
    }
    const s = skills.find((x) => x.id === parts[1]);
    if (!s) {
      return route.fulfill({
        json: {
          id: memory,
          path: 'Память.md',
          kind: 'memory',
          chars: 10,
          limit: 2200,
          project_id: null,
          revision: 1,
          updated_at: now.toISOString(),
          pinned: false,
          archived: false,
          body: '# Память\n',
          core: null,
        },
      });
    }
    return route.fulfill({ json: { ...fileInfo(s), body: s.body, core: null } });
  });

  await page.goto('/agent');
  await page.getByRole('radio', { name: 'Записи' }).click();
  const tree = page.getByRole('navigation', { name: 'Файлы агента' });
  await expect(tree).toContainText('Архив навыков');

  // «Навыки — все»: описания, когда пользовался, что уберёт куратор.
  await tree.getByRole('button', { name: 'Навыки — все' }).click();
  const screen = page.getByRole('region', { name: 'Навыки' });
  const live = screen.getByRole('list', { name: 'Навыки агента' });
  await expect(live).toContainText('Как ставить домашнее задание');
  await expect(live).toContainText('пользовался 3 раза');
  await expect(live).toContainText('в архив после');
  const archive = screen.getByRole('list', { name: 'Архив навыков' });
  await expect(archive).toContainText('Сходить куда-то');

  // Закрепить — куратор не трогает; вернуть из архива — одной кнопкой.
  await live.getByRole('button', { name: 'Закрепить' }).click();
  await expect(live).toContainText('закреплён: куратор не трогает');
  await archive.getByRole('button', { name: 'Вернуть из архива' }).click();
  await expect(screen.getByRole('list', { name: 'Архив навыков' })).toHaveCount(0);
  await expect(live).toContainText('Сходить куда-то');
  expect(calls).toEqual(['pin {"pinned":true}', 'restore']);

  // Открыть навык: текст, кнопки у файла, выгрузка как .md.
  await live.getByRole('button', { name: 'ДЗ к уроку' }).click();
  const view = page.getByRole('article', { name: 'ДЗ к уроку' });
  await expect(view).toContainText('вечером накануне урока');
  await expect(view.getByRole('link', { name: 'Скачать .md' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открепить' })).toBeVisible();
});
