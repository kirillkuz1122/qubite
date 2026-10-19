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
  /** объект появился «на другом устройстве» */
  addElsewhere(text: string, source?: string): void;
  /** сказать браузеру «есть новое» */
  ping(): void;
}

export async function mockSync(page: Page): Promise<SyncMock> {
  const log: string[] = [];
  const sockets: WebSocketRoute[] = [];
  const mock: SyncMock = {
    objects: new Map(),
    ops: [],
    offline: false,
    addElsewhere(text, source = 'telegram') {
      const id = crypto.randomUUID();
      mock.objects.set(id, {
        id,
        object_type: 'inbox.item',
        title: text,
        revision: 1,
        deleted: false,
        updated_at_ms: Date.now(),
        fields: { body: text, source, kind: 'text', status: 'new', captured_at_ms: Date.now() },
      });
      log.push(id);
    },
    ping() {
      for (const ws of sockets) ws.send(JSON.stringify({ type: 'changed' }));
    },
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
          fields: { ...(op.fields as object), status: 'new' },
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

  await page.routeWebSocket('**/api/v1/sync/ws', (ws) => {
    sockets.push(ws);
    ws.send(JSON.stringify({ type: 'ready' }));
  });
  return mock;
}
