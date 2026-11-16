/**
 * Локальные правки не теряются и не «застревают» (SYNC-008).
 *
 * Первые два теста — воспроизведения из ревью 12.11.2026
 * (`docs/reports/code-review-2026-11-12-reproduction.md`, замечания 5 и 6),
 * перевёрнутые: раньше они подтверждали ошибку, теперь проверяют правильное поведение.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { SyncClient, type Transport } from './client';
import { ACCOUNT_HEADER, HttpError, httpTransport } from './http';
import type { Cursor, ObjectSnapshot, OpResult, Operation, PushRequest } from './protocol';
import { LocalStore, promisify } from './store';
import { uuidv7 } from './uuid';

function task(title: string, revision = 1): ObjectSnapshot {
  return {
    id: uuidv7(),
    object_type: 'planner.task',
    title,
    revision,
    deleted: false,
    updated_at_ms: 1,
  };
}

const offline: Transport = {
  push: async () => {
    throw new Error('нет сети');
  },
  pull: async () => {
    throw new Error('нет сети');
  },
};

interface FakeServer {
  /** что сервер отдаст следующим `pull` (и забудет) */
  changes: ObjectSnapshot[];
  pushed: Operation[];
  pulls: Cursor[];
  reply: (op: Operation) => OpResult;
  transport: Transport;
}

/** Сервер, который отдаёт заданные снимки и отвечает на операции как велено. */
function server(initial: ObjectSnapshot[] = []): FakeServer {
  const state: FakeServer = {
    changes: initial,
    pushed: [],
    pulls: [],
    reply: (op) => ({
      status: 'rejected',
      op_id: op.op_id,
      reason: 'forbidden',
      message: 'доступ отозван',
    }),
    transport: {
      push: async ({ ops }: PushRequest) => {
        state.pushed.push(...ops);
        return { results: ops.map((op) => state.reply(op)) };
      },
      pull: async (cursor: Cursor) => {
        state.pulls.push(cursor);
        const changes = state.changes;
        state.changes = [];
        return { changes, cursor: `2.planner-${state.pulls.length}`, has_more: false };
      },
    },
  };
  return state;
}

describe('отклонённая правка (замечание 5)', () => {
  it('объект возвращается к версии сервера и дальше обновляется', async () => {
    const original = task('server original');
    const remote = server([original]);
    const c = await SyncClient.open({ dbName: uuidv7(), transport: remote.transport });
    await c.sync();

    await c.setTitle(original.id, 'rejected local title');
    expect((await c.get(original.id))?.pending).toBe(true);
    const state = await c.sync();
    expect(state).toMatchObject({ status: 'conflict', problems: 1, pending: 0 });
    // Правку сервер не принял — на экране снова то, что на сервере, и объект не «занят».
    expect(await c.get(original.id)).toEqual({ ...original, pending: false });
    const [problem] = await c.problems();
    expect(problem?.op).toMatchObject({ kind: 'set_title', title: 'rejected local title' });

    await c.dismissProblem(problem!.op.op_id);
    remote.changes = [{ ...original, title: 'fresh server title', revision: 3 }];
    await c.sync();
    expect(c.state().status).toBe('synced');
    expect(await c.get(original.id)).toMatchObject({
      title: 'fresh server title',
      revision: 3,
      pending: false,
    });
    c.close();
  });

  it('снимок, пришедший пока правка ждала отправки, не теряется', async () => {
    const original = task('v1');
    const remote = server([original]);
    const c = await SyncClient.open({ dbName: uuidv7(), transport: remote.transport });
    await c.sync();
    await c.setTitle(original.id, 'моя правка');

    // Отправка не удалась, а изменения с другого устройства пришли.
    const push = remote.transport.push;
    remote.transport.push = async () => ({ results: [] });
    remote.changes = [{ ...original, title: 'с телефона', revision: 2 }];
    await c.sync();
    expect(await c.get(original.id)).toMatchObject({ title: 'моя правка', pending: true });

    // Теперь правку отклонили: возвращаемся к самой свежей версии сервера,
    // хотя курсор её уже «прошёл» и второй раз сервер её не пришлёт.
    remote.transport.push = push;
    await c.sync();
    expect(await c.get(original.id)).toEqual({
      ...original,
      title: 'с телефона',
      revision: 2,
      pending: false,
    });
    c.close();
  });

  it('несколько правок подряд: отклонены все — объект как на сервере', async () => {
    const original = { ...task('v1'), fields: { priority: 'normal', status: 'todo' } };
    const remote = server([original]);
    const c = await SyncClient.open({ dbName: uuidv7(), transport: remote.transport });
    await c.sync();
    await c.patch(original.id, { priority: 'high' });
    await c.setTitle(original.id, 'v2');
    await c.sync();
    expect(await c.get(original.id)).toEqual({ ...original, pending: false });
    expect(await c.problems()).toHaveLength(2);
    c.close();
  });

  it('первую правку отклонили, вторую приняли — побеждает снимок сервера', async () => {
    const original = { ...task('v1'), fields: { priority: 'normal' } };
    const remote = server([original]);
    const c = await SyncClient.open({ dbName: uuidv7(), transport: remote.transport });
    await c.sync();
    await c.patch(original.id, { priority: 'запрещённое' });
    await c.setTitle(original.id, 'v2');
    remote.reply = (op) =>
      op.kind === 'set_title'
        ? { status: 'applied', op_id: op.op_id, revision: 2 }
        : { status: 'rejected', op_id: op.op_id, reason: 'invalid', message: 'нельзя' };
    // Сервер принял только заголовок: версия 2, приоритет прежний. На устройстве
    // версия уже 3 — раньше снимок с меньшей версией отбрасывался.
    remote.transport.pull = async () => ({
      changes: [{ ...original, title: 'v2', revision: 2 }],
      cursor: '2.planner-9',
      has_more: false,
    });
    await c.sync();
    expect(await c.get(original.id)).toEqual({
      ...original,
      title: 'v2',
      revision: 2,
      pending: false,
    });
    c.close();
  });

  it('правка без сохранённой версии сервера (до SYNC-008): всё забирается заново', async () => {
    const original = task('server original', 5);
    const dbName = uuidv7();
    // Хранилище старой версии: объект «занят» отклонённой позже правкой, копии сервера нет.
    const store = await LocalStore.open(dbName);
    await store.commitLocal(
      { ...original, title: 'старая правка', revision: 6, pending: true },
      { op_id: uuidv7(), object_id: original.id, base_revision: 5, kind: 'set_title', title: 'x' },
    );
    await store.setMeta('cursor', '2.planner-40');
    store.close();

    const remote = server();
    const c = await SyncClient.open({ dbName, transport: remote.transport });
    // Сервер отдаёт объект только тому, кто спрашивает с начала.
    remote.transport.pull = async (cursor) => {
      remote.pulls.push(cursor);
      return {
        changes: cursor === 0 ? [original] : [],
        cursor: '2.planner-41',
        has_more: false,
      };
    };
    await c.sync();
    expect(remote.pulls).toEqual([0]);
    expect(await c.get(original.id)).toEqual({ ...original, pending: false });
    // Второй раз заново не забираем.
    await c.sync();
    expect(remote.pulls).toEqual([0, '2.planner-41']);
    c.close();
  });

  it('отклонённое создание по-прежнему убирает объект', async () => {
    const remote = server();
    const c = await SyncClient.open({ dbName: uuidv7(), transport: remote.transport });
    const created = await c.create('planner.task', 'нельзя');
    await c.sync();
    expect(await c.get(created.id)).toMatchObject({ deleted: true, pending: false });
    expect(await c.list()).toEqual([]);
    c.close();
  });
});

describe('параллельные правки (замечание 6)', () => {
  it('две правки разных полей одновременно сохраняются обе', async () => {
    const c = await SyncClient.open({ dbName: uuidv7(), transport: offline });
    const object = await c.create('planner.task', 'original', {
      priority: 'normal',
      status: 'todo',
    });
    await Promise.all([
      c.patch(object.id, { priority: 'high' }),
      c.patch(object.id, { status: 'done' }),
    ]);
    const current = await c.get(object.id);
    expect(current?.revision).toBe(3);
    expect(current?.fields).toEqual({ priority: 'high', status: 'done' });
    c.close();
  });

  it('две вкладки: правки встают в очередь с разными версиями', async () => {
    const dbName = uuidv7();
    const remote = server();
    remote.reply = (op) => ({ status: 'applied', op_id: op.op_id, revision: 1 });
    const first = await SyncClient.open({ dbName, transport: remote.transport });
    const second = await SyncClient.open({ dbName, transport: remote.transport });
    const object = await first.create('planner.task', 'original', { a: 0, b: 0 });
    await Promise.all(
      Array.from({ length: 10 }, (_, n) =>
        (n % 2 ? first : second).patch(object.id, n % 2 ? { a: n } : { b: n }),
      ),
    );
    expect(await second.get(object.id)).toMatchObject({ revision: 11, fields: { a: 9, b: 8 } });
    await first.sync();
    const bases = remote.pushed.map((op) => op.base_revision);
    expect(bases).toEqual([undefined, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    first.close();
    second.close();
  });

  it('правка, сделанная пока шла отправка, не затирается ответом сервера', async () => {
    const original = task('v1');
    const remote = server([original]);
    const c = await SyncClient.open({ dbName: uuidv7(), transport: remote.transport });
    await c.sync();
    await c.setTitle(original.id, 'v2');
    let during: Promise<unknown> = Promise.resolve();
    remote.reply = (op) => {
      // Ответ ещё в пути, а человек уже правит дальше.
      if (op.kind === 'set_title' && op.title === 'v2') during = c.setTitle(original.id, 'v3');
      return { status: 'applied', op_id: op.op_id, revision: op.base_revision! + 1 };
    };
    await c.sync();
    await during;
    await c.sync();
    expect(await c.get(original.id)).toMatchObject({ title: 'v3', revision: 3, pending: false });
    expect(remote.pushed.map((op) => op.base_revision)).toEqual([1, 2]);
    c.close();
  });

  it('правки несуществующего объекта нет — очередь не засоряется', async () => {
    const dbName = uuidv7();
    const c = await SyncClient.open({ dbName, transport: offline });
    await expect(c.setTitle(uuidv7(), 'x')).rejects.toThrow(/не найден/);
    expect(c.state().pending).toBe(0);
    c.close();
    const request = indexedDB.open(dbName);
    const db = await promisify(request);
    expect(await promisify(db.transaction('outbox').objectStore('outbox').count())).toBe(0);
    db.close();
  });
});

describe('запрос привязан к аккаунту (замечание 1)', () => {
  it('отправка и получение называют аккаунт; «вошёл другой» — сигнал приложению', async () => {
    const seen: Headers[] = [];
    let mismatches = 0;
    let status = 200;
    const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return status === 200
        ? new Response(JSON.stringify({ results: [], changes: [], cursor: 0, has_more: false }))
        : new Response(JSON.stringify({ error: 'account_mismatch', message: 'другой аккаунт' }), {
            status,
          });
    };
    const transport = httpTransport({
      fetch,
      csrf: () => 'csrf',
      account: 'account-a',
      onAccountMismatch: () => (mismatches += 1),
    });
    await transport.push({ device_id: 'd', ops: [] });
    await transport.pull(0, 10);
    expect(seen.map((headers) => headers.get(ACCOUNT_HEADER))).toEqual(['account-a', 'account-a']);
    expect(mismatches).toBe(0);

    status = 409;
    const error = await transport.push({ device_id: 'd', ops: [] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).code).toBe('account_mismatch');
    expect(mismatches).toBe(1);

    // Без аккаунта (приложение с токеном, тесты) заголовка нет.
    status = 200;
    await httpTransport({ fetch, token: () => 't' }).pull(0, 10);
    expect(seen.at(-1)!.has(ACCOUNT_HEADER)).toBe(false);
  });

  it('очередь остаётся на устройстве, если сервер ответил «вошёл другой»', async () => {
    const transport: Transport = {
      push: async () => {
        throw new HttpError(409, 'account_mismatch', 'В этом браузере уже вошёл другой аккаунт');
      },
      pull: async () => ({ changes: [], cursor: 0, has_more: false }),
    };
    const c = await SyncClient.open({ dbName: uuidv7(), transport });
    await c.create('inbox.item', 'PRIVATE-A');
    const state = await c.sync();
    expect(state).toMatchObject({ status: 'error', pending: 1 });
    c.close();
  });
});
