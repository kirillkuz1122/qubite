import { Buffer } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { SyncClient, type Transport } from './client';
import {
  DOCS_PAGE,
  DocStore,
  createDoc,
  docList,
  httpDocsTransport,
  renameDoc,
  type DocHandle,
  type DocsTransport,
  type DocStatus,
  type DocStoreOptions,
} from './docs';
import { HttpError } from './http';
import type { DocRestore, DocVersion } from './docs-versions';
import type { ObjectSnapshot, PushRequest } from './protocol';

/** Сервер только в памяти: никаких HTTP-запросов и зависимостей от Rust-сервера. */
class DocsServer implements DocsTransport {
  listVersions = vi.fn<DocsTransport['listVersions']>().mockResolvedValue([]);
  getVersion = vi.fn<DocsTransport['getVersion']>();
  createVersion = vi.fn<DocsTransport['createVersion']>();
  renameVersion = vi.fn<DocsTransport['renameVersion']>();
  deleteVersion = vi.fn<DocsTransport['deleteVersion']>().mockResolvedValue(undefined);
  listTrash = vi.fn<DocsTransport['listTrash']>().mockResolvedValue([]);
  readonly doc = new Y.Doc();
  offline = false;
  missing = false;
  seedMarkdown: string | null = null;
  text = '';
  pullError: HttpError | undefined;
  pushError: HttpError | undefined;
  beforePull: (() => Promise<void>) | undefined;
  beforePush: (() => Promise<void>) | undefined;
  loseResponse = false;
  alwaysStale = false;
  readonly pulls: { id: string; sv: Uint8Array }[] = [];
  readonly pushes: {
    id: string;
    update: Uint8Array;
    text: string;
    seed?: boolean;
    snapshot?: Uint8Array;
    links?: string[];
    restore?: DocRestore;
  }[] = [];

  async pull(id: string, sv: Uint8Array) {
    this.pulls.push({ id, sv });
    if (this.beforePull) await this.beforePull();
    if (this.offline) throw new TypeError('нет сети');
    if (this.missing) throw new HttpError(404, 'not_found', 'объект ещё не дошёл');
    if (this.pullError) throw this.pullError;
    return {
      update: Y.encodeStateAsUpdate(this.doc, sv),
      sv: Y.encodeStateVector(this.doc),
      seedMarkdown: this.seedMarkdown,
    };
  }

  async push(
    id: string,
    update: Uint8Array,
    text: string,
    seed?: boolean,
    snapshot?: Uint8Array,
    links?: string[],
    restore?: DocRestore,
  ) {
    this.pushes.push({
      id,
      update,
      text,
      ...(seed ? { seed } : {}),
      ...(snapshot ? { snapshot } : {}),
      ...(links !== undefined ? { links } : {}),
      ...(restore ? { restore } : {}),
    });
    if (this.beforePush) await this.beforePush();
    if (this.offline) throw new TypeError('нет сети');
    if (this.pushError) throw this.pushError;
    if (seed && this.seedMarkdown === null) throw new HttpError(409, 'seed_taken', 'уже перенесён');
    const textStale =
      this.alwaysStale ||
      (snapshot !== undefined &&
        !Y.snapshotContainsUpdate(Y.decodeSnapshot(snapshot), Y.encodeStateAsUpdate(this.doc)));
    Y.applyUpdate(this.doc, update);
    this.seedMarkdown = null;
    if (!textStale) this.text = text;
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new TypeError('ответ потерялся после записи');
    }
    return { sv: Y.encodeStateVector(this.doc), textStale };
  }
}

const stores: DocStore[] = [];
const servers: DocsServer[] = [];
let counter = 0;

function server(): DocsServer {
  const value = new DocsServer();
  servers.push(value);
  return value;
}

function store(
  transport: DocsTransport,
  options: Omit<DocStoreOptions, 'transport'> = {},
): DocStore {
  const value = new DocStore({
    transport,
    indexedDB: options.indexedDB ?? new IDBFactory(),
    dbName: options.dbName ?? `docs-test-${++counter}`,
    debounceMs: options.debounceMs ?? 60_000,
    ...(options.renderText ? { renderText: options.renderText } : {}),
    ...(options.extractLinks ? { extractLinks: options.extractLinks } : {}),
  });
  stores.push(value);
  return value;
}

function editor(handle: DocHandle): Y.Text {
  const text = handle.doc.getText('body');
  handle.text = () => text.toString();
  return text;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function persisted(factory: IDBFactory, name: string, id = 'page') {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const tx = db.transaction(['documents', 'updates']);
    const updates = new Promise<unknown[]>((resolve, reject) => {
      const request = tx.objectStore('updates').index('document').getAll(id);
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error);
    });
    const record = new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = tx.objectStore('documents').get(id);
      request.onsuccess = () => resolve(request.result as Record<string, unknown>);
      request.onerror = () => reject(request.error);
    });
    const [entries, metadata] = await Promise.all([updates, record]);
    return { entries, metadata };
  } finally {
    db.close();
  }
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((value) => value.close()));
  servers.splice(0).forEach((value) => value.doc.destroy());
  vi.unstubAllGlobals();
});

describe('метаданные документов', () => {
  it('создаёт и переименовывает без сети обычными операциями sync', async () => {
    const batches: PushRequest[] = [];
    const transport: Transport = {
      async push(request) {
        batches.push(request);
        return {
          results: request.ops.map((op) => ({
            status: 'applied' as const,
            op_id: op.op_id,
            revision: 1,
          })),
        };
      },
      async pull(cursor) {
        return { changes: [], cursor, has_more: false };
      },
    };
    const client = await SyncClient.open({
      dbName: 'doc-objects',
      indexedDB: new IDBFactory(),
      transport,
    });
    try {
      const made = await createDoc(client, '  Конспект  ');
      expect(made).toMatchObject({
        object_type: DOCS_PAGE,
        title: 'Конспект',
        pending: true,
        fields: { preview: '', has_ystate: false },
      });
      await renameDoc(client, made.id, '  Новый конспект ');
      expect(docList(await client.all())[0]?.title).toBe('Новый конспект');
      expect(batches).toHaveLength(0);
      await client.sync();
      expect(batches[0]?.ops).toEqual([
        {
          op_id: expect.any(String),
          object_id: made.id,
          kind: 'create',
          object_type: DOCS_PAGE,
          title: 'Конспект',
        },
        {
          op_id: expect.any(String),
          object_id: made.id,
          kind: 'set_title',
          base_revision: 1,
          title: 'Новый конспект',
        },
      ]);
      expect(() => createDoc(client, '   ')).toThrow('название');
      expect(() => renameDoc(client, made.id, '')).toThrow('название');
    } finally {
      client.close();
    }
  });

  it('список содержит только живые документы, по свежести, с preview из снимка', () => {
    const snapshot = (id: string, updated: number): ObjectSnapshot => ({
      id,
      title: id,
      object_type: DOCS_PAGE,
      revision: 1,
      deleted: false,
      updated_at_ms: updated,
    });
    const old = snapshot('старый', 1);
    const fresh = { ...snapshot('свежий', 20), fields: { preview: 'начало', has_ystate: true } };
    const state = [
      old,
      fresh,
      { ...old, id: 'корзина', deleted: true },
      { ...old, id: 'входящие', object_type: 'inbox.item' },
    ];
    expect(docList(state)).toEqual([
      { id: fresh.id, title: fresh.title, preview: 'начало', updated: 20 },
      { id: old.id, title: old.title, preview: '', updated: 1 },
    ]);
    expect(state[0]).toBe(old);
  });
});

describe('Y.Doc в IndexedDB и обмен', () => {
  it.each([
    [0, 1],
    [1, 0],
  ])('две офлайн-копии сходятся при порядке %s, %s', async (first, second) => {
    const remote = server();
    remote.doc.getText('body').insert(0, 'Общий текст');
    const devices = [store(remote), store(remote)];
    const handles = await Promise.all(devices.map((device) => device.open('page')));
    const texts = handles.map(editor);
    remote.offline = true;
    texts[0]!.delete(0, 5);
    texts[0]!.insert(texts[0]!.length, ' · ноутбук');
    texts[1]!.insert(0, 'Телефон · ');
    await Promise.all(handles.map((handle) => handle.sync()));
    expect(handles.map((handle) => handle.status)).toEqual(['offline', 'offline']);
    remote.offline = false;
    await handles[first]!.sync();
    await handles[second]!.sync();
    await handles[first]!.sync();
    expect(texts[0]!.toString()).toBe(texts[1]!.toString());
    expect(texts[0]!.toString()).toBe(remote.doc.getText('body').toString());
    expect(texts[0]!.toString()).toContain('ноутбук');
    expect(texts[0]!.toString()).toContain('Телефон');
    expect(handles.map((handle) => handle.status)).toEqual(['saved', 'saved']);
  });

  it('сохраняет журнал до debounce и сжимает его после 50 записей', async () => {
    const remote = server();
    remote.offline = true;
    const factory = new IDBFactory();
    const options = { indexedDB: factory, dbName: 'restart' };
    const first = store(remote, options);
    const handle = await first.open('page');
    const text = editor(handle);
    for (let i = 0; i < 56; i++) text.insert(text.length, String(i % 10));
    expect(handle.status).toBe('pending');
    const beforeClose = await persisted(factory, 'restart');
    expect(beforeClose.metadata.version).toBe(56);
    expect(beforeClose.entries).toHaveLength(6);
    // Не было ни sync после правки, ни ожидания debounce: close ждёт только IDB.
    const expected = text.toString();
    await first.close();
    expect(remote.pushes).toHaveLength(0);
    const saved = await persisted(factory, 'restart');
    expect(saved.entries).toHaveLength(6);
    expect(saved.metadata.text).toBe(expected);
    expect(saved.metadata.version).toBe(56);
    expect(saved.metadata.syncedVersion).toBe(0);

    const reopened = await store(remote, options).open('page');
    expect(reopened.doc.getText('body').toString()).toHaveLength(56);
    expect(reopened.status).toBe('offline');
    remote.offline = false;
    await reopened.sync();
    expect(remote.text).toBe(reopened.doc.getText('body').toString());
    expect(reopened.status).toBe('saved');
    const confirmed = await persisted(factory, 'restart');
    expect(confirmed.metadata.syncedVersion).toBe(56);
    expect(confirmed.metadata.serverSv).toEqual(Y.encodeStateVector(remote.doc));
  });

  it('при сжатии сохраняет правки другой вкладки', async () => {
    const remote = server();
    const factory = new IDBFactory();
    const options = { indexedDB: factory, dbName: 'tabs' };
    const a = await store(remote, options).open('page');
    const b = await store(remote, options).open('page');
    const at = editor(a);
    const bt = editor(b);
    for (let i = 0; i < 27; i++) {
      at.insert(at.length, 'А');
      bt.insert(bt.length, 'Б');
    }
    await a.sync();
    await b.sync();
    expect(remote.doc.getText('body').length).toBe(54);
    expect(remote.doc.getText('body').toString()).toContain('А'.repeat(27));
    expect(remote.doc.getText('body').toString()).toContain('Б'.repeat(27));
  });

  it.each(['pull', 'push'] as const)('404 на %s: повтор', async (phase) => {
    const remote = server();
    const handle = await store(remote).open('page');
    editor(handle).insert(0, 'Без сети');
    if (phase === 'pull') remote.missing = true;
    else remote.pushError = new HttpError(404, 'not_found', 'нет');
    await handle.sync();
    expect(handle.status).toBe('pending');
    remote.missing = false;
    remote.pushError = undefined;
    await handle.sync();
    expect(handle.status).toBe('saved');
    expect(remote.doc.getText('body').toString()).toBe('Без сети');
  });

  it('после первого 404 открывает и сохраняет документ без сети', async () => {
    const remote = server();
    remote.missing = true;
    const handle = await store(remote).open('ещё-локальный-id');
    expect(handle.status).toBe('pending');
    editor(handle).insert(0, 'Новый документ');
    await handle.sync();
    expect(remote.pushes).toHaveLength(0);
    remote.missing = false;
    await handle.sync();
    expect(remote.pushes[0]?.id).toBe('ещё-локальный-id');
    expect(handle.status).toBe('saved');
  });

  it('отправляет удаление при том же sv, повторный sync ничего не шлёт', async () => {
    const remote = server();
    const handle = await store(remote).open('page');
    const text = editor(handle);
    text.insert(0, 'Удалить');
    await handle.sync();
    const sv = Y.encodeStateVector(handle.doc);
    text.delete(0, text.length);
    expect(Y.encodeStateVector(handle.doc)).toEqual(sv);
    await handle.sync();
    expect(remote.doc.getText('body').toString()).toBe('');
    expect(remote.pushes).toHaveLength(2);
    await handle.sync();
    await handle.sync();
    expect(remote.pushes).toHaveLength(2);
  });

  it('повторяет отправку после потери ответа без задвоения', async () => {
    const remote = server();
    const handle = await store(remote).open('page');
    editor(handle).insert(0, 'Один раз');
    remote.loseResponse = true;
    await handle.sync();
    expect(handle.status).toBe('offline');
    await handle.sync();
    expect(handle.status).toBe('saved');
    expect(remote.doc.getText('body').toString()).toBe('Один раз');
  });

  it('сохраняет очередь для правки во время push', async () => {
    const remote = server();
    const handle = await store(remote).open('page');
    const text = editor(handle);
    text.insert(0, 'Первая');
    const started = deferred();
    const finish = deferred();
    remote.beforePush = async () => {
      started.resolve();
      await finish.promise;
    };
    const syncing = handle.sync();
    await started.promise;
    text.insert(text.length, ' и вторая');
    finish.resolve();
    await syncing;
    expect(handle.status).toBe('pending');
    expect(remote.doc.getText('body').toString()).toBe('Первая');
    remote.beforePush = undefined;
    await handle.sync();
    expect(handle.status).toBe('saved');
    expect(remote.doc.getText('body').toString()).toBe('Первая и вторая');
  });

  it('close во время pull сохраняет локальные правки', async () => {
    const remote = server();
    const factory = new IDBFactory();
    const options = { indexedDB: factory, dbName: 'close-during-pull' };
    const device = store(remote, options);
    const handle = await device.open('page');
    editor(handle).insert(0, 'Записано');
    const started = deferred();
    const finish = deferred();
    remote.beforePull = async () => {
      started.resolve();
      await finish.promise;
    };
    const syncing = handle.sync();
    await started.promise;
    await device.close();
    finish.resolve();
    await syncing;
    remote.beforePull = undefined;
    const reopened = await store(remote, options).open('page');
    expect(reopened.doc.getText('body').toString()).toBe('Записано');
    expect(reopened.status).toBe('saved');
  });

  it('совмещённые sync сохраняют повторный сигнал WebSocket', async () => {
    const remote = server();
    const handle = await store(remote).open('page');
    const started = deferred();
    const finish = deferred();
    remote.beforePull = async () => {
      started.resolve();
      await finish.promise;
    };
    const previous = remote.pulls.length;
    const first = handle.sync();
    await started.promise;
    const second = handle.sync();
    expect(second).toBe(first);
    finish.resolve();
    await second;
    expect(remote.pulls).toHaveLength(previous + 2);
  });

  it('debounce, online и syncAll запускают обмен', async () => {
    const events = new EventTarget();
    vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
    vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events));
    const remote = server();
    const device = store(remote, { debounceMs: 20 });
    const handle = await device.open('page');
    const text = editor(handle);
    text.insert(0, 'А');
    text.insert(text.length, 'Б');
    expect(remote.pushes).toHaveLength(0);
    await vi.waitFor(() => expect(handle.status).toBe('saved'));
    expect(remote.pushes).toHaveLength(1);
    remote.offline = true;
    text.insert(text.length, 'В');
    await handle.sync();
    expect(handle.status).toBe('offline');
    await handle.close();
    remote.offline = false;
    events.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(remote.doc.getText('body').toString()).toBe('АБВ'));
    // Закрытый документ загружается с сохранённым сериализованным текстом.
    expect(remote.text).toBe('АБВ');
    remote.doc.getText('body').insert(0, 'Другое устройство · ');
    await device.syncAll();
    const reopened = await device.open('page');
    expect(reopened.doc.getText('body').toString()).toContain('Другое устройство');
    expect(reopened.status).toBe('saved');
    await device.close();
    const count = remote.pulls.length;
    events.dispatchEvent(new Event('online'));
    expect(remote.pulls).toHaveLength(count);
  });

  it('сообщает статусы и поддерживает отписку', async () => {
    const remote = server();
    const handle = await store(remote).open('page');
    const statuses: DocStatus[] = [];
    const unsubscribe = handle.onStatus((status) => statuses.push(status));
    const text = editor(handle);
    text.insert(0, 'Текст');
    remote.offline = true;
    await handle.sync();
    remote.offline = false;
    await handle.sync();
    text.insert(text.length, '!');
    remote.pushError = new HttpError(400, 'invalid_update', 'не принято');
    await handle.sync();
    expect(handle.status).toBe('error');
    expect(statuses).toEqual(['saved', 'pending', 'offline', 'saved', 'pending', 'error']);
    unsubscribe();
    const count = statuses.length;
    remote.pushError = undefined;
    await handle.sync();
    expect(handle.status).toBe('saved');
    expect(statuses).toHaveLength(count);
  });

  it('сохраняет байты при ошибке экспорта Markdown', async () => {
    const remote = server();
    const factory = new IDBFactory();
    const device = store(remote, { indexedDB: factory, dbName: 'bad-markdown' });
    const handle = await device.open('page');
    expect(() => {
      handle.text = () => {
        throw new Error('ошибка редактора');
      };
    }).toThrow('ошибка редактора');
    handle.doc.getText('body').insert(0, 'Байты сохранены');
    await handle.sync();
    expect(handle.status).toBe('error');
    expect(remote.pushes).toHaveLength(0);
    expect((await persisted(factory, 'bad-markdown')).metadata.version).toBe(1);
    editor(handle);
    await handle.sync();
    expect(remote.text).toBe('Байты сохранены');
    expect(handle.status).toBe('saved');
  });

  it.each([
    [503, 'unavailable', 'offline'],
    [413, 'update_too_large', 'error'],
    [413, 'doc_too_large', 'error'],
    [400, 'invalid_update', 'error'],
    [401, 'unauthenticated', 'error'],
    [403, 'forbidden', 'error'],
  ] as const)('HTTP %s / %s → %s', async (code, name, status) => {
    const remote = server();
    const handle = await store(remote).open('page');
    editor(handle).insert(0, 'На устройстве');
    remote.pushError = new HttpError(code, name, 'ошибка');
    await handle.sync();
    expect(handle.status).toBe(status);
    remote.pushError = undefined;
    await handle.sync();
    expect(remote.doc.getText('body').toString()).toBe('На устройстве');
  });
});

describe('первый перенос Markdown', () => {
  it('сохраняет seed и текст до перезапуска', async () => {
    const remote = server();
    remote.seedMarkdown = '# Старый текст';
    const factory = new IDBFactory();
    const options = { indexedDB: factory, dbName: 'seed-restart' };
    const device = store(remote, options);
    const handle = await device.open('page');
    expect(handle.seedMarkdown).toBe('# Старый текст');
    const text = editor(handle);
    text.insert(0, handle.seedMarkdown!);
    await handle.sync();
    expect(remote.pushes).toHaveLength(0);
    await handle.markSeeded();
    await device.close();
    const reopened = await store(remote, options).open('page');
    expect(remote.pushes).toHaveLength(1);
    expect(remote.pushes[0]).toMatchObject({ seed: true, text: '# Старый текст' });
    expect(reopened.seedMarkdown).toBeNull();
    expect(reopened.status).toBe('saved');
    await reopened.sync();
    expect(remote.pushes).toHaveLength(1);
  });

  it('markSeeded переносит пустой Markdown без события Yjs', async () => {
    const remote = server();
    remote.seedMarkdown = '';
    const handle = await store(remote).open('page');
    expect(handle.seedMarkdown).toBe('');
    await handle.markSeeded();
    await handle.sync();
    expect(remote.pushes[0]).toMatchObject({ seed: true, text: '' });
    expect(handle.status).toBe('saved');
  });

  it('seed_taken очищает копию до onReset и повторного open', async () => {
    const remote = server();
    remote.seedMarkdown = 'Старый';
    const a = await store(remote).open('page');
    const deviceB = store(remote);
    const b = await deviceB.open('page');
    editor(a).insert(0, 'Старый · первая копия');
    editor(b).insert(0, 'Старый · вторая копия');
    await a.markSeeded();
    await b.markSeeded();
    let replacement: Promise<DocHandle> | undefined;
    const reset = vi.fn(() => {
      replacement = deviceB.open('page');
    });
    b.onReset(reset);
    await a.sync();
    await b.sync();
    expect(reset).toHaveBeenCalledOnce();
    const reopened = await replacement!;
    expect(reopened.doc.getText('body').toString()).toBe('Старый · первая копия');
    expect(reopened.seedMarkdown).toBeNull();
    expect(reopened.status).toBe('saved');
    await b.close();
    expect(await deviceB.open('page')).toBe(reopened);
  });
});

describe('HTTP-адаптер документов', () => {
  const base64 = (value: Uint8Array) => Buffer.from(value).toString('base64');

  it('кодирует base64 и URL, передаёт CSRF и Bearer', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const update = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256);
    const sv = new Uint8Array([251, 255]);
    const snapshot = Y.encodeSnapshot(Y.emptySnapshot);
    const fetch: typeof globalThis.fetch = async (input, init = {}) => {
      calls.push({ url: String(input), init });
      return Response.json({ update: base64(update), sv: base64(sv), seed_markdown: 'текст' });
    };
    const transport = httpDocsTransport({
      baseUrl: 'https://q.example',
      fetch,
      csrf: () => 'csrf',
    });
    expect(await transport.pull('id/1', sv)).toEqual({ update, sv, seedMarkdown: 'текст' });
    expect(calls[0]?.url).toBe(
      `https://q.example/api/v1/docs/id%2F1/y?sv=${encodeURIComponent(base64(sv))}`,
    );
    expect(new Headers(calls[0]?.init.headers).has('x-csrf-token')).toBe(false);
    expect(calls[0]?.init.credentials).toBe('include');
    expect(await transport.push('id/1', update, '# Текст', true, snapshot)).toEqual({
      sv,
      textStale: false,
    });
    expect(new Headers(calls[1]?.init.headers).get('x-csrf-token')).toBe('csrf');
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({
      update: base64(update),
      text: '# Текст',
      seed: true,
      snapshot: base64(snapshot),
    });
    const app = httpDocsTransport({ fetch, token: () => 'access', csrf: () => 'ignored' });
    await app.pull('page', sv);
    await app.push('page', update, '');
    for (const call of calls.slice(2)) {
      const headers = new Headers(call.init.headers);
      expect(headers.get('authorization')).toBe('Bearer access');
      expect(headers.has('x-csrf-token')).toBe(false);
      expect(call.init.credentials).toBe('omit');
    }
    expect(JSON.parse(calls[3]!.init.body as string)).not.toHaveProperty('seed');
    expect(JSON.parse(calls[3]!.init.body as string)).not.toHaveProperty('snapshot');
  });

  it('читает text_stale из ответа сервера', async () => {
    const transport = httpDocsTransport({
      fetch: async () => Response.json({ sv: 'AA==', text_stale: true }),
    });
    expect(await transport.push('page', new Uint8Array([0, 0]), '')).toEqual({
      sv: new Uint8Array([0]),
      textStale: true,
    });
  });

  it('читает CSRF из cookie и сохраняет HttpError', async () => {
    vi.stubGlobal('document', { cookie: 'qubite_csrf=abc%3D' });
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      expect(new Headers(init?.headers).get('x-csrf-token')).toBe('abc=');
      return Response.json({ error: 'seed_taken', message: 'уже перенесён' }, { status: 409 });
    };
    const transport = httpDocsTransport({ fetch });
    const error: unknown = await transport
      .push('page', new Uint8Array(), '', true)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 409, code: 'seed_taken', message: 'уже перенесён' });
    const proxy = httpDocsTransport({
      fetch: async () => new Response('bad gateway', { status: 502 }),
    });
    await expect(proxy.pull('page', new Uint8Array([0]))).rejects.toMatchObject({
      status: 502,
      code: 'http_error',
      message: 'сервер ответил 502',
    });
  });
});

describe('DOC-002e1: сохранность локального текста', () => {
  it.each([false, true])('свой принятый seed сохраняет дописки, перезапуск=%s', async (restart) => {
    const remote = server();
    remote.seedMarkdown = 'Старый текст';
    const options = { indexedDB: new IDBFactory(), dbName: 'accepted-seed' };
    const device = store(remote, options);
    let handle = await device.open('page');
    const text = editor(handle);
    text.insert(0, 'Старый текст');
    await handle.markSeeded();
    remote.loseResponse = true;
    remote.beforePush = async () => {
      remote.beforePush = undefined;
      text.insert(text.length, ' · набрано после отправки');
    };
    await handle.sync();
    expect(handle.status).toBe('offline');
    expect(remote.text).toBe('Старый текст');
    expect((await persisted(options.indexedDB, options.dbName)).metadata.seedSv).toBeInstanceOf(
      Uint8Array,
    );
    const reset = vi.fn();
    handle.onReset(reset);
    if (restart) {
      await device.close();
      handle = await store(remote, options).open('page');
    } else await handle.sync();
    expect(reset).not.toHaveBeenCalled();
    expect(handle.recovered).toBeNull();
    expect(handle.doc.getText('body').toString()).toBe('Старый текст · набрано после отправки');
    expect(remote.doc.getText('body').toString()).toBe(handle.doc.getText('body').toString());
    expect(remote.pushes.at(-1)?.seed).toBeUndefined();
    expect(handle.status).toBe('saved');
    expect((await persisted(options.indexedDB, options.dbName)).metadata.seed).toBe(false);
  });

  it('open после чужого seed возвращает живую копию и сохраняет свой вариант между перезапусками', async () => {
    const remote = server();
    remote.seedMarkdown = 'Markdown';
    const winner = await store(remote).open('page');
    const options = { indexedDB: new IDBFactory(), dbName: 'foreign-seed' };
    const device = store(remote, options);
    const local = await device.open('page');
    editor(winner).insert(0, 'Принятая версия');
    editor(local).insert(0, 'Свой вариант');
    await winner.markSeeded();
    await local.markSeeded();
    await device.close();
    await winner.sync();
    const reopenedStore = store(remote, options);
    const reopened = await reopenedStore.open('page');
    expect(reopened.doc.isDestroyed).toBe(false);
    expect(reopened.doc.getText('body').toString()).toBe('Принятая версия');
    expect(reopened.recovered).toBe('Свой вариант');
    const text = editor(reopened);
    remote.offline = true;
    text.insert(text.length, ' · новая правка');
    await reopenedStore.close();
    const nextStore = store(remote, options);
    const next = await nextStore.open('page');
    expect(next.doc.getText('body').toString()).toBe('Принятая версия · новая правка');
    expect(next.recovered).toBe('Свой вариант');
    await next.clearRecovered();
    await nextStore.close();
    const final = await store(remote, options).open('page');
    expect(final.recovered).toBeNull();
    expect(final.doc.getText('body').toString()).toContain('новая правка');
  });

  it('без экрана отправляет Markdown слитого дерева через renderText', async () => {
    const remote = server();
    remote.doc.getText('body').insert(0, 'Общее');
    const options = {
      indexedDB: new IDBFactory(),
      dbName: 'background-text',
      renderText: (doc: Y.Doc) => doc.getText('body').toString(),
    };
    const device = store(remote, options);
    const handle = await device.open('page');
    remote.offline = true;
    editor(handle).insert(handle.doc.getText('body').length, ' · локальное');
    await device.close();
    remote.doc.getText('body').insert(0, 'Чужое · ');
    remote.offline = false;
    const background = store(remote, options);
    await background.syncAll();
    expect(remote.text).toBe(remote.doc.getText('body').toString());
    expect(remote.text).toContain('Чужое');
    expect(remote.text).toContain('локальное');
    expect((await persisted(options.indexedDB, options.dbName)).metadata.text).toBe(remote.text);
  });

  function root(doc: Y.Doc) {
    return doc.get('root', Y.XmlText);
  }
  function block(doc: Y.Doc, index: number) {
    const value: unknown = root(doc).toDelta()[index]?.insert;
    if (!(value instanceof Y.XmlText)) throw new Error('нет блока');
    return value;
  }
  function add(doc: Y.Doc, text: string) {
    const value = new Y.XmlText();
    doc.transact(() => {
      root(doc).insertEmbed(root(doc).length, value);
      value.setAttribute('__type', 'qubite-block');
      value.setAttribute('__kind', 'quote');
      value.insert(0, text);
    });
  }

  it('хранит потерянный чип с текстом в IndexedDB до выбора после переоткрытия', async () => {
    const remote = server();
    add(remote.doc, 'Основа');
    const options = { indexedDB: new IDBFactory(), dbName: 'lost-mention' };
    const device = store(remote, options);
    const handle = await device.open('page');
    const target = '11111111-1111-4111-8111-111111111111';
    handle.doc.transact(() => {
      const value = block(handle.doc, 0);
      value.insert(value.length, 'до ');
      const mention = new Y.XmlElement('decorator');
      value.insertEmbed(value.length, mention);
      mention.setAttribute('__type', 'qubite-mention');
      mention.setAttribute('__target', target);
      mention.setAttribute('__kind', 'planner.task');
      value.insert(value.length, ' после');
    });
    await device.close();
    root(remote.doc).delete(0, 1);
    const background = store(remote, options);
    await background.syncAll();
    const expected = [
      {
        text: 'до  после',
        kind: 'quote',
        after: null,
        content: [
          { type: 'text', text: 'до ' },
          { type: 'mention', target, kind: 'planner.task' },
          { type: 'text', text: ' после' },
        ],
      },
    ];
    expect((await persisted(options.indexedDB, options.dbName)).metadata.lost).toEqual(expected);
    await background.close();
    const reopenedStore = store(remote, options);
    const reopened = await reopenedStore.open('page');
    expect(reopened.lost).toEqual(expected);
    await reopened.sync();
    expect(reopened.lost).toEqual(expected);
    await reopened.clearLost();
    await reopenedStore.close();
    expect((await store(remote, options).open('page')).lost).toEqual([]);
  });

  it.each(['open', 'syncAll'] as const)(
    'находит дописки прежних клиентов до первого %s и хранит до выбора',
    async (method) => {
      const remote = server();
      add(remote.doc, 'Перед');
      add(remote.doc, 'Основа');
      const options = { indexedDB: new IDBFactory(), dbName: `lost-${method}` };
      const device = store(remote, options);
      const handle = await device.open('page');
      const previousClient = handle.doc.clientID;
      block(handle.doc, 1).insert(block(handle.doc, 1).length, ' · первая');
      await handle.close();
      // Ещё одно открытие даёт новый clientID, но предыдущая дописка ещё не отправлена.
      remote.offline = true;
      const second = await device.open('page');
      block(second.doc, 1).insert(block(second.doc, 1).length, ' · вторая');
      expect(second.doc.clientID).not.toBe(previousClient);
      await device.close();
      root(remote.doc).delete(1, 1);
      remote.offline = false;
      const background = store(remote, options);
      if (method === 'syncAll') await background.syncAll();
      const reopened = await background.open('page');
      const expected = [{ text: ' · первая · вторая', kind: 'quote', after: 'Перед' }];
      expect(reopened.lost).toEqual(expected);
      const changes = vi.fn();
      const stop = reopened.onLost(changes);
      expect(changes).toHaveBeenLastCalledWith(expected);
      await reopened.sync();
      expect(reopened.lost).toEqual(expected);
      expect((await persisted(options.indexedDB, options.dbName)).metadata.lost).toEqual(expected);
      await background.close();
      const finalStore = store(remote, options);
      const final = await finalStore.open('page');
      expect(final.lost).toEqual(expected);
      const cleared = vi.fn();
      final.onLost(cleared);
      await final.clearLost();
      expect(cleared).toHaveBeenLastCalledWith([]);
      stop();
      await finalStore.close();
      expect((await store(remote, options).open('page')).lost).toEqual([]);
    },
  );

  it('не предлагает вернуть уже принятый текст и намеренно стёртое', async () => {
    const remote = server();
    add(remote.doc, 'Основа');
    const options = { indexedDB: new IDBFactory(), dbName: 'known-lost' };
    const device = store(remote, options);
    const handle = await device.open('page');
    const value = block(handle.doc, 0);
    value.insert(value.length, ' · уже отправлено');
    await handle.sync();
    remote.offline = true;
    value.insert(value.length, ' · лишнее');
    value.delete(value.length - ' · лишнее'.length, ' · лишнее'.length);
    await device.close();
    root(remote.doc).delete(0, 1);
    remote.offline = false;
    const next = await store(remote, options).open('page');
    expect(next.lost).toEqual([]);
  });
});

describe('DOC-002f: догон текста после параллельного слияния', () => {
  const renderText = (doc: Y.Doc) => doc.getText('body').toString();

  it('при повторе после чужого удаления догоняет текст один раз при прежнем векторе', async () => {
    const remote = server();
    remote.doc.getText('body').insert(0, 'Основа · удалить');
    const a = await store(remote, { renderText }).open('page');
    a.doc.getText('body').insert(0, 'Свой · ');
    // Сервер принял пакет A, но ответ потерялся: текст останется в очереди повтора.
    remote.loseResponse = true;
    await a.sync();
    expect(a.status).toBe('offline');
    const original = remote.pushes[0]!;
    const b = await store(remote, { renderText }).open('page');
    const vector = Y.encodeStateVector(remote.doc);
    const text = b.doc.getText('body');
    text.delete(text.length - ' · удалить'.length, ' · удалить'.length);
    // A уже сделал pull для повтора; B отправляет только удаление перед его push.
    remote.beforePush = async () => {
      remote.beforePush = undefined;
      await b.sync();
      expect(Y.encodeStateVector(remote.doc)).toEqual(vector);
      expect(remote.text).toBe('Свой · Основа');
    };
    const pulls = remote.pulls.length;
    await a.sync();
    expect(remote.pushes).toHaveLength(4); // первый A, повтор A, удаление B, догон A
    expect(remote.pulls).toHaveLength(pulls + 3); // повтор A, B, догон A
    const retry = remote.pushes[1]!;
    expect(retry.snapshot).toEqual(original.snapshot);
    expect(retry.text).toBe('Свой · Основа · удалить');
    const catchup = remote.pushes.at(-1)!;
    expect(catchup.text).toBe('Свой · Основа');
    expect(Y.decodeUpdate(catchup.update).structs).toHaveLength(0);
    expect(Y.decodeSnapshot(catchup.snapshot!).sv).toEqual(Y.decodeSnapshot(original.snapshot!).sv);
    expect(Y.equalSnapshots(Y.decodeSnapshot(catchup.snapshot!), Y.snapshot(remote.doc))).toBe(
      true,
    );
    expect(renderText(a.doc)).toBe('Свой · Основа');
    expect(remote.text).toBe('Свой · Основа');
    expect(a.status).toBe('saved');
    await a.sync();
    expect(remote.pushes).toHaveLength(4);
  });

  it('после общего pull отправляет текст обеих копий без новых Yjs-правок', async () => {
    const remote = server();
    remote.doc.getText('body').insert(0, 'Основа');
    const a = await store(remote, { renderText }).open('page');
    const b = await store(remote, { renderText }).open('page');
    a.doc.getText('body').insert(0, 'Слева · ');
    b.doc.getText('body').insert(b.doc.getText('body').length, ' · справа');
    // a уже сделал pull; пока его push ждёт, b отправляет свою правку.
    remote.beforePush = async () => {
      remote.beforePush = undefined;
      await b.sync();
    };
    await a.sync();
    expect(remote.pushes).toHaveLength(3);
    expect(remote.text).toBe('Слева · Основа · справа');
    expect(remote.pushes.at(-1)?.text).toBe(remote.text);
    expect(remote.pushes.at(-1)?.update).toEqual(new Uint8Array([0, 0]));
    expect(a.status).toBe('saved');
    const state = Y.encodeStateAsUpdate(remote.doc);
    await a.sync();
    expect(remote.pushes).toHaveLength(3);
    expect(Y.encodeStateAsUpdate(remote.doc)).toEqual(state);
  });

  it('делает только один немедленный догон, затем оставляет pending', async () => {
    const remote = server();
    const handle = await store(remote, { renderText }).open('page');
    handle.doc.getText('body').insert(0, 'Текст');
    remote.alwaysStale = true;
    const pulls = remote.pulls.length;
    await handle.sync();
    expect(remote.pushes).toHaveLength(2);
    expect(remote.pulls).toHaveLength(pulls + 2);
    expect(handle.status).toBe('pending');
    remote.alwaysStale = false;
    await handle.sync();
    expect(remote.pushes).toHaveLength(3);
    expect(remote.text).toBe('Текст');
    expect(handle.status).toBe('saved');
  });

  it('сохраняет необходимость догона при обрыве сети и перезапуске', async () => {
    const remote = server();
    const options = { indexedDB: new IDBFactory(), dbName: 'stale-restart', renderText };
    const device = store(remote, options);
    const handle = await device.open('page');
    handle.doc.getText('body').insert(0, 'Свой');
    remote.beforePush = async () => {
      remote.beforePush = undefined;
      remote.doc.getText('body').insert(0, 'Чужой · ');
      remote.beforePull = async () => {
        remote.offline = true;
      };
    };
    await handle.sync();
    expect(handle.status).toBe('offline');
    expect((await persisted(options.indexedDB, options.dbName)).metadata.textPending).toBe(true);
    await device.close();
    remote.beforePull = undefined;
    remote.offline = false;
    const reopened = await store(remote, options).open('page');
    expect(remote.text).toContain('Свой');
    expect(remote.text).toContain('Чужой');
    expect(remote.text).toBe(renderText(reopened.doc));
    expect(reopened.status).toBe('saved');
  });
});

describe('DOC-003: связи документа', () => {
  const target = '11111111-1111-4111-8111-111111111111';

  it('каждый push содержит уникальные UUID из дерева, после удаления — пустой список', async () => {
    const remote = server();
    const extractLinks = vi.fn((doc: Y.Doc) => doc.getArray<string>('mentions').toArray());
    const device = store(remote, { extractLinks });
    const handle = await device.open('page');
    const mentions = handle.doc.getArray<string>('mentions');
    mentions.push([target, target]);
    await handle.sync();
    expect(remote.pushes.at(-1)?.links).toEqual([target]);
    mentions.delete(0, 2);
    await handle.sync();
    expect(remote.pushes.at(-1)?.links).toEqual([]);
    expect(extractLinks).toHaveBeenCalled();
  });

  it('не обрезает набор связей при превышении лимита после слияния', async () => {
    const remote = server();
    const handle = await store(remote, {
      extractLinks: () => Array.from({ length: 201 }, (_, index) => String(index)),
    }).open('page');
    editor(handle).insert(0, 'Текст остаётся на устройстве');
    await handle.sync();
    expect(handle.status).toBe('error');
    expect(remote.pushes).toHaveLength(0);
    expect(handle.doc.getText('body').toString()).toBe('Текст остаётся на устройстве');
  });

  it('закрытый документ извлекает ссылки после перезапуска без экрана и сети', async () => {
    const remote = server();
    const indexedDB = new IDBFactory();
    const options = {
      indexedDB,
      dbName: 'mention-restart',
      extractLinks: (doc: Y.Doc) => doc.getArray<string>('mentions').toArray(),
    };
    const first = store(remote, options);
    const handle = await first.open('page');
    remote.offline = true;
    handle.doc.getArray<string>('mentions').push([target]);
    await first.close();
    const second = store(remote, options);
    remote.offline = false;
    await second.syncAll();
    expect(remote.pushes.at(-1)?.links).toEqual([target]);
  });

  it('без сети возвращает последнее название из IDB; оно не записывается в Yjs', async () => {
    const remote = server();
    const indexedDB = new IDBFactory();
    const options = { indexedDB, dbName: 'mention-titles' };
    const first = store(remote, options);
    const handle = await first.open('page');
    const cached = { id: target, type: 'docs.page' as const, title: 'Графы', deleted: false };
    await handle.cacheLinks([cached]);
    const before = Y.encodeStateAsUpdate(handle.doc);
    await handle.cacheLinks([{ ...cached, title: 'Обход графа' }]);
    expect(Y.encodeStateAsUpdate(handle.doc)).toEqual(before);
    await first.close();
    remote.offline = true;
    const reopened = await store(remote, options).open('page');
    expect(reopened.links).toEqual([{ ...cached, title: 'Обход графа' }]);
    await reopened.cacheLinks([{ ...cached, deleted: true }]);
    expect(reopened.links[0]?.deleted).toBe(true);
    await reopened.cacheLinks([cached]);
    expect(reopened.links[0]?.deleted).toBe(false);
  });

  it('старый ответ без новых полей принимается; links добавляется только при заданном экспорте', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      bodies.push(JSON.parse(init!.body as string) as Record<string, unknown>);
      return new Response(JSON.stringify({ sv: 'AA==' }));
    });
    const transport = httpDocsTransport({ fetch, csrf: () => '' });
    await transport.push('page', new Uint8Array([0, 0]), '@', undefined, undefined, [target]);
    expect(bodies[0]?.links).toEqual([target]);
    await transport.push('page', new Uint8Array([0, 0]), 'старый клиент');
    expect(bodies[1]).not.toHaveProperty('links');
    await transport.push('page', new Uint8Array([0, 0]), '', undefined, undefined, []);
    expect(bodies[2]?.links).toEqual([]);
  });
});

describe('DOC-004b: восстановление версий', () => {
  const target = '11111111-1111-4111-8111-111111111111';
  const root = (doc: Y.Doc) => doc.get('root', Y.XmlText);
  const blocks = (doc: Y.Doc): Y.XmlText[] =>
    root(doc)
      .toDelta()
      .flatMap((part) => (part.insert instanceof Y.XmlText ? [part.insert] : []));
  const renderText = (doc: Y.Doc) =>
    blocks(doc)
      .map((block) => block.toString())
      .join('\n');
  const extractLinks = (doc: Y.Doc): string[] =>
    blocks(doc).flatMap((block) =>
      block.toDelta().flatMap((part) => {
        const node: unknown = part.insert;
        return node instanceof Y.XmlElement && node.getAttribute('__type') === 'qubite-mention'
          ? [String(node.getAttribute('__target'))]
          : [];
      }),
    );
  function add(doc: Y.Doc, text: string) {
    const block = new Y.XmlText();
    root(doc).insertEmbed(root(doc).length, block);
    block.setAttribute('__type', 'qubite-block');
    block.setAttribute('__kind', 'p');
    block.insert(0, text);
    return block;
  }
  function version(id = 'version'): DocVersion {
    const doc = new Y.Doc();
    try {
      const block = add(doc, 'Из снимка');
      block.setAttribute('__kind', 'todo');
      block.setAttribute('__checked', true);
      block.setAttribute('__indent', 2);
      const mention = new Y.XmlElement('decorator');
      block.insertEmbed(block.length, mention);
      mention.setAttribute('__type', 'qubite-mention');
      mention.setAttribute('__target', target);
      mention.setAttribute('__kind', 'planner.task');
      const ystate = Y.encodeStateAsUpdate(doc);
      return {
        id,
        ystate,
        text: 'Старый текст с устаревшими названиями',
        kind: 'named',
        name: 'Снимок',
        title: 'Документ',
        preview: '',
        size: ystate.length,
        created_at: '2026-11-03T20:00:00Z',
      };
    } finally {
      doc.destroy();
    }
  }

  it('восстанавливает офлайн, после перезапуска отправляет первым POST и снимает флаг', async () => {
    const remote = server();
    add(remote.doc, 'Текущий');
    const options = {
      indexedDB: new IDBFactory(),
      dbName: 'restore-restart',
      renderText,
      extractLinks,
    };
    const device = store(remote, options);
    const handle = await device.open('page');
    const snapshot = version();
    remote.offline = true;
    await handle.restoreVersion(snapshot);
    expect(blocks(handle.doc).map((block) => block.getAttribute('__kind'))).toEqual(['todo']);
    expect(blocks(handle.doc)[0]?.getAttribute('__checked')).toBe(true);
    expect(blocks(handle.doc)[0]?.getAttribute('__indent')).toBe(2);
    expect(extractLinks(handle.doc)).toEqual([target]);
    expect(handle.status).toBe('pending');
    await handle.sync();
    expect(handle.status).toBe('offline');
    expect(remote.pushes).toHaveLength(0);
    expect((await persisted(options.indexedDB, options.dbName)).metadata.restore).toMatchObject({
      id: snapshot.id,
    });
    await device.close();
    const nextStore = store(remote, options);
    const next = await nextStore.open('page');
    expect(renderText(next.doc)).toContain('Из снимка');
    remote.offline = false;
    await next.sync();
    expect(remote.pushes[0]?.restore).toEqual({ reason: 'restore', restore_of: snapshot.id });
    expect(remote.pushes[0]?.links).toEqual([target]);
    expect(remote.pushes[0]?.text).toBe(renderText(next.doc));
    expect(remote.pushes[0]?.text).not.toBe(snapshot.text);
    expect(
      Y.equalSnapshots(Y.decodeSnapshot(remote.pushes[0]!.snapshot!), Y.snapshot(next.doc)),
    ).toBe(true);
    expect(renderText(remote.doc)).toBe(renderText(next.doc));
    expect(next.status).toBe('saved');
    expect((await persisted(options.indexedDB, options.dbName)).metadata.restore).toBeNull();
    blocks(next.doc)[0]!.insert(0, 'Правка после восстановления · ');
    await next.sync();
    expect(remote.pushes.at(-1)?.restore).toBeUndefined();
  });

  it('сливает восстановление с новым блоком второго устройства, не теряя оба текста', async () => {
    const remote = server();
    add(remote.doc, 'Основа');
    const first = await store(remote, { renderText }).open('page');
    const second = await store(remote, { renderText }).open('page');
    await first.restoreVersion(version());
    add(second.doc, 'Параллельная правка');
    await second.sync();
    await first.sync();
    await second.sync();
    expect(renderText(first.doc)).toContain('Из снимка');
    expect(renderText(first.doc)).toContain('Параллельная правка');
    expect(renderText(second.doc)).toBe(renderText(first.doc));
    expect(renderText(remote.doc)).toBe(renderText(first.doc));
    expect(first.lost).toEqual([]);
  });

  it('второе устройство сохраняет дописку в удалённый восстановлением блок как lost', async () => {
    const remote = server();
    add(remote.doc, 'Основа');
    const first = await store(remote, { renderText }).open('page');
    const second = await store(remote, { renderText }).open('page');
    await first.restoreVersion(version());
    blocks(second.doc)[0]!.insert('Основа'.length, ' · не потерять');
    await first.sync();
    await second.sync();
    expect(second.lost.map((block) => block.text).join('')).toContain('не потерять');
    expect(renderText(second.doc)).toContain('Из снимка');
  });

  it('потеря ответа и text_stale сохраняют restore до подтверждения', async () => {
    const remote = server();
    const options = {
      indexedDB: new IDBFactory(),
      dbName: 'restore-response',
      renderText,
      extractLinks,
    };
    const device = store(remote, options);
    const handle = await device.open('page');
    await handle.restoreVersion(version());
    remote.loseResponse = true;
    await handle.sync();
    expect(handle.status).toBe('offline');
    await device.close();
    remote.alwaysStale = true;
    const next = await store(remote, options).open('page');
    expect(next.status).toBe('pending');
    expect((await persisted(options.indexedDB, options.dbName)).metadata.restore).not.toBeNull();
    remote.alwaysStale = false;
    await next.sync();
    expect(remote.pushes.every((push) => push.restore?.restore_of === 'version')).toBe(true);
    expect(next.status).toBe('saved');
    expect((await persisted(options.indexedDB, options.dbName)).metadata.restore).toBeNull();
  });

  it('ответ предыдущего POST не снимает более новое восстановление той же версии', async () => {
    const remote = server();
    const options = {
      indexedDB: new IDBFactory(),
      dbName: 'restore-inflight',
      renderText,
    };
    const device = store(remote, options);
    const handle = await device.open('page');
    const snapshot = version();
    await handle.restoreVersion(snapshot);
    const waiting = deferred();
    const release = deferred();
    remote.beforePush = async () => {
      waiting.resolve();
      await release.promise;
    };
    const pending = handle.sync();
    await waiting.promise;
    await handle.restoreVersion(snapshot);
    remote.beforePush = undefined;
    release.resolve();
    await pending;
    expect(handle.status).toBe('pending');
    expect((await persisted(options.indexedDB, options.dbName)).metadata.restore).not.toBeNull();
    await handle.sync();
    expect(remote.pushes.at(-1)?.restore).toEqual({ reason: 'restore', restore_of: snapshot.id });
    expect(handle.status).toBe('saved');
  });

  it('пустой снимок восстанавливается и поверх пустого, и поверх заполненного дерева', async () => {
    const remote = server();
    const handle = await store(remote, { renderText, extractLinks }).open('page');
    const empty = new Y.Doc();
    const snapshot = { id: 'empty', ystate: Y.encodeStateAsUpdate(empty) };
    empty.destroy();
    await handle.restoreVersion(snapshot);
    await handle.sync();
    expect(remote.pushes.at(-1)?.restore?.restore_of).toBe('empty');
    add(handle.doc, 'Убрать');
    await handle.restoreVersion(snapshot);
    expect(blocks(handle.doc)).toEqual([]);
    await handle.sync();
    expect(remote.pushes.at(-1)?.text).toBe('');
    expect(remote.pushes.at(-1)?.links).toEqual([]);
    expect(handle.status).toBe('saved');
  });

  it('DocStore восстанавливает без сетевого открытия; создание версии требует saved', async () => {
    const remote = server();
    const device = store(remote, { renderText });
    const snapshot = version();
    remote.offline = true;
    await device.restoreVersion('page', snapshot);
    expect(remote.pulls).toHaveLength(0);
    await expect(device.createVersion('page', 'Имя')).rejects.toThrow('Нужна связь');
    expect(remote.createVersion).not.toHaveBeenCalled();
    remote.offline = false;
    remote.createVersion.mockResolvedValue(snapshot);
    expect(await device.createVersion('page', 'Имя')).toEqual(snapshot);
    expect(remote.pushes[0]?.restore?.restore_of).toBe(snapshot.id);
    expect(remote.createVersion).toHaveBeenCalledWith('page', 'Имя');
  });
});
