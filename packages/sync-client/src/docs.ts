/** Документы: метаданные через SyncClient, содержимое Yjs — отдельным обменом. */
import * as Y from 'yjs';
import type { SyncClient } from './client';
import { watchLostEdits, type LostBlock } from './docs-lost';
import {
  docsVersionsTransport,
  restoreDocVersion,
  type DocRestore,
  type DocsVersionsTransport,
  type DocVersion,
} from './docs-versions';
import { csrfFromCookie, HttpError, type HttpTransportOptions } from './http';
import type { ObjectSnapshot } from './protocol';
import type { LocalObject } from './store';

export const DOCS_PAGE = 'docs.page';

export type DocLinkKind = 'docs.page' | 'planner.task' | 'planner.project' | 'calendar.event';
export interface DocLinkTarget {
  id: string;
  type: DocLinkKind;
  title: string;
}
export interface DocLink extends DocLinkTarget {
  deleted: boolean;
}

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
  textStale?: boolean;
}

export interface DocsTransport extends DocsVersionsTransport {
  pull(id: string, sv: Uint8Array): Promise<DocsPullResponse>;
  push(
    id: string,
    update: Uint8Array,
    text: string,
    seed?: boolean,
    snapshot?: Uint8Array,
    links?: string[],
    restore?: DocRestore,
  ): Promise<DocsPushResponse>;
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
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  const path = (id: string) => `/api/v1/docs/${encodeURIComponent(id)}/y`;
  return {
    ...docsVersionsTransport(call),
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
    async push(id, update, text, seed, snapshot, links, restore) {
      const response = await call<{ sv: string; text_stale?: boolean }>(path(id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          update: toBase64(update),
          text,
          ...(links !== undefined ? { links } : {}),
          ...(seed ? { seed: true } : {}),
          ...(snapshot ? { snapshot: toBase64(snapshot) } : {}),
          ...(restore ? { reason: restore.reason, restore_of: restore.restore_of } : {}),
        }),
      });
      return { sv: fromBase64(response.sv), textStale: response.text_stale ?? false };
    },
  };
}

export type DocStatus = 'saved' | 'pending' | 'offline' | 'error';

export interface DocHandle {
  readonly doc: Y.Doc;
  readonly id: string;
  readonly links: readonly DocLink[];
  cacheLinks(links: readonly DocLink[]): Promise<void>;
  onLinks(callback: () => void): () => void;
  readonly status: DocStatus;
  readonly seedMarkdown: string | null;
  readonly recovered: string | null;
  readonly lost: LostBlock[];
  clearRecovered(): Promise<void>;
  onLost(callback: (lost: LostBlock[]) => void): () => void;
  clearLost(): Promise<void>;
  /** Без экрана — renderText, а без него последний сохранённый Markdown. */
  text: () => string;
  sync(): Promise<void>;
  /** Возвращает скачанный снимок локальной правкой, не требует сети. */
  /** Есть серверное состояние или свои правки; восстановление пустого дерева запрещено. */
  readonly loaded: boolean;
  restoreVersion(version: Pick<DocVersion, 'id' | 'ystate'>): Promise<void>;
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
  renderText?: (doc: Y.Doc, links: readonly DocLink[]) => string;
  /** Читает UUID из дерева редактора, без разбора Markdown. */
  extractLinks?: (doc: Y.Doc) => string[];
}

interface StoredDocument {
  links: DocLink[];
  id: string;
  /** Счётчики меняются внутри IDB-транзакции, включая правки из другой вкладки. */
  version: number;
  syncedVersion: number;
  /** Текст требует подтверждения, даже если новых Yjs-правок уже нет. */
  textPending: boolean;
  textStale: boolean;
  /** Растёт при переименовании упомянутой цели; общий для вкладок через IDB. */
  renameGen?: number;
  text: string;
  seed: boolean;
  /** Вектор первого seed-запроса: переживает потерю ответа и перезапуск. */
  seedSv: Uint8Array | null;
  recovered: string | null;
  lost: LostBlock[];
  seedMarkdown: string | null;
  serverSv: Uint8Array | null;
  /** Поколение — счётчик IDB, чтобы ответ старого push не снял новое восстановление. */
  restore: { id: string; version: number } | null;
}

interface StoredUpdate {
  seq?: number;
  id: string;
  update: Uint8Array;
}

const emptyDocument = (id: string): StoredDocument => ({
  id,
  links: [],
  version: 0,
  syncedVersion: 0,
  textPending: false,
  textStale: false,
  text: '',
  seed: false,
  seedSv: null,
  recovered: null,
  lost: [],
  seedMarkdown: null,
  serverSv: null,
  restore: null,
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
    return { record: { ...emptyDocument(id), ...stored }, updates: entries };
  }

  async ids(): Promise<string[]> {
    const tx = this.db.transaction('documents');
    return (await requestValue(tx.objectStore('documents').getAllKeys())) as string[];
  }

  /** Начинает транзакцию синхронно, в том же стеке, что и событие Y.Doc. */
  append(
    id: string,
    update: Uint8Array,
    local: boolean,
    text: string,
    restoreOf?: string,
  ): Promise<void> {
    const tx = this.db.transaction(['documents', 'updates'], 'readwrite');
    const finished = transactionDone(tx);
    const documents = tx.objectStore('documents');
    const updates = tx.objectStore('updates');
    const request = documents.get(id) as IDBRequest<StoredDocument | undefined>;
    request.onsuccess = () => {
      const record = { ...emptyDocument(id), ...request.result };
      if (local) {
        record.version++;
        record.text = text;
        if (restoreOf !== undefined) record.restore = { id: restoreOf, version: record.version };
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
      const record = { ...emptyDocument(id), ...request.result };
      change(record);
      store.put(record);
    };
    return finished;
  }

  async reset(id: string, recovered: string): Promise<void> {
    const tx = this.db.transaction(['documents', 'updates'], 'readwrite');
    const finished = transactionDone(tx);
    const documents = tx.objectStore('documents');
    const request = documents.get(id) as IDBRequest<StoredDocument | undefined>;
    request.onsuccess = () => {
      const previous = request.result;
      const record = emptyDocument(id);
      // Сброс журнала и спасённый текст — одна транзакция, без окна потери.
      record.recovered = previous?.recovered ?? null;
      if (recovered && recovered !== record.recovered) {
        record.recovered = record.recovered ? `${record.recovered}\n\n${recovered}` : recovered;
      }
      record.lost = previous?.lost ?? [];
      record.links = previous?.links ?? [];
      documents.put(record);
    };
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
        this.options.renderText,
        this.options.extractLinks,
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
    for (;;) {
      const handle = await this.handle(id);
      await handle.sync();
      if (!handle.isClosed) return handle;
    }
  }

  /** В отличие от open, не ждёт попытки сетевого обмена перед локальной правкой. */
  async restoreVersion(id: string, version: Pick<DocVersion, 'id' | 'ystate'>): Promise<void> {
    // Нужна загруженная копия: иначе пустое дерево не заменит серверные блоки (замечание ревью #198).
    const handle = await this.open(id);
    if (!handle.loaded) {
      throw new Error(
        'Документ ещё не загружен на это устройство: подключитесь к сети и откройте его',
      );
    }
    await handle.restoreVersion(version);
  }

  /** D-813: именованный снимок создаётся только после подтверждения локальных правок. */
  async createVersion(id: string, name: string): Promise<DocVersion> {
    const handle = await this.open(id);
    if (handle.status !== 'saved') throw new Error('Нужна связь: документ ещё не сохранён');
    return this.options.transport.createVersion(id, name);
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

/** Чуть меньше лимита сервера (512 КБ, D-751): запас на служебные поля запроса. */
const MAX_RESTORE_UPDATE_BYTES = 480 * 1024;

class RestoreOrigin {
  constructor(readonly id: string) {}
}

class StoredDocHandle implements DocHandle {
  links: readonly DocLink[];
  private readonly linkListeners = new Set<() => void>();
  status: DocStatus;
  seedMarkdown: string | null;
  recovered: string | null;
  lost: LostBlock[];
  private serverSv: Map<number, number>;
  private readonly stopLost: () => void;
  private readonly lostListeners = new Set<(lost: LostBlock[]) => void>();
  private lastText: string;
  private textGetter: () => string;
  private hasTextRenderer: boolean;
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
    readonly id: string,
    readonly doc: Y.Doc,
    record: StoredDocument,
    private readonly db: DocsDatabase,
    private readonly origin: DocStore,
    private readonly transport: DocsTransport,
    private readonly debounceMs: number,
    private readonly renderText: DocStoreOptions['renderText'],
    private readonly extractLinks: DocStoreOptions['extractLinks'],
    private readonly release: () => void,
  ) {
    this.links = record.links;
    this.hasTextRenderer = Boolean(renderText);
    this.lastText = record.text;
    this.textGetter = renderText ? () => renderText(this.doc, this.links) : () => this.lastText;
    this.seedMarkdown = record.seedMarkdown;
    this.recovered = record.recovered;
    this.lost = record.lost;
    this.serverSv = record.serverSv ? Y.decodeStateVector(record.serverSv) : new Map();
    this.stopLost = watchLostEdits(
      doc,
      origin,
      (found) => {
        this.lost = [...this.lost, ...found];
        this.track(this.db.change(this.id, (current) => current.lost.push(...found)));
        for (const callback of this.lostListeners) callback(this.lost);
      },
      () => this.serverSv,
      'all',
    );
    this.status =
      record.version > record.syncedVersion ||
      record.textPending ||
      record.restore !== null ||
      record.seedMarkdown !== null
        ? 'pending'
        : 'saved';
    doc.on('update', this.updated);
  }

  async cacheLinks(links: readonly DocLink[]): Promise<void> {
    if (this.closed) return;
    // Отсутствие цели в ответе не стирает офлайн-название недавно вставленного чипа.
    const merged = new Map(this.links.map((link) => [link.id, link]));
    // Текст для поиска хранит `@Название`: переименование используемой цели
    // требует повторной отправки текста, но не новых Yjs-правок.
    const used = this.extractLinks ? new Set(this.extractLinks(this.doc)) : null;
    const renamed = links.some((link) => {
      const before = merged.get(link.id);
      return before !== undefined && before.title !== link.title && (!used || used.has(link.id));
    });
    for (const link of links) merged.set(link.id, link);
    this.links = [...merged.values()];
    this.track(
      this.db.change(this.id, (record) => {
        const saved = new Map(record.links.map((link) => [link.id, link]));
        for (const link of links) saved.set(link.id, link);
        record.links = [...saved.values()];
        if (renamed) {
          record.textPending = true;
          record.renameGen = (record.renameGen ?? 0) + 1;
        }
      }),
    );
    for (const callback of this.linkListeners) callback();
    if (renamed) {
      this.setStatus('pending');
      this.schedule();
    }
    await this.writes;
  }

  onLinks(callback: () => void): () => void {
    this.linkListeners.add(callback);
    return () => this.linkListeners.delete(callback);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  onLost(callback: (lost: LostBlock[]) => void): () => void {
    this.lostListeners.add(callback);
    callback(this.lost);
    return () => this.lostListeners.delete(callback);
  }

  async clearLost(): Promise<void> {
    const count = this.lost.length;
    this.track(
      this.db.change(this.id, (record) => {
        record.lost.splice(0, count);
      }),
    );
    await this.writes;
    // Во время записи могло прийти ещё удаление: оно требует отдельного выбора.
    this.lost = this.lost.slice(count);
    for (const callback of this.lostListeners) callback(this.lost);
  }

  async clearRecovered(): Promise<void> {
    this.track(
      this.db.change(this.id, (record) => {
        record.recovered = null;
      }),
    );
    await this.writes;
    this.recovered = null;
    this.setStatus(this.status);
  }

  get text(): () => string {
    return this.textGetter;
  }

  set text(getter: () => string) {
    if (this.closed) return;
    this.hasTextRenderer = true;
    this.textGetter = getter;
    const text = this.captureText();
    this.track(
      this.db.change(this.id, (record) => {
        record.text = text;
      }),
    );
  }

  private captureText(fromDoc = false): string {
    try {
      this.lastText =
        fromDoc && this.renderText ? this.renderText(this.doc, this.links) : this.textGetter();
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
      text = this.captureText(origin instanceof RestoreOrigin);
    } catch {
      this.setStatus('error');
    }
    this.track(
      this.db.append(
        this.id,
        update,
        local,
        text,
        origin instanceof RestoreOrigin ? origin.id : undefined,
      ),
    );
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

  /** Есть серверное состояние или свои правки: пустое дерево без них не заменит чужие блоки. */
  get loaded(): boolean {
    return this.serverSv.size > 0 || this.doc.get('root', Y.XmlText).length > 0;
  }

  async restoreVersion(version: Pick<DocVersion, 'id' | 'ystate'>): Promise<void> {
    if (this.closed) throw new Error('документ закрыт');
    // Сервер принимает обновление до 512 КБ: проверяем на копии, пока документ не изменён.
    const probe = new Y.Doc();
    Y.applyUpdate(probe, Y.encodeStateAsUpdate(this.doc));
    let probeSize = 0;
    probe.on('update', (update: Uint8Array) => {
      probeSize += update.length;
    });
    restoreDocVersion(probe, version, null);
    probe.destroy();
    if (probeSize > MAX_RESTORE_UPDATE_BYTES) {
      throw new Error('Документ слишком большой, чтобы восстановить версию целиком');
    }
    let changed = false;
    const observe = () => {
      changed = true;
    };
    this.doc.on('update', observe);
    try {
      // updated записывает и байты, и restore в одной транзакции IndexedDB.
      restoreDocVersion(this.doc, version, new RestoreOrigin(version.id));
    } finally {
      this.doc.off('update', observe);
    }
    if (!changed) {
      // Даже восстановление пустого снимка поверх пустого дерева требует before_restore.
      const text = this.captureText(true);
      this.track(
        this.db.change(this.id, (record) => {
          record.version++;
          record.text = text;
          record.restore = { id: version.id, version: record.version };
        }),
      );
      this.setStatus('pending');
      this.schedule();
    }
    await this.writes;
  }

  async markSeeded(): Promise<void> {
    if (this.closed) return;
    const text = this.captureText();
    this.track(
      this.db.change(this.id, (record) => {
        record.seed = true;
        record.seedSv = null;
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

  private async exchange(allowTextCatchup = true): Promise<void> {
    let requesting = false;
    try {
      await this.writes;
      if (this.closed) return;
      requesting = true;
      const remote = await this.transport.pull(this.id, Y.encodeStateVector(this.doc));
      requesting = false;
      if (this.closed) return;
      await this.writes;
      const pendingSeed = (await this.db.load(this.id)).record.seed;
      if (this.closed) return;
      // Чужой seed пока не вливаем: запасной Markdown должен содержать свой
      // вариант, а вектор seed-запроса — только отправленные локальные Item.
      if (!pendingSeed || remote.seedMarkdown !== null) {
        Y.applyUpdate(this.doc, remote.update, this.origin);
      }
      this.serverSv = Y.decodeStateVector(remote.sv);
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
      this.links = record.links;
      for (const callback of this.linkListeners) callback();
      if (record.version > record.syncedVersion || record.textPending || record.restore !== null) {
        // Экран должен закончить перенос Markdown до первого push.
        if (remote.seedMarkdown !== null && !record.seed) {
          this.setStatus('pending');
          return;
        }
        // После слияния нужен текст дерева, а не сохранённый до pull Markdown.
        if (record.textStale && !this.hasTextRenderer) {
          this.setStatus('pending');
          return;
        }
        const text =
          (record.textStale || record.restore !== null) && this.renderText
            ? this.renderText(this.doc, this.links)
            : this.captureText();
        // Снимок относится к тому же дереву, из которого только что получен text.
        // Одного state vector недостаточно: удаления его не меняют.
        const links = this.extractLinks ? [...new Set(this.extractLinks(this.doc))] : undefined;
        if (links && links.length > 200) {
          throw new Error('В документе больше 200 разных ссылок');
        }
        const clientSnapshot = Y.encodeSnapshot(Y.snapshot(this.doc));
        const update = Y.encodeStateAsUpdate(this.doc, remote.sv);
        const seedSv = record.seedSv ?? Y.encodeStateVector(this.doc);
        this.track(
          this.db.change(this.id, (current) => {
            if (current.version === record.version) current.text = text;
            // Потерянный ответ тоже требует повтора текста после перезапуска.
            current.textPending = true;
            if (record.seed && current.seedSv === null) current.seedSv = seedSv;
          }),
        );
        await this.writes;
        if (this.closed) return;
        requesting = true;
        let response: DocsPushResponse;
        try {
          response = await this.transport.push(
            this.id,
            update,
            text,
            record.seed || undefined,
            clientSnapshot,
            links,
            record.restore ? { reason: 'restore', restore_of: record.restore.id } : undefined,
          );
        } catch (error) {
          if (!(
            record.seed &&
            error instanceof HttpError &&
            error.status === 409 &&
            error.code === 'seed_taken'
          )) {
            throw error;
          }
          // Ответ первого принятого seed мог потеряться. Сравниваем с первым
          // отправленным вектором, а не с более поздними локальными дописками.
          const latest = await this.transport.pull(this.id, Y.encodeStateVector(this.doc));
          requesting = false;
          if (this.closed) return;
          const accepted = Y.decodeStateVector(latest.sv);
          const ownSeed = [...Y.decodeStateVector(seedSv)].every(
            ([client, clock]) => (accepted.get(client) ?? 0) >= clock,
          );
          if (!ownSeed) {
            await this.reset();
            return;
          }
          Y.applyUpdate(this.doc, latest.update, this.origin);
          this.serverSv = accepted;
          this.seedMarkdown = null;
          this.track(
            this.db.change(this.id, (current) => {
              current.seed = false;
              current.seedSv = null;
              current.seedMarkdown = null;
              current.serverSv = latest.sv;
            }),
          );
          await this.writes;
          this.again = true;
          return;
        }
        requesting = false;
        if (this.closed) return;
        this.serverSv = Y.decodeStateVector(response.sv);
        this.track(
          this.db.change(this.id, (current) => {
            current.serverSv = response.sv;
            current.syncedVersion = Math.max(current.syncedVersion, record.version);
            // Переименование после начала этого push (в том числе из другой вкладки)
            // не подтверждено: его текст ещё не отправлен.
            current.textPending =
              (response.textStale ?? false) || (current.renameGen ?? 0) !== (record.renameGen ?? 0);
            current.textStale = response.textStale ?? false;
            current.seed = false;
            current.seedSv = null;
            current.seedMarkdown = null;
            if (
              !response.textStale &&
              record.restore !== null &&
              current.restore?.version === record.restore.version
            ) {
              current.restore = null;
            }
          }),
        );
        this.seedMarkdown = null;
        if (response.textStale && allowTextCatchup) {
          await this.writes;
          await this.exchange(false);
          return;
        }
      }
      await this.writes;
      const { record: current } = await this.db.load(this.id);
      this.setStatus(
        current.version > current.syncedVersion ||
          current.textPending ||
          current.restore !== null ||
          current.seedMarkdown !== null
          ? 'pending'
          : 'saved',
      );
    } catch (error) {
      if (this.closed) return;
      if (this.storageError || this.textError) {
        this.setStatus('error');
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
    const recovered = this.captureText();
    this.doc.off('update', this.updated);
    try {
      await this.writes;
      await this.db.reset(this.id, recovered);
    } catch {
      this.doc.on('update', this.updated);
      this.setStatus('error');
      return;
    }
    this.closed = true;
    this.release();
    this.stopLost();
    this.lostListeners.clear();
    this.linkListeners.clear();
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
    this.stopLost();
    this.lostListeners.clear();
    this.linkListeners.clear();
    this.statusListeners.clear();
    this.resetListeners.clear();
    this.closing = this.writes.finally(() => {
      this.doc.destroy();
    });
    return this.closing;
  }
}
