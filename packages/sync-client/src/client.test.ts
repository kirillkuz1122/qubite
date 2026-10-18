import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SyncClient, type Transport } from './client';
import type { ObjectSnapshot, OpResult, PullResponse, PushRequest, PushResponse } from './protocol';
import { uuidv7 } from './uuid';

/** Поддельный сервер с теми же правилами, что и настоящий (qubite-sync-server). */
class FakeServer implements Transport {
  objects = new Map<string, ObjectSnapshot>();
  applied = new Map<string, OpResult>();
  log: { seq: number; id: string }[] = [];
  offline = false;
  /** Применить пакет, но «потерять» ответ (обрыв связи после записи). */
  loseNextResponse = false;

  private touch(snapshot: ObjectSnapshot) {
    this.objects.set(snapshot.id, snapshot);
    this.log.push({ seq: this.log.length + 1, id: snapshot.id });
  }

  /** Объект, созданный «на другом устройстве». */
  createElsewhere(title: string): string {
    const id = uuidv7();
    this.touch({
      id,
      object_type: 'docs.note',
      title,
      revision: 1,
      deleted: false,
      updated_at_ms: 1,
    });
    return id;
  }

  /** Правка «с другого устройства». */
  editElsewhere(id: string, title: string) {
    const current = this.objects.get(id)!;
    this.touch({ ...current, title, revision: current.revision + 1 });
  }

  async push(request: PushRequest): Promise<PushResponse> {
    if (this.offline) throw new Error('нет сети');
    const results = request.ops.map((op): OpResult => {
      const seen = this.applied.get(op.op_id);
      if (seen) return seen;
      const current = this.objects.get(op.object_id);
      let result: OpResult;
      if (op.kind === 'create') {
        this.touch({
          id: op.object_id,
          object_type: op.object_type,
          title: op.title,
          revision: 1,
          deleted: false,
          updated_at_ms: Date.now(),
        });
        result = { status: 'applied', op_id: op.op_id, revision: 1 };
      } else if (!current) {
        result = { status: 'rejected', op_id: op.op_id, reason: 'not_found', message: 'нет' };
      } else if (current.revision !== op.base_revision) {
        result = { status: 'conflict', op_id: op.op_id, current };
      } else {
        const next = { ...current, revision: current.revision + 1 };
        if (op.kind === 'set_title') next.title = op.title;
        if (op.kind === 'delete') next.deleted = true;
        if (op.kind === 'restore') next.deleted = false;
        this.touch(next);
        result = { status: 'applied', op_id: op.op_id, revision: next.revision };
      }
      this.applied.set(op.op_id, result);
      return result;
    });
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new Error('ответ потерян');
    }
    return { results };
  }

  async pull(cursor: number, limit: number): Promise<PullResponse> {
    if (this.offline) throw new Error('нет сети');
    const rows = this.log.filter((row) => row.seq > cursor).slice(0, limit);
    const ids = [...new Set(rows.map((row) => row.id))];
    return {
      changes: ids.map((id) => this.objects.get(id)!),
      cursor: rows.at(-1)?.seq ?? cursor,
      has_more: rows.length === limit,
    };
  }
}

async function open(server: FakeServer, dbName = uuidv7()) {
  return { client: await SyncClient.open({ dbName, transport: server }), dbName };
}

describe('SyncClient', () => {
  it('мысль без сети сохраняется на устройстве и переживает перезагрузку', async () => {
    const server = new FakeServer();
    server.offline = true;
    const { client, dbName } = await open(server);

    const thought = await client.create('inbox.item', 'Завтра повторить графы');
    expect(client.state()).toMatchObject({ status: 'saved_local', pending: 1 });
    expect((await client.sync()).status).toBe('error');
    client.close();

    // «Перезагрузка страницы»: новое подключение к той же базе.
    const reopened = await SyncClient.open({ dbName, transport: server });
    expect((await reopened.list()).map((o) => o.title)).toEqual(['Завтра повторить графы']);
    expect(reopened.state()).toMatchObject({ status: 'saved_local', pending: 1 });

    server.offline = false;
    expect(await reopened.sync()).toMatchObject({ status: 'synced', pending: 0 });
    expect(server.objects.get(thought.id)?.title).toBe('Завтра повторить графы');
    expect((await reopened.get(thought.id))?.pending).toBe(false);
  });

  it('потерянный ответ сервера не создаёт дубль при повторной отправке', async () => {
    const server = new FakeServer();
    const { client } = await open(server);
    await client.create('inbox.item', 'одна мысль');

    server.loseNextResponse = true;
    expect((await client.sync()).status).toBe('error');
    expect(client.state().pending).toBe(1);

    expect((await client.sync()).status).toBe('synced');
    expect(server.objects.size).toBe(1);
  });

  it('цепочка офлайн-правок применяется по порядку', async () => {
    const server = new FakeServer();
    server.offline = true;
    const { client } = await open(server);
    const note = await client.create('docs.note', 'черновик');
    await client.setTitle(note.id, 'итог');
    await client.remove(note.id);
    expect(client.state().pending).toBe(3);

    server.offline = false;
    expect((await client.sync()).status).toBe('synced');
    expect(server.objects.get(note.id)).toMatchObject({
      title: 'итог',
      deleted: true,
      revision: 3,
    });
    expect(await client.list()).toEqual([]);
  });

  it('конфликт не теряет правку: серверная версия на экране, правка в «проблемах»', async () => {
    const server = new FakeServer();
    const { client } = await open(server);
    const note = await client.create('docs.note', 'v1');
    await client.sync();

    server.editElsewhere(note.id, 'с телефона');
    await client.setTitle(note.id, 'с ноутбука');
    const state = await client.sync();

    expect(state).toMatchObject({ status: 'conflict', problems: 1, pending: 0 });
    expect((await client.get(note.id))?.title).toBe('с телефона');
    const [problem] = await client.problems();
    expect(problem?.op).toMatchObject({ kind: 'set_title', title: 'с ноутбука' });

    await client.dismissProblem(problem!.op.op_id);
    expect(client.state().status).toBe('synced');
  });

  it('изменения с других устройств приходят, но не затирают неотправленное', async () => {
    const server = new FakeServer();
    const { client } = await open(server);
    const mine = await client.create('docs.note', 'моя');
    await client.sync();

    // Другое устройство создало заметку и поправило мою.
    server.createElsewhere('с планшета');
    server.editElsewhere(mine.id, 'чужая правка');

    server.offline = true;
    await client.setTitle(mine.id, 'моя правка офлайн');
    server.offline = false;
    // Сначала забираем без отправки: локальная правка должна остаться.
    await (client as unknown as { pullAll(): Promise<void> }).pullAll();
    expect((await client.get(mine.id))?.title).toBe('моя правка офлайн');
    expect((await client.list()).map((o) => o.title).sort()).toEqual([
      'моя правка офлайн',
      'с планшета',
    ]);
  });

  it('статус сообщается подписчикам', async () => {
    const server = new FakeServer();
    const { client } = await open(server);
    const seen: string[] = [];
    client.subscribe((state) => seen.push(state.status));
    await client.create('inbox.item', 'x');
    await client.sync();
    expect(seen).toEqual(['synced', 'saved_local', 'syncing', 'synced']);
  });
});

describe('протокол совпадает с Rust (qubite-sync/fixtures)', () => {
  const fixture = <T>(name: string): T =>
    JSON.parse(
      readFileSync(
        new URL(`../../../crates/qubite-sync/fixtures/${name}.json`, import.meta.url),
        'utf8',
      ),
    ) as T;

  it('образцы читаются как типы TS', () => {
    const push = fixture<PushRequest>('push_request');
    expect(push.ops.map((op) => op.kind)).toEqual(['create', 'patch', 'set_title', 'delete']);
    expect(push.ops[0]).not.toHaveProperty('base_revision');
    expect(push.ops[0]?.kind === 'create' && push.ops[0].fields?.source).toBe('web');
    expect(push.ops[1]?.kind === 'patch' && push.ops[1].fields).toEqual({ status: 'archived' });
    expect(push.ops[1]?.base_revision).toBe(1);

    const response = fixture<PushResponse>('push_response');
    expect(response.results.map((r) => r.status)).toEqual(['applied', 'conflict', 'rejected']);

    const pull = fixture<PullResponse>('pull_response');
    expect(Object.keys(pull.changes[0]!).sort()).toEqual(
      ['deleted', 'fields', 'id', 'object_type', 'revision', 'title', 'updated_at_ms'].sort(),
    );
  });
});

describe('uuidv7', () => {
  it('формат версии 7 и рост со временем', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});
