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

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
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

  async putObject(object: LocalObject): Promise<void> {
    const tx = this.db.transaction('objects', 'readwrite');
    tx.objectStore('objects').put(object);
    await done(tx);
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

  async removeFromOutbox(seqs: number[]): Promise<void> {
    const tx = this.db.transaction('outbox', 'readwrite');
    for (const seq of seqs) tx.objectStore('outbox').delete(seq);
    await done(tx);
  }

  async addProblem(problem: Problem): Promise<void> {
    const tx = this.db.transaction('problems', 'readwrite');
    tx.objectStore('problems').put(problem);
    await done(tx);
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
}
