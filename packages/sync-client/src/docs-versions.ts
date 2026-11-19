import * as Y from 'yjs';

/** Поля API DOC-004a; бинарное состояние декодируется на границе транспорта. */
export interface DocVersionItem {
  id: string;
  created_at: string;
  kind: string;
  name?: string | null;
  preview: string;
  size: number;
  title: string;
}

export interface DocVersion extends DocVersionItem {
  text: string;
  ystate: Uint8Array;
}

export interface DocTrashItem {
  id: string;
  title: string;
  preview: string;
  project_ids: string[];
  revision: number;
  updated_at: string;
  deleted_at?: string | null;
}

export interface DocsVersionsTransport {
  listVersions(docId: string, before?: string): Promise<DocVersionItem[]>;
  getVersion(docId: string, vid: string): Promise<DocVersion>;
  createVersion(docId: string, name: string): Promise<DocVersion>;
  renameVersion(docId: string, vid: string, name: string): Promise<DocVersion>;
  deleteVersion(docId: string, vid: string): Promise<void>;
  listTrash(): Promise<DocTrashItem[]>;
}

export interface DocRestore {
  reason: 'restore';
  restore_of: string;
}

type WireVersion = Omit<DocVersion, 'ystate'> & { ystate: string };

/** Использует тот же HTTP-вызов, авторизацию и обработку ошибок, что и /y. */
export function docsVersionsTransport(
  call: <T>(path: string, init: RequestInit) => Promise<T>,
): DocsVersionsTransport {
  const path = (id: string) => `/api/v1/docs/${encodeURIComponent(id)}/versions`;
  const versionPath = (id: string, vid: string) => `${path(id)}/${encodeURIComponent(vid)}`;
  const decode = (version: WireVersion): DocVersion => ({
    ...version,
    ystate: Uint8Array.from(atob(version.ystate), (char) => char.charCodeAt(0)),
  });
  const named = (method: string, name: string): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return {
    async listVersions(id, before) {
      const query = new URLSearchParams({ limit: '50' });
      if (before !== undefined) query.set('before', before);
      const response = await call<{ versions: DocVersionItem[] }>(`${path(id)}?${query}`, {
        method: 'GET',
      });
      return response.versions;
    },
    async getVersion(id, vid) {
      return decode(await call<WireVersion>(versionPath(id, vid), { method: 'GET' }));
    },
    async createVersion(id, name) {
      return decode(await call<WireVersion>(path(id), named('POST', name)));
    },
    async renameVersion(id, vid, name) {
      return decode(await call<WireVersion>(versionPath(id, vid), named('PATCH', name)));
    },
    async deleteVersion(id, vid) {
      await call<void>(versionPath(id, vid), { method: 'DELETE' });
    },
    async listTrash() {
      const response = await call<{ docs: DocTrashItem[] }>('/api/v1/docs?deleted=true', {
        method: 'GET',
      });
      return response.docs;
    },
  };
}

/** XmlText.clone() не переносит атрибуты элемента Lexical. Копируем их явно. */
interface DeltaPart {
  insert?: unknown;
  attributes?: Record<string, unknown>;
}

function cloneValue(value: unknown): unknown {
  if (value instanceof Y.XmlText) {
    const copy = new Y.XmlText();
    for (const [key, attribute] of Object.entries(value.getAttributes())) {
      copy.setAttribute(key, cloneValue(attribute));
    }
    const delta = value
      .toDelta()
      .map((part: DeltaPart) => ({ ...part, insert: cloneValue(part.insert) }));
    copy.applyDelta(delta);
    return copy;
  }
  if (value instanceof Y.XmlElement) {
    const copy = new Y.XmlElement(value.nodeName);
    for (const [key, attribute] of Object.entries(value.getAttributes())) {
      copy.setAttribute(key, structuredClone(attribute));
    }
    copy.insert(
      0,
      value.toArray().map((child) => cloneValue(child) as Y.XmlElement | Y.XmlText),
    );
    return copy;
  }
  // Подписи узлов mind map — обычный Y.Text (XmlText проверен выше).
  if (value instanceof Y.Text) {
    const copy = new Y.Text();
    copy.applyDelta(value.toDelta());
    return copy;
  }
  // Маркеры TextNode — Y.Map, их форматирование тоже должно сохраниться.
  if (value instanceof Y.Map) {
    const copy = new Y.Map<unknown>();
    value.forEach((entry: unknown, key: string) => copy.set(key, cloneValue(entry)));
    return copy;
  }
  return structuredClone(value);
}

/** Новые Item в текущем дереве: история и параллельные обновления Yjs остаются живы. */
export function restoreDocVersion(
  doc: Y.Doc,
  version: Pick<DocVersion, 'ystate'>,
  origin: unknown,
): void {
  const source = new Y.Doc();
  try {
    Y.applyUpdate(source, version.ystate);
    const previous = source.get('root', Y.XmlText);
    const content = previous.toDelta().map((part: DeltaPart) => ({
      ...part,
      insert: cloneValue(part.insert),
    }));
    const attributes = previous.getAttributes();
    const root = doc.get('root', Y.XmlText);
    // Mind map (DOC-006, D-1001): вид и узлы — рядом с деревом редактора, восстанавливаются целиком.
    const meta = source.getMap<unknown>('meta');
    const nodes = source.getMap<unknown>('mindmap');
    const currentMeta = doc.getMap<unknown>('meta');
    const currentNodes = doc.getMap<unknown>('mindmap');
    doc.transact(() => {
      for (const key of [...currentMeta.keys()]) if (!meta.has(key)) currentMeta.delete(key);
      meta.forEach((value, key) => {
        if (currentMeta.get(key) !== value) currentMeta.set(key, cloneValue(value));
      });
      for (const key of [...currentNodes.keys()]) currentNodes.delete(key);
      nodes.forEach((value, key) => currentNodes.set(key, cloneValue(value)));
      root.delete(0, root.length);
      for (const key of Object.keys(root.getAttributes())) {
        if (!(key in attributes)) root.removeAttribute(key);
      }
      for (const [key, value] of Object.entries(attributes)) {
        root.setAttribute(key, cloneValue(value));
      }
      root.applyDelta(content);
    }, origin);
  } finally {
    source.destroy();
  }
}
