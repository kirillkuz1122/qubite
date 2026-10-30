/** Документы: метаданные через SyncClient, содержимое Yjs — отдельным обменом. */
import * as Y from 'yjs';
import type { SyncClient } from './client';
import { csrfFromCookie, HttpError, type HttpTransportOptions } from './http';
import type { ObjectSnapshot } from './protocol';
import type { LocalObject } from './store';

export const DOCS_PAGE = 'docs.page';

export interface DocListItem {
  id: string;
  title: string;
  preview: string;
  updated: number;
}

function docTitle(title: string): string {
  const value = title.trim();
  if (!value) throw new Error('нужно название документа');
  return value;
}

/** Создание объекта не требует сети; Yjs отправится, когда объект дойдёт до сервера. */
export function createDoc(client: SyncClient, title: string): Promise<LocalObject> {
  return client.create(DOCS_PAGE, docTitle(title), undefined, { preview: '', has_ystate: false });
}

/** Снимки из client.all(); корзина и объекты других модулей не входят в список. */
export function docList(state: readonly ObjectSnapshot[]): DocListItem[] {
  return state
    .filter((object) => object.object_type === DOCS_PAGE && !object.deleted)
    .map((object) => ({
      id: object.id,
      title: object.title,
      preview: typeof object.fields?.preview === 'string' ? object.fields.preview : '',
      updated: object.updated_at_ms,
    }))
    .sort((a, b) => b.updated - a.updated || a.id.localeCompare(b.id));
}

export function renameDoc(client: SyncClient, id: string, title: string): Promise<LocalObject> {
  return client.setTitle(id, docTitle(title));
}

/** Транспорт работает с байтами Yjs v1; base64 остаётся внутри HTTP-адаптера. */
export interface DocsPullResponse {
  update: Uint8Array;
  sv: Uint8Array;
  seedMarkdown: string | null;
}

export interface DocsPushResponse {
  sv: Uint8Array;
}

export interface DocsTransport {
  pull(id: string, sv: Uint8Array): Promise<DocsPullResponse>;
  push(id: string, update: Uint8Array, text: string, seed?: boolean): Promise<DocsPushResponse>;
}

function toBase64(bytes: Uint8Array): string {
  // Не разворачиваем весь документ в аргументы функции: он может быть большим.
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export function httpDocsTransport(options: HttpTransportOptions = {}): DocsTransport {
  const base = options.baseUrl ?? '';
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const csrf = options.csrf ?? (() => csrfFromCookie());

  async function call<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    const token = options.token?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    else if (init.method !== 'GET') {
      const value = csrf();
      if (value) headers.set('x-csrf-token', value);
    }
    const response = await doFetch(`${base}${path}`, {
      ...init,
      headers,
      credentials: token ? 'omit' : 'include',
    });
    if (!response.ok) {
      let code = 'http_error';
      let message = `сервер ответил ${response.status}`;
      try {
        const body = (await response.json()) as { error?: string; message?: string };
        code = body.error ?? code;
        message = body.message ?? message;
      } catch {
        // Например, 502 от прокси без JSON.
      }
      throw new HttpError(response.status, code, message);
    }
    return (await response.json()) as T;
  }

  const path = (id: string) => `/api/v1/docs/${encodeURIComponent(id)}/y`;
  return {
    async pull(id, sv) {
      const response = await call<{ update: string; sv: string; seed_markdown: string | null }>(
        `${path(id)}?sv=${encodeURIComponent(toBase64(sv))}`,
        { method: 'GET' },
      );
      return {
        update: fromBase64(response.update),
        sv: fromBase64(response.sv),
        seedMarkdown: response.seed_markdown,
      };
    },
    async push(id, update, text, seed) {
      const response = await call<{ sv: string }>(path(id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ update: toBase64(update), text, ...(seed ? { seed: true } : {}) }),
      });
      return { sv: fromBase64(response.sv) };
    },
  };
}

export type DocStatus = 'saved' | 'pending' | 'offline' | 'error';

export interface DocHandle {
  readonly doc: Y.Doc;
  readonly status: DocStatus;
  readonly seedMarkdown: string | null;
  /** Экран задаёт сериализацию в Markdown. Без экрана используется последний сохранённый текст. */
  text: () => string;
  sync(): Promise<void>;
  markSeeded(): Promise<void>;
  onStatus(callback: (status: DocStatus) => void): () => void;
  onReset(callback: () => void): () => void;
  /** Отсоединяет редактор сразу; Promise ждёт только локальных записей, а не сети. */
  close(): Promise<void>;
}

export interface DocStoreOptions {
  transport: DocsTransport;
  indexedDB?: IDBFactory;
  dbName?: string;
  debounceMs?: number;
}

interface StoredDocument {
  id: string;
  /** Счётчики меняются внутри IDB-транзакции, включая правки из другой вкладки. */
  version: number;
  syncedVersion: number;
  text: string;
  seed: boolean;
  seedMarkdown: string | null;
  serverSv: Uint8Array | null;
}

interface StoredUpdate {
  seq?: number;
  id: string;
  update: Uint8Array;
}

const emptyDocument = (id: string): StoredDocument => ({
  id,
  version: 0,
  syncedVersion: 0,
  text: '',
  seed: false,
  seedMarkdown: null,
  serverSv: null,
});

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('запись документа прервана'));
  });
}

class DocsDatabase {
  constructor(private readonly db: IDBDatabase) {}

  static async open(name: string, factory: IDBFactory): Promise<DocsDatabase> {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('documents', { keyPath: 'id' });
      const updates = request.result.createObjectStore('updates', {
        keyPath: 'seq',
        autoIncrement: true,
      });
      updates.createIndex('document', 'id');
    };
    const db = await requestValue(request);
    db.onversionchange = () => db.close();
    return new DocsDatabase(db);
  }

  async load(id: string): Promise<{ record: StoredDocument; updates: StoredUpdate[] }> {
    const tx = this.db.transaction(['documents', 'updates']);
    const record = requestValue(
      tx.objectStore('documents').get(id) as IDBRequest<StoredDocument | undefined>,
    );
    const updates = requestValue(
      tx.objectStore('updates').index('document').getAll(id) as IDBRequest<StoredUpdate[]>,
    );
    const [stored, entries] = await Promise.all([record, updates]);
    return { record: stored ?? emptyDocument(id), updates: entries };
  }

  async ids(): Promise<string[]> {
    const tx = this.db.transaction('documents');
    return (await requestValue(tx.objectStore('documents').getAllKeys())) as string[];
  }

  /** Начинает транзакцию синхронно, в том же стеке, что и событие Y.Doc. */
  append(id: string, update: Uint8Array, local: boolean, text: string): Promise<void> {
    const tx = this.db.transaction(['documents', 'updates'], 'readwrite');
    const finished = transactionDone(tx);
    const documents = tx.objectStore('documents');
    const updates = tx.objectStore('updates');
    const request = documents.get(id) as IDBRequest<StoredDocument | undefined>;
    request.onsuccess = () => {
      const record = request.result ?? emptyDocument(id);
      if (local) {
        record.version++;
        record.text = text;
      }
      documents.put(record);
    };
    updates.add({ id, update } satisfies StoredUpdate);
    const all = updates.index('document').getAll(id) as IDBRequest<StoredUpdate[]>;
    all.onsuccess = () => {
      if (all.result.length <= 50) return;
      // Сливаем журнал из самой транзакции, а не снимок одной вкладки.
      const merged = Y.mergeUpdates(all.result.map((entry) => entry.update));
      for (const entry of all.result) updates.delete(entry.seq!);
      updates.add({ id, update: merged } satisfies StoredUpdate);
    };
    return finished;
  }

  change(id: string, change: (record: StoredDocument) => void): Promise<void> {
    const tx = this.db.transaction('documents', 'readwrite');
    const finished = transactionDone(tx);
    const store = tx.objectStore('documents');
    const request = store.get(id) as IDBRequest<StoredDocument | undefined>;
    request.onsuccess = () => {
      const record = request.result ?? emptyDocument(id);
      change(record);
      store.put(record);
    };
    return finished;
  }

  async reset(id: string): Promise<void> {
    const tx = this.db.transaction(['documents', 'updates'], 'readwrite');
    const finished = transactionDone(tx);
    tx.objectStore('documents').delete(id);
    const updates = tx.objectStore('updates');
    const keys = updates.index('document').getAllKeys(id);
    keys.onsuccess = () => {
      for (const key of keys.result) updates.delete(key);
    };
    await finished;
  }

  close(): void {
    this.db.close();
  }
}

/** Владелец соединения с IDB и открытых документов; не зависит от редактора. */
export class DocStore {
  private readonly database: Promise<DocsDatabase>;
  private readonly handles = new Map<string, Promise<StoredDocHandle>>();
  private closed = false;
  private readonly online = () => {
    void this.syncAll().catch(() => {
      // Ошибка открытия IDB; ошибки уже открытых документов отражаются в status.
    });
  };

  constructor(private readonly options: DocStoreOptions) {
    this.database = DocsDatabase.open(
      options.dbName ?? 'qubite-docs',
      options.indexedDB ?? globalThis.indexedDB,
    );
    globalThis.addEventListener?.('online', this.online);
  }

  private handle(id: string): Promise<StoredDocHandle> {
    if (this.closed) return Promise.reject(new Error('хранилище документов закрыто'));
    const existing = this.handles.get(id);
    if (existing) return existing;
    const opening: Promise<StoredDocHandle> = (async () => {
      const db = await this.database;
      const { record, updates } = await db.load(id);
      if (this.closed) throw new Error('хранилище документов закрыто');
      const doc = new Y.Doc();
      for (const entry of updates) Y.applyUpdate(doc, entry.update, this);
      return new StoredDocHandle(
        id,
        doc,
        record,
        db,
        this,
        this.options.transport,
        this.options.debounceMs ?? 500,
        () => {
          if (this.handles.get(id) === opening) this.handles.delete(id);
        },
      );
    })();
    this.handles.set(id, opening);
    void opening.catch(() => {
      if (this.handles.get(id) === opening) this.handles.delete(id);
    });
    return opening;
  }

  /** Восстанавливает локальные правки, затем пробует pull; отсутствие сети не мешает открыть. */
  async open(id: string): Promise<DocHandle> {
    const handle = await this.handle(id);
    await handle.sync();
    return handle;
  }

  /** Будит также закрытые документы с неотправленными правками и сохранённым Markdown. */
  async syncAll(): Promise<void> {
    if (this.closed) return;
    const db = await this.database;
    const ids = new Set([...this.handles.keys(), ...(await db.ids())]);
    await Promise.all(
      [...ids].map(async (id) => {
        if (!this.closed) await (await this.handle(id)).sync();
      }),
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    globalThis.removeEventListener?.('online', this.online);
    const results = await Promise.allSettled(
      [...this.handles.values()].map(async (opening) => (await opening).close()),
    );
    (await this.database).close();
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
}

class StoredDocHandle implements DocHandle {
  status: DocStatus;
  seedMarkdown: string | null;
  private lastText: string;
  private textGetter: () => string;
  private readonly statusListeners = new Set<(status: DocStatus) => void>();
  private readonly resetListeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  private storageError = false;
  private textError = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private again = false;
  private closing: Promise<void> | undefined;

  constructor(
    private readonly id: string,
    readonly doc: Y.Doc,
    record: StoredDocument,
    private readonly db: DocsDatabase,
    private readonly origin: DocStore,
    private readonly transport: DocsTransport,
    private readonly debounceMs: number,
    private readonly release: () => void,
  ) {
    this.lastText = record.text;
    this.textGetter = () => this.lastText;
    this.seedMarkdown = record.seedMarkdown;
    this.status =
      record.version > record.syncedVersion || record.seedMarkdown !== null ? 'pending' : 'saved';
    doc.on('update', this.updated);
  }

  get text(): () => string {
    return this.textGetter;
  }

  set text(getter: () => string) {
    if (this.closed) return;
    this.textGetter = getter;
    const text = this.captureText();
    this.track(
      this.db.change(this.id, (record) => {
        record.text = text;
      }),
    );
  }

  private captureText(): string {
    try {
      this.lastText = this.textGetter();
      this.textError = false;
      return this.lastText;
    } catch (error) {
      this.textError = true;
      this.setStatus('error');
      throw error;
    }
  }

  private readonly updated = (update: Uint8Array, origin: unknown) => {
    if (this.closed) return;
    const local = origin !== this.origin;
    // Даже ошибка сериализации экрана не должна помешать записи самих байтов Yjs.
    let text = this.lastText;
    try {
      text = this.captureText();
    } catch {
      this.setStatus('error');
    }
    this.track(this.db.append(this.id, update, local, text));
    if (local) {
      this.setStatus(this.textError ? 'error' : 'pending');
      this.schedule();
    }
  };

  private track(write: Promise<void>): void {
    this.writes = Promise.all([this.writes, write]).then(() => {});
    void this.writes.catch(() => {
      this.storageError = true;
      this.setStatus('error');
    });
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.sync();
    }, this.debounceMs);
  }

  async markSeeded(): Promise<void> {
    if (this.closed) return;
    const text = this.captureText();
    this.track(
      this.db.change(this.id, (record) => {
        record.seed = true;
        record.version++;
        record.text = text;
      }),
    );
    this.setStatus('pending');
    this.schedule();
    await this.writes;
  }

  onStatus(callback: (status: DocStatus) => void): () => void {
    this.statusListeners.add(callback);
    callback(this.status);
    return () => this.statusListeners.delete(callback);
  }

  onReset(callback: () => void): () => void {
    this.resetListeners.add(callback);
    return () => this.resetListeners.delete(callback);
  }

  private setStatus(status: DocStatus): void {
    if (this.closed) return;
    this.status = status;
    for (const callback of this.statusListeners) callback(status);
  }

  sync(): Promise<void> {
    clearTimeout(this.timer);
    if (this.closed) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.exchange();
      } while (this.again && !this.closed);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async exchange(): Promise<void> {
    let requesting = false;
    try {
      await this.writes;
      if (this.closed) return;
      requesting = true;
      const remote = await this.transport.pull(this.id, Y.encodeStateVector(this.doc));
      requesting = false;
      if (this.closed) return;
      Y.applyUpdate(this.doc, remote.update, this.origin);
      this.seedMarkdown = remote.seedMarkdown;
      this.track(
        this.db.change(this.id, (record) => {
          record.serverSv = remote.sv;
          record.seedMarkdown = remote.seedMarkdown;
        }),
      );
      await this.writes;
      const { record, updates } = await this.db.load(this.id);
      if (this.closed) return;
      // Другая вкладка могла дописать в общий журнал после открытия этой копии.
      // Подтверждать record.version можно только вместе со всеми его обновлениями.
      for (const entry of updates) Y.applyUpdate(this.doc, entry.update, this.origin);
      this.lastText = record.text;
      if (record.version > record.syncedVersion) {
        // Экран должен закончить перенос Markdown до первого push.
        if (remote.seedMarkdown !== null && !record.seed) {
          this.setStatus('pending');
          return;
        }
        const text = this.captureText();
        const update = Y.encodeStateAsUpdate(this.doc, remote.sv);
        this.track(
          this.db.change(this.id, (current) => {
            if (current.version === record.version) current.text = text;
          }),
        );
        await this.writes;
        if (this.closed) return;
        requesting = true;
        const response = await this.transport.push(this.id, update, text, record.seed || undefined);
        requesting = false;
        if (this.closed) return;
        this.track(
          this.db.change(this.id, (current) => {
            current.serverSv = response.sv;
            current.syncedVersion = Math.max(current.syncedVersion, record.version);
            current.seed = false;
            current.seedMarkdown = null;
          }),
        );
        this.seedMarkdown = null;
      }
      await this.writes;
      const { record: current } = await this.db.load(this.id);
      this.setStatus(
        current.version > current.syncedVersion || current.seedMarkdown !== null
          ? 'pending'
          : 'saved',
      );
    } catch (error) {
      if (this.closed) return;
      if (this.storageError || this.textError) {
        this.setStatus('error');
      } else if (
        error instanceof HttpError &&
        error.status === 409 &&
        error.code === 'seed_taken'
      ) {
        await this.reset();
      } else if (error instanceof HttpError) {
        this.setStatus(
          error.status === 404 ? 'pending' : error.status >= 500 ? 'offline' : 'error',
        );
      } else {
        this.setStatus(requesting ? 'offline' : 'error');
      }
    }
  }

  private async reset(): Promise<void> {
    clearTimeout(this.timer);
    this.doc.off('update', this.updated);
    try {
      await this.writes;
      await this.db.reset(this.id);
    } catch {
      this.doc.on('update', this.updated);
      this.setStatus('error');
      return;
    }
    this.closed = true;
    this.release();
    this.doc.destroy();
    this.statusListeners.clear();
    for (const callback of this.resetListeners) callback();
    this.resetListeners.clear();
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    clearTimeout(this.timer);
    this.doc.off('update', this.updated);
    this.release();
    this.statusListeners.clear();
    this.resetListeners.clear();
    this.closing = this.writes.finally(() => {
      this.doc.destroy();
    });
    return this.closing;
  }
}

