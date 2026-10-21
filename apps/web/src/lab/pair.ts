/**
 * Две копии одного документа — «два устройства» лаборатории редактора (DOC-001).
 * Каждая копия — свой Y.Doc. В сети правка одной сразу уходит в другую; без сети
 * копии расходятся, а `merge()` обменивает только недостающие правки (по векторам
 * состояния), как будет при синхронизации через сервер. Сервер не нужен.
 */
import * as Y from 'yjs';

/** Метка «правка пришла из другой копии» — её не пересылаем обратно. */
export const FROM_PAIR = Symbol('pair');

export class Pair {
  readonly docs: [Y.Doc, Y.Doc] = [new Y.Doc(), new Y.Doc()];
  private online = true;
  private listeners = new Set<() => void>();

  constructor() {
    this.docs.forEach((doc, i) => {
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin !== FROM_PAIR && this.online) {
          Y.applyUpdate(this.docs[1 - i]!, update, FROM_PAIR);
        }
        this.emit();
      });
    });
  }

  get isOnline() {
    return this.online;
  }

  /** Включить или выключить «сеть». Сеть вернулась — копии сразу сливаются. */
  setOnline(on: boolean) {
    this.online = on;
    if (on) this.merge();
    this.emit();
  }

  /** Слить две копии: каждая получает то, чего у неё нет. Повтор ничего не меняет. */
  merge() {
    const [a, b] = this.docs;
    const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
    const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
    Y.applyUpdate(b, toB, FROM_PAIR);
    Y.applyUpdate(a, toA, FROM_PAIR);
  }

  /** Копии знают одни и те же правки. */
  same() {
    const [a, b] = this.docs;
    const va = Y.decodeStateVector(Y.encodeStateVector(a));
    const vb = Y.decodeStateVector(Y.encodeStateVector(b));
    if (va.size !== vb.size) return false;
    for (const [client, clock] of va) if (vb.get(client) !== clock) return false;
    return true;
  }

  /** Сколько байт весит вся история копии (что уйдёт на сервер целиком). */
  size(i: 0 | 1) {
    return Y.encodeStateAsUpdate(this.docs[i]).byteLength;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  destroy() {
    this.listeners.clear();
    this.docs.forEach((d) => d.destroy());
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }
}
