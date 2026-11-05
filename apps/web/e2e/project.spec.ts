import { expect, test, type Page } from '@playwright/test';
import { mockSync, type SyncMock } from './sync-mock';
import { mockDocs } from './docs-mock';

/*
 * Проект как папка (PROJ-001): страница проекта из Planner и по прямой ссылке — дело, файл,
 * документ, память агента и лента. Сервер подделан: дела — синхронизацией (sync-mock), файлы,
 * документы и страница — `/api/v1/projects/*` в памяти теста.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const day = (shift = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + shift);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

interface Doc {
  id: string;
  title: string;
  body: string;
  revision: number;
  projects: string[];
}

/** Сервер страницы проекта: файлы, документы, память и лента — в памяти. */
async function mockProjects(page: Page, server: SyncMock) {
  const docsApi = await mockDocs(page, server);
  const files = new Map<string, { name: string; size: number; mime: string; body: string }[]>();
  const docs: Doc[] = [];
  const memory = new Map<string, { file_id: string; path: string; body: string }>();
  const feed: {
    project: string;
    kind: string;
    object: string;
    title: string;
    details: string[];
  }[] = [];
  let seq = 0;
  const now = () => new Date().toISOString();
  const docItem = (d: Doc) => ({
    id: d.id,
    title: d.title,
    preview: d.body.split('\n').find((l) => l.trim()) ?? '',
    revision: d.revision,
    project_ids: d.projects,
    updated_at: now(),
  });
  const note = (project: string, kind: string, object: string, title: string, details: string[]) =>
    feed.push({ project, kind, object, title, details });

  await page.route('**/api/v1/agent/timeline**', (route) =>
    route.fulfill({ json: { items: [], next: null } }),
  );
  await page.route('**/api/v1/agent/files', async (route) => {
    const { path, body } = route.request().postDataJSON() as { path: string; body: string };
    const project = [...server.objects.values()].find(
      (o) => o.object_type === 'planner.project' && `Проекты/${o.title as string}.md` === path,
    );
    const file_id = crypto.randomUUID();
    if (project) memory.set(project.id as string, { file_id, path, body });
    return route.fulfill({ json: { id: crypto.randomUUID() } });
  });
  await page.route('**/api/v1/docs**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/y')) return route.fallback();
    if (path === '/api/v1/docs') return route.fulfill({ json: { docs: docs.map(docItem) } });
    const doc = docs.find((d) => path.endsWith(d.id));
    if (!doc) return route.fulfill({ status: 404, json: { error: 'not_found', message: '' } });
    return route.fulfill({ json: { ...docItem(doc), body: doc.body } });
  });
  await page.route('**/api/v1/projects/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const [, , , , id, part, rest] = url.pathname.split('/');
    const project = server.objects.get(id!);
    if (!project) return route.fulfill({ status: 404, json: { error: 'not_found', message: '' } });
    const own = files.get(id!) ?? [];
    files.set(id!, own);
    if (part === 'files' && req.method() === 'POST') {
      const name = url.searchParams.get('name')!;
      const body = req.postData() ?? '';
      const file = { name, size: body.length, mime: req.headers()['content-type'] ?? '', body };
      own.push(file);
      note(id!, 'file_added', 'project', project.title as string, [name]);
      return route.fulfill({
        status: 201,
        json: { ...file, sha256: '0'.repeat(64), created_at: now() },
      });
    }
    if (part === 'files' && req.method() === 'GET') {
      const file = own.find((f) => f.name === decodeURIComponent(rest!));
      return route.fulfill({ body: file?.body ?? '', contentType: 'application/octet-stream' });
    }
    if (part === 'docs' && req.method() === 'POST' && !rest) {
      const { title, body } = req.postDataJSON() as { title: string; body: string };
      const doc = { id: docsApi.add(title, body), title, body, revision: 1, projects: [id!] };
      server.ping();
      docs.push(doc);
      note(id!, 'created', 'doc', title, []);
      return route.fulfill({ status: 201, json: { ...docItem(doc), body } });
    }
    if (part === 'feed') return route.fulfill({ json: { items: [] } });
    const tasks = [...server.objects.values()].filter(
      (o) =>
        o.object_type === 'planner.task' && (o.fields as Record<string, unknown>).project_id === id,
    );
    for (const t of tasks)
      if (!feed.some((f) => f.title === t.title))
        note(id!, 'created', 'task', t.title as string, []);
    const fields = project.fields as Record<string, string>;
    return route.fulfill({
      json: {
        project: {
          id,
          title: project.title,
          color: fields.color ?? 'orange',
          tag: fields.tag ?? '',
          status: fields.status ?? 'active',
          notes: fields.notes ?? '',
          revision: project.revision,
          created_at: now(),
        },
        tasks: [],
        files: own.map((f) => ({ ...f, sha256: '0'.repeat(64), created_at: now() })),
        docs: docs.filter((d) => d.projects.includes(id!)).map(docItem),
        agent: true,
        memory: memory.has(id!)
          ? { ...memory.get(id!)!, chars: 0, limit: 3000, revision: 1, updated_at: now() }
          : null,
        memory_path: `Проекты/${project.title}.md`,
        feed: feed
          .filter((f) => f.project === id)
          .map((f) => ({ ...f, seq: ++seq, at: now(), object_id: id, by: 'owner' }))
          .reverse(),
        events: [],
      },
    });
  });
  return { files, docs };
}

test('проект как папка: дело, файл, документ, память, лента', async ({ page }) => {
  const server = await mockSync(page);
  const qubite = server.addProject('Qubite', {
    color: 'sky',
    tag: 'qubite',
    notes: 'Личная цифровая среда',
  });
  server.addTask('Проект как папка', { project_id: qubite, due_date: day(1), due_time: '16:00' });
  const store = await mockProjects(page, server);

  // Из Planner: строка проекта → «Открыть проект →»
  await page.goto('/planner');
  await page.locator('.proj').filter({ hasText: 'Qubite' }).click();
  await page.getByRole('button', { name: 'Открыть проект →' }).click();
  await expect(page).toHaveURL(new RegExp(`/planner/project/${qubite}$`));
  const head = page.getByRole('region', { name: 'Проект Qubite' });
  await expect(head).toContainText('#qubite');
  await expect(head).toContainText('Личная цифровая среда');

  // Задачи: новое дело сразу в проекте
  await expect(page.locator('.pp-task-card').filter({ hasText: 'Проект как папка' })).toContainText(
    'завтра',
  );
  await page.getByRole('textbox', { name: 'Новое дело', exact: true }).fill('Календарь в пятницу');
  await page.getByRole('button', { name: 'Добавить' }).click();
  await expect(page.locator('.pp-task-card').filter({ hasText: 'Календарь' })).toBeVisible();
  await expect
    .poll(() => server.ops.find((op) => op.kind === 'create' && op.object_type === 'planner.task'))
    .toMatchObject({ title: 'Календарь', fields: { project_id: qubite } });

  // События: дела со сроком по дням
  await page.getByRole('radio', { name: 'События' }).click();
  await expect(page.getByRole('region', { name: /^завтра/ })).toContainText('Проект как папка');

  // Файлы: положить файл и создать документ
  await page.getByRole('radio', { name: 'Файлы' }).click();
  await page.getByLabel('Выбрать файлы').setInputFiles({
    name: 'план.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('шаги проекта'),
  });
  const list = page.getByRole('list', { name: 'Файлы проекта' });
  await expect(list).toContainText('план.txt');
  expect(store.files.get(qubite)![0]!.body).toBe('шаги проекта');
  await expect(list.getByRole('link', { name: 'план.txt' })).toHaveAttribute(
    'href',
    `/api/v1/projects/${qubite}/files/%D0%BF%D0%BB%D0%B0%D0%BD.txt`,
  );

  await page.getByRole('button', { name: '+ Документ' }).click();
  const form = page.getByRole('form', { name: 'Новый документ' });
  await form.getByLabel('Название').fill('Устройство Qubite');
  await form.getByRole('button', { name: 'Создать' }).click();
  await expect(page).toHaveURL(/\/docs\/[\w-]+$/);
  const editor = page.getByRole('textbox', { name: 'Текст документа' });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText('Rust и React');
  await expect(editor).toContainText('Rust и React');
  await page.goto(`/planner/project/${qubite}`);
  await page.getByRole('radio', { name: 'Файлы' }).click();
  await expect(page.getByRole('list', { name: 'Документы проекта' })).toContainText(
    'Устройство Qubite',
  );
  expect(store.docs[0]).toMatchObject({ title: 'Устройство Qubite', projects: [qubite] });
  await expect(page.getByText('Скоро: редактор кода', { exact: false })).toBeVisible();

  // Память: завести файл проекта в папке агента
  await page.getByRole('radio', { name: 'Память' }).click();
  await page.getByRole('button', { name: 'Завести файл проекта' }).click();
  await expect(page.getByRole('region', { name: 'Память агента о проекте' })).toContainText(
    'Проекты/Qubite.md',
  );

  // Лента: что происходило
  await page.getByRole('radio', { name: 'Лента' }).click();
  const feed = page.getByRole('list', { name: 'Изменения в проекте' });
  await expect(feed).toContainText('Файл «план.txt» добавлен');
  await expect(feed).toContainText('Документ «Устройство Qubite» — новый');
  await expect(feed).toContainText('Дело «Проект как папка» — новое');

  // На телефоне 360 px страница не уезжает вбок — когда вкладка доехала (Swap въезжает сбоку,
  // в медленном браузере замер мог попасть в середину въезда)
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
});

test('прямая ссылка на проект и правка заголовка', async ({ page }) => {
  const server = await mockSync(page);
  const qubite = server.addProject('Кубит', { tag: 'кубит' });
  await mockProjects(page, server);

  await page.goto(`/planner/project/${qubite}`);
  await expect(page.getByRole('region', { name: 'Проект Кубит' })).toBeVisible();
  await page.getByRole('button', { name: 'Меню проекта' }).click();
  await page.getByRole('button', { name: 'Править' }).click();
  const form = page.getByRole('form', { name: 'Править проект' });
  await form.getByLabel('Название').fill('Qubite');
  await form.getByLabel('Описание').fill('Личная цифровая среда');
  await form.getByRole('radio', { name: 'Зелёный' }).click();
  await form.getByRole('button', { name: 'Сохранить' }).click();
  const head = page.getByRole('region', { name: 'Проект Qubite' });
  await expect(head).toContainText('Личная цифровая среда');
  await expect.poll(() => server.objects.get(qubite)?.title).toBe('Qubite');
  expect(server.objects.get(qubite)?.fields).toMatchObject({
    color: 'green',
    notes: 'Личная цифровая среда',
  });

  // Нет такого проекта — понятное сообщение и дорога назад
  await page.goto('/planner/project/00000000-0000-0000-0000-000000000000');
  await expect(page.getByText('Такого проекта нет', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '← Все проекты' }).click();
  await expect(page).toHaveURL(/\/planner$/);
});
