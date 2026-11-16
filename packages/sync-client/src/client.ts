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
  Cursor,
  Fields,
  ObjectSnapshot,
  Operation,
  OpResult,
  PullResponse,
  PushRequest,
  PushResponse,
} from './protocol';
import { MAX_OPS_PER_PUSH } from './protocol';
import { LocalStore, snapshotOf, type LocalObject, type Problem } from './store';
import { uuidv7 } from './uuid';

/** Как клиент разговаривает с сервером. В тестах — подделка, в приложении — HTTP. */
export interface Transport {
  push(request: PushRequest): Promise<PushResponse>;
  pull(cursor: Cursor, limit: number): Promise<PullResponse>;
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
    /** Имя хранилища в IndexedDB: рядом с ним живут свои очереди (голос, CMD-005b). */
    readonly dbName: string,
  ) {}

  static async open(options: SyncClientOptions): Promise<SyncClient> {
    const store = await LocalStore.open(options.dbName, options.indexedDB);
    let deviceId = await store.meta<string>('device_id');
    if (!deviceId) {
      deviceId = uuidv7();
      await store.setMeta('device_id', deviceId);
    }
    const client = new SyncClient(store, options.transport, deviceId, options.dbName);
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
    // Чтение, новая версия, запись и операция — одной транзакцией хранилища: две
    // правки подряд (в том числе из двух вкладок) не затирают друг друга.
    const updated = await this.store.edit(id, (object) => ({
      object: {
        ...change(object),
        revision: object.revision + 1,
        updated_at_ms: Date.now(),
        pending: true,
        // Первая неотправленная правка: запомнить версию сервера, чтобы вернуться
        // к ней, если правку отклонят.
        ...(object.pending || object.server || object.stale ? {} : { server: snapshotOf(object) }),
      },
      op: { op_id: uuidv7(), object_id: id, base_revision: object.revision, ...kind } as Operation,
    }));
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
      let handled = 0;
      for (const entry of queued) {
        const result = byId.get(entry.op.op_id);
        if (!result) break; // сервер не ответил по операции — оставляем её и следующие
        await this.handleResult(entry.seq, entry.op, result);
        handled += 1;
      }
      if (handled < queued.length) return;
    }
  }

  /**
   * Ответ сервера на операцию. Объект, «проблема» и очередь меняются одной
   * транзакцией: правка, сделанная в этот момент (или в другой вкладке), не теряется.
   */
  private async handleResult(seq: number, op: Operation, result: OpResult): Promise<void> {
    const problem = result.status === 'applied' ? null : { op, result };
    await this.store.settle(seq, op, problem, (local, stillPending) => {
      // `stillPending` — ждут отправки более поздние правки того же объекта.
      switch (result.status) {
        case 'applied': {
          if (!local || stillPending) return {};
          // Отложенная версия сервера больше не нужна; пометка `stale` остаётся —
          // снимок, который придёт следом, заменит объект.
          const confirmed: LocalObject = { ...snapshotOf(local), pending: false };
          return { object: local.stale ? { ...confirmed, stale: true } : confirmed };
        }
        case 'conflict':
          return {
            object: {
              ...result.current,
              pending: stillPending,
              ...(stillPending ? { server: result.current } : {}),
            },
          };
        case 'rejected': {
          if (!local) return {};
          // Объект так и не появился на сервере — на устройстве его больше нет.
          if (op.kind === 'create') {
            return { object: { ...snapshotOf(local), deleted: true, pending: false } };
          }
          // Сервер правку не принял: на экране не должно остаться то, чего нет на
          // сервере. Пока в очереди есть более поздние правки объекта, решают они.
          if (stillPending) return { object: { ...local, stale: true } };
          if (local.server) return { object: { ...local.server, pending: false } };
          if (!local.pending && !local.stale) return {};
          // Вернуться не к чему (правка сделана до SYNC-008): помечаем объект и
          // забираем всё с сервера заново — снимок его заменит.
          return { object: { ...local, pending: false, stale: true }, resync: true };
        }
      }
    });
  }

  private async pullAll(): Promise<void> {
    // «Забрать всё заново» переживает перезагрузку и другую вкладку: флаг снимается
    // только после того, как полная выгрузка дошла до конца.
    const resync = (await this.store.meta<boolean>('resync')) === true;
    let cursor: Cursor = resync ? 0 : ((await this.store.meta<Cursor>('cursor')) ?? 0);
    for (;;) {
      const page = await this.transport.pull(cursor, PULL_PAGE);
      for (const snapshot of page.changes) await this.mergeSnapshot(snapshot);
      cursor = page.cursor;
      await this.store.setMeta('cursor', cursor);
      if (!page.has_more) break;
    }
    if (resync) await this.store.deleteMeta('resync');
  }

  /**
   * Серверная версия не затирает локальные неотправленные правки: пока они есть,
   * снимок откладывается рядом (`server`) — к нему объект вернётся, если правку
   * отклонят. Объект с отклонённой правкой (`stale`) снимок заменяет всегда.
   */
  private async mergeSnapshot(snapshot: ObjectSnapshot): Promise<void> {
    await this.store.merge(snapshot, (local) => {
      if (!local) return { ...snapshot, pending: false };
      if (local.pending) {
        if (local.server && local.server.revision > snapshot.revision) return null;
        return { ...local, server: snapshot };
      }
      if (!local.stale && local.revision > snapshot.revision) return null;
      return { ...snapshot, pending: false };
    });
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
