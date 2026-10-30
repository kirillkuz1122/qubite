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
import type { ObjectSnapshot, PushRequest } from './protocol';

/** Сервер только в памяти: никаких HTTP-запросов и зависимостей от Rust-сервера. */
class DocsServer implements DocsTransport {
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
  readonly pulls: { id: string; sv: Uint8Array }[] = [];
  readonly pushes: { id: string; update: Uint8Array; text: string; seed?: boolean }[] = [];

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

  async push(id: string, update: Uint8Array, text: string, seed?: boolean) {
    this.pushes.push({ id, update, text, ...(seed ? { seed } : {}) });
    if (this.beforePush) await this.beforePush();
    if (this.offline) throw new TypeError('нет сети');
    if (this.pushError) throw this.pushError;
    if (seed && this.seedMarkdown === null) throw new HttpError(409, 'seed_taken', 'уже перенесён');
    Y.applyUpdate(this.doc, update);
    this.seedMarkdown = null;
    this.text = text;
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new TypeError('ответ потерялся после записи');
    }
    return { sv: Y.encodeStateVector(this.doc) };
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
    expect(reopened.recovered).toBe('Старый · вторая копия');
    expect(reopened.status).toBe('saved');
    await b.close();
    expect(await deviceB.open('page')).toBe(reopened);
  });
});

describe('DOC-002e: seed, сброс и фоновый текст', () => {
  it('ответ seed потерялся: поздние дописки переживают перезапуск', async () => {
    const remote = server();
    remote.seedMarkdown = 'Старый';
    const options = { indexedDB: new IDBFactory(), dbName: 'own-seed' };
    const first = store(remote, options);
    const handle = await first.open('page');
    const text = editor(handle);
    text.insert(0, 'Старый');
    await handle.markSeeded();
    const started = deferred();
    const finish = deferred();
    remote.beforePush = async () => {
      started.resolve();
      await finish.promise;
    };
    remote.loseResponse = true;
    const syncing = handle.sync();
    await started.promise;
    text.insert(text.length, ' и новое');
    finish.resolve();
    await syncing;
    expect(handle.status).toBe('offline');
    expect(remote.doc.getText('body').toString()).toBe('Старый');
    await first.close();
    remote.beforePush = undefined;
    const reopened = await store(remote, options).open('page');
    expect(reopened.doc.getText('body').toString()).toBe('Старый и новое');
    expect(remote.doc.getText('body').toString()).toBe('Старый и новое');
    expect(reopened.recovered).toBeNull();
    expect(reopened.status).toBe('saved');
    expect(remote.pushes.at(-1)?.seed).toBeUndefined();
  });

  it('свой seed_taken: pull проверяет вектор и сохраняет дописки', async () => {
    const remote = server();
    remote.seedMarkdown = 'Основа';
    const handle = await store(remote).open('page');
    const text = editor(handle);
    text.insert(0, 'Основа');
    await handle.markSeeded();
    const reset = vi.fn();
    handle.onReset(reset);
    // Сервер уже принял тот же пакет; клиент ещё видит устаревший GET.
    remote.beforePush = async () => {
      remote.beforePush = undefined;
      Y.applyUpdate(remote.doc, remote.pushes.at(-1)!.update);
      remote.seedMarkdown = null;
      text.insert(text.length, ' позже');
    };
    await handle.sync();
    expect(remote.pulls.length).toBeGreaterThanOrEqual(4);
    expect(reset).not.toHaveBeenCalled();
    expect(handle.status).toBe('saved');
    expect(remote.doc.getText('body').toString()).toBe('Основа позже');
  });

  it('чужой seed: open живой, recovered хранится до очистки', async () => {
    const remote = server();
    remote.seedMarkdown = 'Старый';
    const options = { indexedDB: new IDBFactory(), dbName: 'foreign-seed' };
    const first = store(remote, options);
    const initial = await first.open('page');
    editor(initial).insert(0, 'Мой вариант');
    await initial.markSeeded();
    await first.close();
    remote.doc.getText('body').insert(0, 'Другой вариант');
    remote.seedMarkdown = null;
    const second = store(remote, options);
    const fresh = await second.open('page');
    expect(fresh.doc.isDestroyed).toBe(false);
    expect(fresh.doc.getText('body').toString()).toBe('Другой вариант');
    expect(fresh.recovered).toBe('Мой вариант');
    expect(await second.open('page')).toBe(fresh);
    editor(fresh).insert(fresh.doc.getText('body').length, ' — живая правка');
    await fresh.sync();
    expect(remote.doc.getText('body').toString()).toBe('Другой вариант — живая правка');
    await second.close();
    const third = store(remote, options);
    const reopened = await third.open('page');
    expect(reopened.recovered).toBe('Мой вариант');
    await reopened.clearRecovered();
    await third.close();
    expect((await store(remote, options).open('page')).recovered).toBeNull();
  });

  it('фоновый push содержит текст двух устройств', async () => {
    const remote = server();
    remote.doc.getText('body').insert(0, 'Основа');
    const device = store(remote, { renderText: (doc) => doc.getText('body').toString() });
    const handle = await device.open('page');
    editor(handle).insert(handle.doc.getText('body').length, ' локально');
    await handle.close();
    remote.doc.getText('body').insert(0, 'Телефон: ');
    await device.syncAll();
    expect(remote.text).toBe(remote.doc.getText('body').toString());
    expect(remote.text).toContain('Телефон: ');
    expect(remote.text).toContain(' локально');
  });
});

function docBlock(doc: Y.Doc, text: string): Y.XmlText {
  const root = doc.get('root', Y.XmlText);
  const block = new Y.XmlText();
  doc.transact(() => {
    root.insertEmbed(root.length, block);
    block.setAttribute('__type', 'qubite-block');
    block.setAttribute('__kind', 'quote');
    block.insert(0, text);
  });
  return block;
}

function storedBlock(doc: Y.Doc, index: number): Y.XmlText {
  const block: unknown = doc.get('root', Y.XmlText).toDelta()[index]?.insert;
  if (!(block instanceof Y.XmlText)) throw new Error('нет блока');
  return block;
}

describe('DOC-002e: потерянные дописки в хранилище', () => {
  it.each([false, true])('потери закрытого документа, перезапуск: %s', async (restart) => {
    const remote = server();
    docBlock(remote.doc, 'Перед');
    docBlock(remote.doc, 'Основа');
    const options = { indexedDB: new IDBFactory(), dbName: `lost-${restart}` };
    let device = store(remote, options);
    const handle = await device.open('page');
    const clientID = handle.doc.clientID;
    const block = storedBlock(handle.doc, 1);
    block.insert(block.length, ' моя дописка');
    await handle.close();
    if (restart) {
      await device.close();
      device = store(remote, options);
    }
    remote.doc.get('root', Y.XmlText).delete(1, 1);
    await device.syncAll();
    const opened = await device.open('page');
    expect(opened.doc.clientID).not.toBe(clientID);
    const expected = [{ text: ' моя дописка', kind: 'quote', after: 'Перед' }];
    expect(opened.lost).toEqual(expected);
    const changed = vi.fn();
    const stop = opened.onLost(changed);
    expect(changed).toHaveBeenLastCalledWith(expected);
    await device.close();
    const next = store(remote, options);
    const persisted = await next.open('page');
    expect(persisted.lost).toEqual(expected);
    await persisted.sync();
    expect(persisted.lost).toEqual(expected);
    await persisted.clearLost();
    stop();
    await next.close();
    expect((await store(remote, options).open('page')).lost).toEqual([]);
  });

  it('первый pull в open находит дописку до подключения экрана', async () => {
    const remote = server();
    docBlock(remote.doc, 'Основа');
    const device = store(remote);
    const first = await device.open('page');
    storedBlock(first.doc, 0).insert(6, ' без сети');
    await first.close();
    remote.doc.get('root', Y.XmlText).delete(0, 1);
    const opened = await device.open('page');
    expect(opened.lost).toEqual([{ text: ' без сети', kind: 'quote', after: null }]);
  });

  it('после перезапуска находит вставку в удалённый здесь блок', async () => {
    const remote = server();
    docBlock(remote.doc, 'Основа');
    const options = { indexedDB: new IDBFactory(), dbName: 'deleted-before-restart' };
    const first = store(remote, options);
    const handle = await first.open('page');
    handle.doc.get('root', Y.XmlText).delete(0, 1);
    await first.close();
    const block = storedBlock(remote.doc, 0);
    block.insert(block.length, ' дописано там');
    const reopened = await store(remote, options).open('page');
    expect(reopened.lost).toEqual([{ text: ' дописано там', kind: 'quote', after: null }]);
  });

  it('pull подтверждает вставки после потери ответа push', async () => {
    const remote = server();
    docBlock(remote.doc, 'Основа');
    const handle = await store(remote).open('page');
    storedBlock(handle.doc, 0).insert(6, ' принято');
    remote.loseResponse = true;
    await handle.sync();
    remote.doc.get('root', Y.XmlText).delete(0, 1);
    await handle.sync();
    expect(handle.lost).toEqual([]);
  });

  it('pull не подтверждает неотправленные правки', async () => {
    const remote = server();
    docBlock(remote.doc, 'Основа');
    const handle = await store(remote).open('page');
    storedBlock(handle.doc, 0).insert(6, ' не принято');
    remote.pushError = new HttpError(503, 'unavailable', 'позже');
    await handle.sync();
    remote.doc.get('root', Y.XmlText).delete(0, 1);
    await handle.sync();
    expect(handle.lost).toEqual([{ text: ' не принято', kind: 'quote', after: null }]);
  });
});

describe('HTTP-адаптер документов', () => {
  const base64 = (value: Uint8Array) => Buffer.from(value).toString('base64');

  it('кодирует base64 и URL, передаёт CSRF и Bearer', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const update = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256);
    const sv = new Uint8Array([251, 255]);
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
    expect(await transport.push('id/1', update, '# Текст', true)).toEqual({ sv });
    expect(new Headers(calls[1]?.init.headers).get('x-csrf-token')).toBe('csrf');
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({
      update: base64(update),
      text: '# Текст',
      seed: true,
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
