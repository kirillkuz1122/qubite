import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { SyncClient, type Transport } from './client';
import { HttpError, csrfFromCookie, httpTransport } from './http';
import { archiveThought, captureThought, inboxItems, titleFrom, unarchiveThought } from './inbox';
import type { ObjectSnapshot, OpResult, PushRequest, PushResponse } from './protocol';
import { CLOSE_FORBIDDEN, watchChanges } from './watch';

/** Сервер Входящих в памяти: поля модуля, статус ставит сам, как настоящий. */
class InboxServer implements Transport {
  objects = new Map<string, ObjectSnapshot>();
  log: string[] = [];
  received: PushRequest[] = [];
  offline = false;

  async push(request: PushRequest): Promise<PushResponse> {
    if (this.offline) throw new Error('нет сети');
    this.received.push(request);
    const results = request.ops.map((op): OpResult => {
      const current = this.objects.get(op.object_id);
      if (op.kind === 'create') {
        this.objects.set(op.object_id, {
          id: op.object_id,
          object_type: op.object_type,
          title: op.title,
          revision: 1,
          deleted: false,
          updated_at_ms: Date.now(),
          fields: { ...op.fields, status: 'new', triage: { status: 'pending' } },
        });
        this.log.push(op.object_id);
        return { status: 'applied', op_id: op.op_id, revision: 1 };
      }
      if (!current)
        return { status: 'rejected', op_id: op.op_id, reason: 'not_found', message: '' };
      if (current.revision !== op.base_revision)
        return { status: 'conflict', op_id: op.op_id, current };
      const next: ObjectSnapshot = { ...current, revision: current.revision + 1 };
      if (op.kind === 'patch') next.fields = { ...current.fields, ...op.fields };
      if (op.kind === 'delete') next.deleted = true;
      if (op.kind === 'restore') next.deleted = false;
      this.objects.set(op.object_id, next);
      this.log.push(op.object_id);
      return { status: 'applied', op_id: op.op_id, revision: next.revision };
    });
    return { results };
  }

  async pull(cursor: number) {
    if (this.offline) throw new Error('нет сети');
    const ids = [...new Set(this.log.slice(cursor))];
    return {
      changes: ids.map((id) => this.objects.get(id)!),
      cursor: this.log.length,
      has_more: false,
    };
  }
}

let dbCounter = 0;
const open = (transport: Transport, dbName = `inbox-${++dbCounter}`) =>
  SyncClient.open({ dbName, transport });

describe('Входящие без сети', () => {
  it('мысль без сети сохраняется, а на сервер уходит со временем записи', async () => {
    const server = new InboxServer();
    server.offline = true;
    const dbName = `inbox-${++dbCounter}`;
    let client = await open(server, dbName);
    const writtenAt = Date.UTC(2026, 9, 19, 2, 0);
    const item = await captureThought(client, 'Повторить графы\nк пятнице', {
      now: writtenAt,
      tz: 'Asia/Yekaterinburg',
    });
    expect(item.title).toBe('Повторить графы');
    expect(item.fields).toMatchObject({
      status: 'new',
      kind: 'text',
      body: 'Повторить графы\nк пятнице',
    });
    expect((await client.sync()).status).toBe('error');

    // Вкладку закрыли — мысль на устройстве, в очереди.
    client.close();
    client = await open(server, dbName);
    expect((await inboxItems(client)).map((i) => i.id)).toEqual([item.id]);
    expect(client.state().status).toBe('saved_local');

    // Сеть вернулась.
    server.offline = false;
    expect((await client.sync()).status).toBe('synced');
    const sent = server.received[0]!.ops[0]!;
    expect(sent.kind === 'create' && sent.fields).toEqual({
      body: 'Повторить графы\nк пятнице',
      source: 'web',
      captured_at_ms: writtenAt,
      // по поясу устройства сервер поймёт «к пятнице» (CMD-003)
      tz: 'Asia/Yekaterinburg',
    });
    expect(server.objects.get(item.id)?.fields?.status).toBe('new');
    client.close();
  });

  it('архив и возврат без сети — правки полей, без потерь', async () => {
    const server = new InboxServer();
    const client = await open(server);
    const item = await captureThought(client, 'https://example.ru статья', {
      url: 'https://example.ru',
    });
    await client.sync();
    server.offline = true;
    await archiveThought(client, item.id);
    expect(await inboxItems(client, 'new')).toEqual([]);
    expect((await inboxItems(client, 'archived')).map((i) => i.id)).toEqual([item.id]);
    await unarchiveThought(client, item.id);
    await archiveThought(client, item.id);
    server.offline = false;
    expect((await client.sync()).status).toBe('synced');
    const stored = server.objects.get(item.id)!;
    expect(stored.revision).toBe(4);
    expect(stored.fields?.status).toBe('archived');
    expect(stored.fields?.url).toBe('https://example.ru');
    client.close();
  });

  it('«посмотри сам» — отдельный список из пришедших с сервера полей', async () => {
    const server = new InboxServer();
    const client = await open(server);
    const item = await captureThought(client, 'графы или олимпиада?');
    await client.sync();
    const stored = server.objects.get(item.id)!;
    server.objects.set(item.id, {
      ...stored,
      revision: 2,
      fields: { ...stored.fields, needs_review: true, review_reason: 'Не уверен' },
    });
    server.log.push(item.id);
    await client.sync();
    expect((await inboxItems(client, 'review')).map((i) => i.id)).toEqual([item.id]);
    expect((await inboxItems(client, 'new')).map((i) => i.id)).toEqual([item.id]);
    client.close();
  });

  it('мысль с другого устройства приходит с полями', async () => {
    const server = new InboxServer();
    const phone = await open(server);
    const laptop = await open(server);
    await captureThought(phone, 'с телефона', { source: 'android' });
    await phone.sync();
    await laptop.sync();
    const [item] = await inboxItems(laptop);
    expect(item?.fields).toMatchObject({ source: 'android', status: 'new' });
    expect(item?.pending).toBe(false);
    phone.close();
    laptop.close();
  });

  it('пустую мысль не записать; длинный заголовок обрезается', async () => {
    const client = await open(new InboxServer());
    await expect(captureThought(client, '   ')).rejects.toThrow('пустая');
    expect(Array.from(titleFrom(`\n\n  ${'я'.repeat(300)}`)).length).toBe(200);
    expect(titleFrom('  первая  \nвторая')).toBe('первая');
    client.close();
  });
});

describe('HTTP-транспорт', () => {
  it('cookie + CSRF у браузера, Bearer у приложения', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(JSON.stringify({ results: [], changes: [], cursor: 0, has_more: false }));
    });
    const browser = httpTransport({ baseUrl: 'https://q.example', fetch, csrf: () => 'csrf-1' });
    await browser.push({ device_id: 'd', ops: [] });
    await browser.pull(5, 100);
    expect(calls[0]!.url).toBe('https://q.example/api/v1/sync/push');
    expect(new Headers(calls[0]!.init.headers).get('x-csrf-token')).toBe('csrf-1');
    expect(calls[0]!.init.credentials).toBe('include');
    expect(calls[1]!.url).toBe('https://q.example/api/v1/sync/pull?cursor=5&limit=100');
    expect(new Headers(calls[1]!.init.headers).has('x-csrf-token')).toBe(false);

    const app = httpTransport({ fetch, token: () => 'access', csrf: () => 'csrf-1' });
    await app.push({ device_id: 'd', ops: [] });
    const headers = new Headers(calls[2]!.init.headers);
    expect(headers.get('authorization')).toBe('Bearer access');
    expect(headers.has('x-csrf-token')).toBe(false);
    expect(calls[2]!.init.credentials).toBe('omit');
  });

  it('ошибка сервера с кодом; CSRF из cookie', async () => {
    const fetch = async () =>
      new Response(JSON.stringify({ error: 'unauthenticated', message: 'Нужно войти' }), {
        status: 401,
      });
    const transport = httpTransport({ fetch });
    const error = await transport.pull(0, 10).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).code).toBe('unauthenticated');
    expect(csrfFromCookie('a=1; qubite_csrf=abc%3D; b=2')).toBe('abc=');
    expect(csrfFromCookie('a=1')).toBeUndefined();
  });
});

class FakeSocket {
  static all: FakeSocket[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  say(type: string) {
    this.onmessage?.({ data: JSON.stringify({ type }) } as MessageEvent);
  }
  drop(code = 1006) {
    this.onclose?.({ code } as CloseEvent);
  }
  close() {
    this.closed = true;
  }
}

describe('WebSocket «есть новое»', () => {
  it('подсказка и появление сети запускают синхронизацию; обрыв — переподключение', async () => {
    FakeSocket.all = [];
    const server = new InboxServer();
    const client = await open(server);
    const sync = vi.spyOn(client, 'sync');
    const events = new EventTarget();
    const timers: { callback: () => void; ms: number }[] = [];
    const stop = watchChanges(client, {
      url: 'ws://q/api/v1/sync/ws',
      WebSocket: FakeSocket as unknown as typeof WebSocket,
      events,
      setTimeout: (callback, ms) => timers.push({ callback, ms }),
      clearTimeout: () => {},
    });
    const first = FakeSocket.all[0]!;
    first.say('ready');
    first.say('changed');
    first.say('непонятное');
    expect(sync).toHaveBeenCalledTimes(2);
    events.dispatchEvent(new Event('online'));
    expect(sync).toHaveBeenCalledTimes(3);

    first.drop();
    expect(timers.map((t) => t.ms)).toEqual([1000]);
    timers[0]!.callback();
    const second = FakeSocket.all[1]!;
    second.drop();
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000]);

    stop();
    events.dispatchEvent(new Event('online'));
    expect(sync).toHaveBeenCalledTimes(3);
    client.close();
  });

  it('права отозваны (4403) — больше не подключается', async () => {
    FakeSocket.all = [];
    const client = await open(new InboxServer());
    const onDenied = vi.fn();
    const timers: unknown[] = [];
    watchChanges(client, {
      url: 'ws://q/api/v1/sync/ws',
      WebSocket: FakeSocket as unknown as typeof WebSocket,
      events: new EventTarget(),
      onDenied,
      setTimeout: (callback) => timers.push(callback),
    });
    FakeSocket.all[0]!.drop(CLOSE_FORBIDDEN);
    expect(onDenied).toHaveBeenCalledOnce();
    expect(timers).toEqual([]);
    client.close();
  });
});
