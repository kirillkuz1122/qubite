import type { Page, WebSocketRoute } from '@playwright/test';
import { USER } from './auth-mock';

/**
 * Поддельный сервер синхронизации: `/api/v1/sync/push`, `/pull` и WebSocket. Синхронизация —
 * только после входа, поэтому человек уже вошёл (cookie и `/api/auth/me`, D-229).
 */
export interface SyncMock {
  objects: Map<string, Record<string, unknown>>;
  /** все операции, которые прислал браузер */
  ops: Record<string, unknown>[];
  /** сеть «пропала»: push и pull обрываются */
  offline: boolean;
  /** мысль появилась «на другом устройстве»; `fields` — поверх обычных (разбор и т. п.); вернёт ID */
  addElsewhere(text: string, source?: string, fields?: Record<string, unknown>): string;
  /** объект поменяли на сервере (агент разложил, откат): поля поверх, версия +1 */
  patch(id: string, fields: Record<string, unknown>): void;
  /** проект Planner «с другого устройства»; вернёт ID */
  addProject(title: string, fields?: Record<string, unknown>): string;
  /** дело Planner «с другого устройства»; вернёт ID */
  addTask(title: string, fields?: Record<string, unknown>): string;
  /** Документ, пришедший с другого устройства. */
  addDoc(title: string, fields?: Record<string, unknown>): string;
  /** сказать браузеру «есть новое» */
  ping(): void;
  /** колокольчик (PLAN-004): сообщения как в `GET /api/v1/notifications` */
  notices: Record<string, unknown>[];
  /** вкладка видна — последние отметки присутствия */
  presence: boolean[];
}

export async function mockSync(page: Page): Promise<SyncMock> {
  const log: string[] = [];
  const sockets: WebSocketRoute[] = [];
  const put = (object_type: string, title: string, fields: Record<string, unknown>) => {
    const id = crypto.randomUUID();
    mock.objects.set(id, {
      id,
      object_type,
      title,
      revision: 1,
      deleted: false,
      updated_at_ms: Date.now(),
      fields,
    });
    log.push(id);
    return id;
  };
  const mock: SyncMock = {
    objects: new Map(),
    ops: [],
    offline: false,
    addElsewhere(text, source = 'telegram', fields = {}) {
      return put('inbox.item', text, {
        body: text,
        source,
        kind: 'text',
        status: 'new',
        captured_at_ms: Date.now(),
        ...fields,
      });
    },
    patch(id, fields) {
      const current = mock.objects.get(id)!;
      mock.objects.set(id, {
        ...current,
        revision: (current.revision as number) + 1,
        updated_at_ms: Date.now(),
        fields: { ...(current.fields as object), ...fields },
      });
      log.push(id);
    },
    addProject(title, fields = {}) {
      return put('planner.project', title, { color: 'orange', status: 'active', ...fields });
    },
    addTask(title, fields = {}) {
      return put('planner.task', title, {
        status: 'todo',
        priority: 'normal',
        subtasks: [],
        ...fields,
      });
    },
    addDoc(title, fields = {}) {
      return put('docs.page', title, { preview: '', has_ystate: false, ...fields });
    },
    ping() {
      for (const ws of sockets) ws.send(JSON.stringify({ type: 'changed' }));
    },
    notices: [],
    presence: [],
  };

  await page
    .context()
    .addCookies([{ name: 'qubite_csrf', value: 'e2e-csrf', domain: '127.0.0.1', path: '/' }]);
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/v1/sync/push', async (route) => {
    if (mock.offline) return route.abort('internetdisconnected');
    const body = route.request().postDataJSON() as { ops: Record<string, unknown>[] };
    const results = body.ops.map((op) => {
      mock.ops.push(op);
      const id = op.object_id as string;
      const current = mock.objects.get(id);
      if (op.kind === 'create') {
        mock.objects.set(id, {
          id,
          object_type: op.object_type,
          title: op.title,
          revision: 1,
          deleted: false,
          updated_at_ms: Date.now(),
          // статус по умолчанию ставит сервер, как настоящий
          fields: {
            ...(op.object_type === 'inbox.item' ? { status: 'new' } : {}),
            ...(op.object_type === 'planner.task' ? { status: 'todo' } : {}),
            ...(op.fields as object),
          },
        });
      } else if (current && op.kind === 'set_title') {
        mock.objects.set(id, {
          ...current,
          title: op.title,
          revision: (current.revision as number) + 1,
        });
      } else if (current && op.kind === 'patch') {
        mock.objects.set(id, {
          ...current,
          revision: (current.revision as number) + 1,
          fields: { ...(current.fields as object), ...(op.fields as object) },
        });
      }
      log.push(id);
      return { status: 'applied', op_id: op.op_id, revision: mock.objects.get(id)?.revision ?? 1 };
    });
    return route.fulfill({ json: { results } });
  });

  await page.route('**/api/v1/sync/pull?**', async (route) => {
    if (mock.offline) return route.abort('internetdisconnected');
    const cursor = Number(new URL(route.request().url()).searchParams.get('cursor') ?? 0);
    const ids = [...new Set(log.slice(cursor))];
    return route.fulfill({
      json: { changes: ids.map((id) => mock.objects.get(id)), cursor: log.length, has_more: false },
    });
  });

  await page.route('**/api/v1/notifications**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'GET' && path === '/api/v1/notifications')
      return route.fulfill({
        json: {
          items: mock.notices.map((n) => ({ options: [], answer: null, ...n })),
          unread: mock.notices.filter((n) => !n.read_at).length,
        },
      });
    if (path === '/api/v1/notifications/presence') {
      mock.presence.push((req.postDataJSON() as { visible: boolean }).visible);
      return route.fulfill({ status: 204 });
    }
    const read = path.match(/^\/api\/v1\/notifications\/([^/]+)\/read$/);
    if (req.method() === 'POST' && read) {
      const n = mock.notices.find((x) => x.id === read[1]);
      if (!n) return route.fulfill({ status: 404, json: { error: 'not_found', message: '' } });
      n.read_at ??= new Date().toISOString();
      return route.fulfill({ status: 204 });
    }
    // Ответ кнопкой агенту (AGT-004): запомнить ответ, погасить.
    const answered = path.match(/^\/api\/v1\/notifications\/([^/]+)\/answer$/);
    if (req.method() === 'POST' && answered) {
      const n = mock.notices.find((x) => x.id === answered[1]);
      if (!n) return route.fulfill({ status: 404, json: { error: 'not_found', message: '' } });
      n.answer = (req.postDataJSON() as { answer: string }).answer;
      n.read_at ??= new Date().toISOString();
      return route.fulfill({ json: { accepted: true, hint: 'Ответ принят' } });
    }
    if (path === '/api/v1/notifications/read-all') {
      const unread = mock.notices.filter((n) => !n.read_at);
      for (const n of unread) n.read_at = new Date().toISOString();
      return route.fulfill({ json: { read: unread.length } });
    }
    return route.fulfill({ status: 404, json: { error: 'not_found', message: '' } });
  });

  await page.routeWebSocket('**/api/v1/sync/ws', (ws) => {
    sockets.push(ws);
    ws.send(JSON.stringify({ type: 'ready' }));
  });
  return mock;
}
