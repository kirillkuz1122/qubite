import type { Provider, ProviderAwareness, UserState } from '@lexical/yjs';
import * as Y from 'yjs';
import { watchLostEdits, type LostBlock } from '@qubite/sync-client';
import type { DocHandle } from '@qubite/sync-client';

/** Императивный API хранилища, которое живёт вне React. */
export function attachMarkdownExport(handle: DocHandle, read: () => string): () => void {
  handle.text = read;
  return () => {
    const markdown = read();
    handle.text = () => markdown;
  };
}

/** Только локальное присутствие: без сети, таймеров и чужих курсоров. */
class LocalAwareness implements ProviderAwareness {
  private state: UserState | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly id: number) {}
  getLocalState = () => this.state;
  getStates = () => new Map(this.state ? [[this.id, this.state]] : []);
  on = (_type: 'update', callback: () => void) => {
    this.listeners.add(callback);
  };
  off = (_type: 'update', callback: () => void) => {
    this.listeners.delete(callback);
  };
  setLocalState = (state: UserState | null) => {
    this.state = state;
    this.listeners.forEach((callback) => callback());
  };
  setLocalStateField = (field: string, value: unknown) => {
    if (this.state) this.setLocalState({ ...this.state, [field]: value });
  };
}

const FROM_SOURCE = Symbol('из хранилища');
const FROM_EDITOR = Symbol('из редактора');

/**
 * Сеть и запись принадлежат DocHandle. Lexical рисует только изменения, пришедшие
 * после привязки, поэтому получает свою копию `doc`: при подключении в неё вливается
 * всё, что уже лежит на устройстве, дальше обе копии зеркалят друг друга.
 */
export class DocsProvider {
  readonly awareness: ProviderAwareness;
  readonly doc = new Y.Doc();
  ready = false;
  private readyListeners = new Set<() => void>();
  private generation = 0;
  private handlers = new Map<string, Set<(value: never) => void>>();
  private unbridge: (() => void) | null = null;

  constructor(private readonly source: Y.Doc) {
    this.awareness = new LocalAwareness(this.doc.clientID);
  }

  private bridge() {
    if (this.unbridge) return;
    const toEditor = (update: Uint8Array, origin: unknown) => {
      if (origin !== FROM_EDITOR) Y.applyUpdate(this.doc, update, FROM_SOURCE);
    };
    const toSource = (update: Uint8Array, origin: unknown) => {
      if (origin !== FROM_SOURCE) Y.applyUpdate(this.source, update, FROM_EDITOR);
    };
    Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(this.source), FROM_SOURCE);
    this.source.on('update', toEditor);
    this.doc.on('update', toSource);
    this.unbridge = () => {
      this.source.off('update', toEditor);
      this.doc.off('update', toSource);
      this.unbridge = null;
    };
  }

  connect() {
    const generation = ++this.generation;
    queueMicrotask(() => {
      if (this.generation !== generation) return;
      this.bridge();
      this.emit('status', { status: 'connected' });
      this.emit('sync', true);
      queueMicrotask(() => {
        if (this.generation !== generation) return;
        this.ready = true;
        this.readyListeners.forEach((callback) => callback());
      });
    });
  }

  disconnect() {
    this.generation++;
    this.ready = false;
    this.unbridge?.();
  }

  /** Дописанное в удалённый на другом устройстве блок (Q-87, D-757). */
  /** Свои правки, которые сервер уже принял: снимок при статусе «Сохранено». */
  private confirmed = new Map<number, number>();
  confirm() {
    this.confirmed = Y.decodeStateVector(Y.encodeStateVector(this.doc));
  }

  watchLost(callback: (lost: LostBlock[]) => void): () => void {
    return watchLostEdits(this.doc, FROM_SOURCE, callback, () => this.confirmed);
  }

  subscribeReady(callback: () => void): () => void {
    this.readyListeners.add(callback);
    if (this.ready) callback();
    return () => this.readyListeners.delete(callback);
  }

  on(type: string, callback: (value: never) => void) {
    let callbacks = this.handlers.get(type);
    if (!callbacks) this.handlers.set(type, (callbacks = new Set()));
    callbacks.add(callback);
  }

  off(type: string, callback: (value: never) => void) {
    this.handlers.get(type)?.delete(callback);
  }

  private emit(type: string, value: unknown) {
    this.handlers.get(type)?.forEach((callback) => callback(value as never));
  }

  asProvider(): Provider {
    return this as unknown as Provider;
  }
}
