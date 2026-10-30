import type { Provider, ProviderAwareness, UserState } from '@lexical/yjs';
import type { Doc } from 'yjs';
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

/** Сеть и запись принадлежат DocHandle; Lexical получает уже открытый Y.Doc. */
export class DocsProvider {
  readonly awareness: ProviderAwareness;
  ready = false;
  private readyListeners = new Set<() => void>();
  private generation = 0;
  private handlers = new Map<string, Set<(value: never) => void>>();

  constructor(doc: Doc) {
    this.awareness = new LocalAwareness(doc.clientID);
  }

  connect() {
    const generation = ++this.generation;
    queueMicrotask(() => {
      if (this.generation !== generation) return;
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
