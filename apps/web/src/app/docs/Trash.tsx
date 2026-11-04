import {
  DOCS_PAGE,
  httpDocsTransport,
  type DocsVersionsTransport,
  type DocTrashItem,
  type LocalObject,
} from '@qubite/sync-client';
import { Button, Note, Presence, Swap, useLeaving } from '@qubite/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { plainPreview } from './preview';

interface Props {
  objects: readonly LocalObject[];
  loaded: boolean;
  online: boolean;
  version: number;
  onRestore: (id: string) => Promise<void>;
  transport?: Pick<DocsVersionsTransport, 'listTrash'>;
}

interface TrashRow {
  id: string;
  title: string;
  preview: string;
  deleted: number;
}

/** Локальная очередь важнее сетевого ответа, ещё не увидевшего delete/restore. */
function mergeTrash(objects: readonly LocalObject[], remote: readonly DocTrashItem[]): TrashRow[] {
  const local = new Map(objects.filter((object) => object.object_type === DOCS_PAGE).map((object) => [object.id, object]));
  const rows = new Map<string, TrashRow>();
  for (const doc of remote) {
    const object = local.get(doc.id);
    if (object && (object.pending || object.revision > doc.revision || (object.revision === doc.revision && !object.deleted))) continue;
    rows.set(doc.id, {
      id: doc.id,
      title: doc.title,
      preview: doc.preview,
      deleted: Date.parse(doc.deleted_at ?? doc.updated_at),
    });
  }
  for (const object of local.values()) {
    if (!object.deleted || rows.has(object.id)) continue;
    rows.set(object.id, {
      id: object.id,
      title: object.title,
      preview: typeof object.fields?.preview === 'string' ? object.fields.preview : '',
      deleted: object.updated_at_ms,
    });
  }
  return [...rows.values()].sort((a, b) => b.deleted - a.deleted || a.id.localeCompare(b.id));
}

export function Trash({ objects, loaded, online, version, onRestore, transport: supplied }: Props) {
  const transport = useMemo(() => supplied ?? httpDocsTransport(), [supplied]);
  const [remote, setRemote] = useState<DocTrashItem[]>([]);
  const [loading, setLoading] = useState(online);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const performing = useRef(false);

  useEffect(() => {
    let alive = true;
    // Отложено, как загрузка соседней панели истории; старые ответы игнорируем.
    void Promise.resolve().then(async () => {
      if (!alive) return;
      setLoading(online);
      setFailed(false);
      if (!online) return;
      try {
        const docs = await transport.listTrash();
        if (alive) setRemote(docs);
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    });
    return () => { alive = false; };
  }, [online, version, retry, transport]);

  const rows = mergeTrash(objects, remote);
  const [drawn, gone] = useLeaving(rows, (doc) => doc.id);
  const state = drawn.length ? 'rows' : !loaded || loading ? 'loading' : failed ? 'error' : 'empty';

  async function restore(id: string) {
    if (performing.current) return;
    performing.current = true;
    setBusy(id);
    setError(null);
    try {
      await onRestore(id);
      setRemote((current) => current.filter((doc) => doc.id !== id));
    } catch {
      setError('Не удалось вернуть документ на устройстве. Если он ещё не загружен, подключитесь к сети и повторите.');
    } finally {
      performing.current = false;
      setBusy(null);
    }
  }

  return (
    <section className="docs-trash" aria-label="Корзина документов">
      <p className="lead">Документы остаются в корзине, пока вы их не вернёте</p>
      {!online && <Note>Без сети. Изменения сохраняются на устройстве и отправятся при связи.</Note>}
      {failed && <Note>Не удалось загрузить корзину с сервера. Показаны документы с этого устройства.
        <Button size="sm" onClick={() => setRetry((value) => value + 1)}>Повторить загрузку корзины</Button>
      </Note>}
      <Presence show={!!error}><Note tone="bad">{error}</Note></Presence>
      <Swap view={state} order={['loading', 'error', 'empty', 'rows']}>
        {state === 'loading' ? <p className="later" role="status">Открываю корзину…</p>
          : state === 'empty' ? <p className="docs-empty" role="status">Корзина пуста</p>
          : <ul className="docs-trash-rows">
            {drawn.map(({ item: doc, leaving }) => (
              <li key={doc.id} aria-hidden={leaving || undefined}>
                <Presence className="docs-trash-row" show={!leaving} onLayout={() => { if (leaving) gone(doc.id); }}>
                <div className="docs-trash-copy">
                  <span className="docs-row-title">{doc.title}</span>
                  <span className="docs-row-preview">{plainPreview(doc.preview) || 'Пустой документ'}</span>
                  <time dateTime={new Date(doc.deleted).toISOString()}>Удалён {new Date(doc.deleted).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })}</time>
                </div>
                <Button size="sm" disabled={busy !== null || leaving} aria-label={`Вернуть «${doc.title}»`} onClick={() => void restore(doc.id)}>{busy === doc.id ? 'Возвращаю…' : 'Вернуть'}</Button>
                </Presence>
              </li>
            ))}
          </ul>}
      </Swap>
      {loading && rows.length > 0 && <p className="later" role="status">Обновляю корзину…</p>}
    </section>
  );
}
