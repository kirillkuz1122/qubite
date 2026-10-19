/**
 * Клиент синхронизации для браузера (и потом — для любой оболочки с IndexedDB).
 *
 * Как это работает:
 * 1. Действие пользователя сразу записывается локально вместе с операцией в
 *    очереди — одной транзакцией. Статус «сохранено на устройстве».
 * 2. `sync()` отправляет очередь по порядку. Подтверждённые операции уходят из
 *    очереди; при обрыве сети они остаются и уйдут при следующей попытке.
 * 3. Конфликт: на сервере уже другая версия — локальная копия заменяется
 *    серверной, а неприменённая правка сохраняется в «проблемах», чтобы человек
 *    решил, что с ней делать. Ничего не теряется молча.
 * 4. Затем забираются изменения с сервера после курсора.
 */
import type {
  Fields,
  ObjectSnapshot,
  Operation,
  OpResult,
  PullResponse,
  PushRequest,
  PushResponse,
} from './protocol';
import { MAX_OPS_PER_PUSH } from './protocol';
import { LocalStore, type LocalObject, type Problem } from './store';
import { uuidv7 } from './uuid';

/** Как клиент разговаривает с сервером. В тестах — подделка, в приложении — HTTP. */
export interface Transport {
  push(request: PushRequest): Promise<PushResponse>;
  pull(cursor: number, limit: number): Promise<PullResponse>;
}

/**
 * Честный статус для интерфейса:
 * - `synced` — всё подтверждено сервером;
 * - `saved_local` — сохранено на устройстве, ждёт отправки;
 * - `syncing` — идёт обмен;
 * - `conflict` — есть изменения, которые требуют решения человека;
 * - `error` — сервер недоступен, данные в безопасности на устройстве.
 */
export type SyncStatus = 'synced' | 'saved_local' | 'syncing' | 'conflict' | 'error';

export interface SyncState {
  status: SyncStatus;
  pending: number;
  problems: number;
  lastError?: string;
}

export interface SyncClientOptions {
  dbName: string;
  transport: Transport;
  indexedDB?: IDBFactory;
}

const PULL_PAGE = 200;

export class SyncClient {
  private listeners = new Set<(state: SyncState) => void>();
  private running: Promise<SyncState> | null = null;
  private again = false;
  private current: SyncState = { status: 'synced', pending: 0, problems: 0 };
  private closed = false;

  private constructor(
    private readonly store: LocalStore,
    private readonly transport: Transport,
    private readonly deviceId: string,
  ) {}

  static async open(options: SyncClientOptions): Promise<SyncClient> {
    const store = await LocalStore.open(options.dbName, options.indexedDB);
    let deviceId = await store.meta<string>('device_id');
    if (!deviceId) {
      deviceId = uuidv7();
      await store.setMeta('device_id', deviceId);
    }
    const client = new SyncClient(store, options.transport, deviceId);
    await client.refreshState();
    return client;
  }

  /** Закрыть хранилище. Незаконченная синхронизация после этого тихо заканчивается. */
  close(): void {
    this.closed = true;
    this.store.close();
  }

  // ------------------------------------------------------------- изменения

  /**
   * Создать объект локально. Работает без сети.
   * `fields` уходят на сервер; `localFields` — только для показа до ответа
   * сервера (например, статус «new», который сервер ставит сам).
   */
  async create(
    objectType: string,
    title: string,
    fields?: Fields,
    localFields?: Fields,
  ): Promise<LocalObject> {
    const id = uuidv7();
    const object: LocalObject = {
      id,
      object_type: objectType,
      title,
      revision: 1,
      deleted: false,
      updated_at_ms: Date.now(),
      ...(fields || localFields ? { fields: { ...localFields, ...fields } } : {}),
      pending: true,
    };
    await this.store.commitLocal(object, {
      op_id: uuidv7(),
      object_id: id,
      kind: 'create',
      object_type: objectType,
      title,
      ...(fields ? { fields } : {}),
    });
    await this.refreshState();
    return object;
  }

  /**
   * Изменить поля модуля (например, `{ status: 'archived' }`). Работает без сети.
   * `localFields` — только для показа до ответа сервера (например, время выполнения).
   */
  async patch(id: string, fields: Fields, localFields?: Fields): Promise<LocalObject> {
    return this.edit(id, { kind: 'patch', fields }, (object) => ({
      ...object,
      fields: { ...object.fields, ...localFields, ...fields },
    }));
  }

  async setTitle(id: string, title: string): Promise<LocalObject> {
    return this.edit(id, { kind: 'set_title', title }, (object) => ({ ...object, title }));
  }

  async remove(id: string): Promise<LocalObject> {
    return this.edit(id, { kind: 'delete' }, (object) => ({ ...object, deleted: true }));
  }

  async restore(id: string): Promise<LocalObject> {
    return this.edit(id, { kind: 'restore' }, (object) => ({ ...object, deleted: false }));
  }

  private async edit(
    id: string,
    kind:
      | { kind: 'set_title'; title: string }
      | { kind: 'delete' }
      | { kind: 'restore' }
      | { kind: 'patch'; fields: Fields },
    change: (object: LocalObject) => LocalObject,
  ): Promise<LocalObject> {
    const object = await this.store.object(id);
    if (!object) throw new Error(`объект ${id} не найден на устройстве`);
    const updated: LocalObject = {
      ...change(object),
      revision: object.revision + 1,
      updated_at_ms: Date.now(),
      pending: true,
    };
    const op = { op_id: uuidv7(), object_id: id, base_revision: object.revision, ...kind };
    await this.store.commitLocal(updated, op as Operation);
    await this.refreshState();
    return updated;
  }

  // ------------------------------------------------------------- чтение

  /** Живые объекты на устройстве. */
  async list(): Promise<LocalObject[]> {
    return (await this.store.objects()).filter((object) => !object.deleted);
  }

  /** Все объекты на устройстве, включая корзину. */
  async all(): Promise<LocalObject[]> {
    return this.store.objects();
  }

  async get(id: string): Promise<LocalObject | undefined> {
    return this.store.object(id);
  }

  async problems(): Promise<Problem[]> {
    return this.store.problems();
  }

  async dismissProblem(opId: string): Promise<void> {
    await this.store.dismissProblem(opId);
    await this.refreshState();
  }

  state(): SyncState {
    return this.current;
  }

  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  // ------------------------------------------------------------- обмен

  /**
   * Отправить очередь и забрать изменения. Параллельные вызовы объединяются, но
   * вызов во время обмена («есть новое» с сервера, новая правка) не теряется:
   * после текущего обмена пройдёт ещё один.
   */
  sync(): Promise<SyncState> {
    if (this.closed) return Promise.resolve(this.current);
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      let state: SyncState;
      do {
        this.again = false;
        state = await this.runSync();
      } while (this.again);
      return state;
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runSync(): Promise<SyncState> {
    this.emit({ ...this.current, status: 'syncing' });
    try {
      await this.pushAll();
      await this.pullAll();
      return await this.refreshState();
    } catch (error) {
      // хранилище закрыли посреди синхронизации (ушли со страницы) — читать его уже нельзя
      if (this.closed) return this.current;
      return await this.refreshState(error instanceof Error ? error.message : String(error));
    }
  }

  private async pushAll(): Promise<void> {
    for (;;) {
      const queued = await this.store.outbox(MAX_OPS_PER_PUSH);
      if (queued.length === 0) return;
      const response = await this.transport.push({
        device_id: this.deviceId,
        ops: queued.map((entry) => entry.op),
      });
      const byId = new Map(response.results.map((result) => [result.op_id, result]));
      const handled: number[] = [];
      for (const entry of queued) {
        const result = byId.get(entry.op.op_id);
        if (!result) break; // сервер не ответил по операции — оставляем её и следующие
        await this.handleResult(entry.seq, entry.op, result);
        handled.push(entry.seq);
      }
      await this.store.removeFromOutbox(handled);
      if (handled.length < queued.length) return;
    }
  }

  private async handleResult(seq: number, op: Operation, result: OpResult): Promise<void> {
    // Ждут отправки только более поздние правки того же объекта: ранние уже
    // разобраны в этом же пакете, хоть и не убраны из очереди.
    const stillPending = (await this.store.outbox(MAX_OPS_PER_PUSH * 2)).some(
      (entry) => entry.seq > seq && entry.op.object_id === op.object_id,
    );
    const local = await this.store.object(op.object_id);
    switch (result.status) {
      case 'applied':
        if (local && !stillPending) await this.store.putObject({ ...local, pending: false });
        return;
      case 'conflict':
        await this.store.putObject({ ...result.current, pending: stillPending });
        await this.store.addProblem({ op, result });
        return;
      case 'rejected':
        if (local && op.kind === 'create')
          await this.store.putObject({ ...local, deleted: true, pending: false });
        await this.store.addProblem({ op, result });
        return;
    }
  }

  private async pullAll(): Promise<void> {
    let cursor = (await this.store.meta<number>('cursor')) ?? 0;
    for (;;) {
      const page = await this.transport.pull(cursor, PULL_PAGE);
      for (const snapshot of page.changes) await this.mergeSnapshot(snapshot);
      cursor = page.cursor;
      await this.store.setMeta('cursor', cursor);
      if (!page.has_more) return;
    }
  }

  /** Серверная версия не затирает локальные неотправленные правки. */
  private async mergeSnapshot(snapshot: ObjectSnapshot): Promise<void> {
    const local = await this.store.object(snapshot.id);
    if (local?.pending) return;
    if (local && local.revision > snapshot.revision) return;
    await this.store.putObject({ ...snapshot, pending: false });
  }

  private async refreshState(lastError?: string): Promise<SyncState> {
    const pending = await this.store.outboxSize();
    const problems = (await this.store.problems()).length;
    let status: SyncStatus;
    if (lastError) status = 'error';
    else if (problems > 0) status = 'conflict';
    else if (pending > 0) status = 'saved_local';
    else status = 'synced';
    const state: SyncState = { status, pending, problems, ...(lastError ? { lastError } : {}) };
    this.emit(state);
    return state;
  }

  private emit(state: SyncState): void {
    this.current = state;
    for (const listener of this.listeners) listener(state);
  }
}
