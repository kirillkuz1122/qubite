/**
 * Локальное хранилище устройства в IndexedDB:
 * - `outbox` — очередь операций, ещё не подтверждённых сервером (по порядку);
 * - `objects` — локальная копия объектов (то, что видит интерфейс);
 * - `meta` — курсор синхронизации, ID устройства;
 * - `problems` — конфликты и отклонённые операции, о которых надо сказать человеку.
 */
import type { ObjectSnapshot, OpResult, Operation } from './protocol';

export interface LocalObject extends ObjectSnapshot {
  /** Есть ли изменения, ещё не подтверждённые сервером. */
  pending: boolean;
  /**
   * Последняя известная версия сервера, пока на объекте есть неотправленные правки
   * (SYNC-008). Снимки с сервера, пришедшие в это время, не затирают правку, а
   * откладываются сюда; если правку отклонят, объект возвращается к этой версии.
   */
  server?: ObjectSnapshot;
  /**
   * На экране осталась правка, которую сервер отклонил, а вернуться было не к чему:
   * следующий снимок сервера заменяет объект, какой бы ни была его версия.
   */
  stale?: true;
}

/** Снимок без служебных полей устройства. */
export function snapshotOf(object: LocalObject): ObjectSnapshot {
  const snapshot: Partial<LocalObject> = { ...object };
  delete snapshot.pending;
  delete snapshot.server;
  delete snapshot.stale;
  return snapshot as ObjectSnapshot;
}

export interface QueuedOp {
  seq?: number;
  op: Operation;
}

export interface Problem {
  op: Operation;
  result: Extract<OpResult, { status: 'conflict' | 'rejected' }>;
}

const VERSION = 1;

/** Запрос IndexedDB → обещание (общее для хранилищ пакета). */
export function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Транзакция IndexedDB завершилась (или упала). */
export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('транзакция IndexedDB прервана'));
  });
}

export class LocalStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(name: string, factory: IDBFactory = indexedDB): Promise<LocalStore> {
    const request = factory.open(name, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      db.createObjectStore('objects', { keyPath: 'id' });
      db.createObjectStore('meta');
      db.createObjectStore('problems', { keyPath: 'op.op_id' });
    };
    const db = await promisify(request);
    // Хранилище удаляют (выход из аккаунта в другой вкладке) — отпустить его, а не держать.
    db.onversionchange = () => db.close();
    return new LocalStore(db);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Выполнить шаги одной транзакцией. Внутри — только запросы IndexedDB через
   * обработчики `onsuccess` (без `await`): так транзакция остаётся открытой, а записи
   * других вкладок и параллельных вызовов встают в очередь, а не вклиниваются.
   */
  private run<T>(
    stores: string[],
    body: (tx: IDBTransaction, done: (value: T) => void) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const tx = this.db.transaction(stores, 'readwrite');
      let value: T | undefined;
      let failure: unknown;
      tx.oncomplete = () => resolve(value as T);
      tx.onerror = () => reject(failure ?? tx.error);
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('транзакция IndexedDB прервана'));
      try {
        body(tx, (result) => (value = result));
      } catch (error) {
        failure = error;
        tx.abort();
      }
    });
  }

  /**
   * Правка объекта: прочитать, посчитать новую версию, записать объект и операцию —
   * всё одной транзакцией (SYNC-008). Две правки подряд (и из двух вкладок) видят
   * результат друг друга, а не одну и ту же старую версию.
   */
  edit(
    id: string,
    apply: (current: LocalObject) => { object: LocalObject; op: Operation },
  ): Promise<LocalObject> {
    let failure: unknown;
    return this.run<LocalObject>(['objects', 'outbox'], (tx, done) => {
      const objects = tx.objectStore('objects');
      const read = objects.get(id) as IDBRequest<LocalObject | undefined>;
      read.onsuccess = () => {
        try {
          const current = read.result;
          if (!current) throw new Error(`объект ${id} не найден на устройстве`);
          const next = apply(current);
          objects.put(next.object);
          tx.objectStore('outbox').add({ op: next.op } satisfies QueuedOp);
          done(next.object);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    }).catch((error: unknown) => {
      throw failure ?? error;
    });
  }

  /**
   * Ответ сервера на операцию: одной транзакцией посмотреть, ждут ли отправки более
   * поздние правки того же объекта, обновить объект, записать «проблему» и убрать
   * операцию из очереди. `decide` получает объект и решает, каким он станет.
   */
  settle(
    seq: number,
    op: Operation,
    problem: Problem | null,
    decide: (
      local: LocalObject | undefined,
      stillPending: boolean,
    ) => { object?: LocalObject; resync?: boolean },
  ): Promise<void> {
    let failure: unknown;
    return this.run<void>(['objects', 'outbox', 'problems', 'meta'], (tx) => {
      const objects = tx.objectStore('objects');
      const outbox = tx.objectStore('outbox');
      const later = outbox.getAll(IDBKeyRange.lowerBound(seq, true)) as IDBRequest<
        Required<QueuedOp>[]
      >;
      later.onsuccess = () => {
        const stillPending = later.result.some((entry) => entry.op.object_id === op.object_id);
        const read = objects.get(op.object_id) as IDBRequest<LocalObject | undefined>;
        read.onsuccess = () => {
          try {
            const next = decide(read.result, stillPending);
            if (next.object) objects.put(next.object);
            if (next.resync) tx.objectStore('meta').put(true, 'resync');
            if (problem) tx.objectStore('problems').put(problem);
            outbox.delete(seq);
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
      };
    }).catch((error: unknown) => {
      throw failure ?? error;
    });
  }

  /** Снимок с сервера: прочитать объект и решить, что записать, — одной транзакцией. */
  merge(
    snapshot: ObjectSnapshot,
    decide: (local: LocalObject | undefined) => LocalObject | null,
  ): Promise<void> {
    let failure: unknown;
    return this.run<void>(['objects'], (tx) => {
      const objects = tx.objectStore('objects');
      const read = objects.get(snapshot.id) as IDBRequest<LocalObject | undefined>;
      read.onsuccess = () => {
        try {
          const next = decide(read.result);
          if (next) objects.put(next);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    }).catch((error: unknown) => {
      throw failure ?? error;
    });
  }

  /** Записать объект и операцию одной транзакцией: либо оба, либо ничего. */
  async commitLocal(object: LocalObject, op: Operation): Promise<void> {
    const tx = this.db.transaction(['objects', 'outbox'], 'readwrite');
    tx.objectStore('objects').put(object);
    tx.objectStore('outbox').add({ op } satisfies QueuedOp);
    await done(tx);
  }

  async object(id: string): Promise<LocalObject | undefined> {
    const tx = this.db.transaction('objects');
    return promisify(tx.objectStore('objects').get(id) as IDBRequest<LocalObject | undefined>);
  }

  async objects(): Promise<LocalObject[]> {
    const tx = this.db.transaction('objects');
    return promisify(tx.objectStore('objects').getAll() as IDBRequest<LocalObject[]>);
  }

  async outbox(limit: number): Promise<Required<QueuedOp>[]> {
    const tx = this.db.transaction('outbox');
    return promisify(
      tx.objectStore('outbox').getAll(null, limit) as IDBRequest<Required<QueuedOp>[]>,
    );
  }

  async outboxSize(): Promise<number> {
    const tx = this.db.transaction('outbox');
    return promisify(tx.objectStore('outbox').count());
  }

  async problems(): Promise<Problem[]> {
    const tx = this.db.transaction('problems');
    return promisify(tx.objectStore('problems').getAll() as IDBRequest<Problem[]>);
  }

  async dismissProblem(opId: string): Promise<void> {
    const tx = this.db.transaction('problems', 'readwrite');
    tx.objectStore('problems').delete(opId);
    await done(tx);
  }

  async meta<T>(key: string): Promise<T | undefined> {
    const tx = this.db.transaction('meta');
    return promisify(tx.objectStore('meta').get(key) as IDBRequest<T | undefined>);
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(value, key);
    await done(tx);
  }

  async deleteMeta(key: string): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').delete(key);
    await done(tx);
  }
}
