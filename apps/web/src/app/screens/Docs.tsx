import {
  createDoc,
  DOCS_PAGE,
  docList,
  renameDoc,
  type DocHandle,
  type DocListItem,
  type DocStatus,
  type LocalObject,
} from '@qubite/sync-client';
import {
  Button,
  DotIcon,
  Field,
  Note,
  Presence,
  Segmented,
  Sheet,
  Swap,
  useSlide,
} from '@qubite/ui';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DocEditor } from '../docs/Editor';
import { History } from '../docs/History';
import { Trash } from '../docs/Trash';
import { DocumentBacklinks } from '../docs/Backlinks';
import { acquireDocument } from '../docs/handles';
import { plainPreview } from '../docs/preview';
import { rememberedAccount, useSync } from '../sync-context';
import '../docs/docs.css';

interface SearchDoc {
  id: string;
  title: string;
  preview: string;
  updated_at: string;
}
interface Preview {
  preview: string;
  updated: number;
}
type Previews = Record<string, Preview>;

function readPreviews(key: string): Previews {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([, item]: [string, unknown]) => {
        if (!item || typeof item !== 'object') return false;
        const preview = item as Partial<Preview>;
        return (
          typeof preview.preview === 'string' &&
          typeof preview.updated === 'number' &&
          Number.isFinite(preview.updated)
        );
      }),
    ) as Previews;
  } catch {
    return {};
  }
}

function fromServer(doc: SearchDoc): DocListItem {
  return {
    id: doc.id,
    title: doc.title,
    preview: doc.preview,
    updated: Date.parse(doc.updated_at),
  };
}

export function DocsScreen() {
  const sync = useSync();
  const navigate = useNavigate();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const id = path.startsWith('/docs/') ? decodeURIComponent(path.slice('/docs/'.length)) : null;
  const [query, setQuery] = useState('');
  const [objects, setObjects] = useState<LocalObject[]>([]);
  const [section, setSection] = useState<'docs' | 'trash'>('docs');
  const [deleted, setDeleted] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const restoringNow = useRef(false);
  const focusTarget = useRef<string | null>(null);
  const index = useRef<HTMLElement>(null);
  // Ответ поиска помнит, к какому запросу относится: старый просто не показывается.
  const [search, setSearch] = useState<{
    key: string;
    docs: DocListItem[] | null;
    error: boolean;
  } | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const previewKey = `qubite.docs.previews.${rememberedAccount() ?? 'unknown'}`;
  const [previews, setPreviews] = useState<Previews>(() => readPreviews(previewKey));
  const slide = useSlide(88);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const change = () => setOnline(navigator.onLine);
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    return () => {
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!sync.client) return;
    void sync.client
      .all()
      .then((objects) => {
        if (alive) {
          setObjects(objects);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive) {
          setError('Не удалось открыть список на устройстве.');
          setLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [sync.client, sync.version]);

  const searchKey = `${query.trim()}|${online}|${sync.version}`;
  const found = search?.key === searchKey ? search : null;
  const remote = found?.docs ?? null;
  const searchError = found?.error ?? false;

  useEffect(() => {
    if (section !== 'docs' || !query.trim() || !online) return;
    const key = `${query.trim()}|${online}|${sync.version}`;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/v1/docs?q=${encodeURIComponent(query.trim())}`, {
        credentials: 'include',
        signal: abort.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('search');
          const body = (await response.json()) as { docs: SearchDoc[] };
          if (!abort.signal.aborted)
            setSearch({ key, docs: body.docs.map(fromServer), error: false });
        })
        .catch(() => {
          if (!abort.signal.aborted) setSearch({ key, docs: null, error: true });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, online, sync.version, section]);

  const onText = useCallback(
    (docId: string, text: string) => {
      // Чистим до склейки строк: знаки Markdown видны только в начале строки.
      const update = { preview: plainPreview(text).slice(0, 160), updated: Date.now() };
      setPreviews((current) => {
        const next = { ...current, [docId]: update };
        try {
          localStorage.setItem(previewKey, JSON.stringify(next));
        } catch {
          /* Текст хранит DocStore. */
        }
        return next;
      });
    },
    [previewKey],
  );

  // Превью приходит Markdown-ом (сервер и редактор): в списке и поиске — чистый текст.
  const local = docList(objects);
  const deletedIds = new Set(objects.filter((object) => object.deleted).map((object) => object.id));
  const all = local
    .map((doc) => {
      const preview = previews[doc.id];
      const fresh =
        preview &&
        (preview.updated > doc.updated ||
          objects.some((object) => object.id === doc.id && object.pending))
          ? { ...doc, preview: preview.preview }
          : doc;
      return { ...fresh, preview: plainPreview(fresh.preview) };
    })
    .sort((a, b) => b.updated - a.updated);
  const q = query.trim().toLocaleLowerCase('ru');
  const matches = all.filter((doc) =>
    `${doc.title} ${doc.preview}`.toLocaleLowerCase('ru').includes(q),
  );
  // В сетевой результат добавляем ещё не отправленные документы и локальные правки.
  const rows = remote
    ? [
        ...new Map(
          [
            ...remote
              .filter((doc) => !deletedIds.has(doc.id))
              .map((doc) => ({ ...doc, preview: plainPreview(doc.preview) })),
            ...matches,
          ].map((doc) => [doc.id, doc]),
        ).values(),
      ]
    : matches;

  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (row) slide.to(row.offsetTop, row.offsetHeight);
    else slide.hide();
  }, [id, rows.length, query, section, slide.to, slide.hide]);

  useEffect(() => {
    if (id || section !== 'docs' || !focusTarget.current) return;
    const target =
      focusTarget.current === 'undo'
        ? index.current?.querySelector<HTMLElement>('[data-docs-undo]')
        : [...(index.current?.querySelectorAll<HTMLElement>('[data-doc-id]') ?? [])].find(
            (row) => row.dataset.docId === focusTarget.current,
          );
    if (target) {
      target.focus({ preventScroll: true });
      focusTarget.current = null;
    }
  });

  async function remove(docId: string) {
    const client = await sync.ready();
    if (!(await client.get(docId))) await client.sync();
    await client.remove(docId);
    setObjects(await client.all());
    setQuery('');
    setSection('docs');
    setDeleted(docId);
    focusTarget.current = 'undo';
    await navigate({ to: '/docs' });
    void client.sync();
  }

  async function restore(docId: string) {
    const client = await sync.ready();
    // Сетевой список может опередить обычный pull. Только движок пишет в очередь.
    let object = await client.get(docId);
    if (!object || !object.deleted) {
      const state = await client.sync();
      object = await client.get(docId);
      if (state.status === 'error' && !object?.deleted) throw new Error('Нужна связь');
    }
    if (!object || object.object_type !== DOCS_PAGE) throw new Error('Документ ещё не загружен');
    if (object.deleted) await client.restore(docId);
    setObjects(await client.all());
    setQuery('');
    setSection('docs');
    if (deleted === docId) setDeleted(null);
    setError(null);
    focusTarget.current = docId;
    await navigate({ to: '/docs' });
    void client.sync();
  }

  async function undo() {
    if (!deleted || restoringNow.current) return;
    restoringNow.current = true;
    setRestoring(true);
    setError(null);
    try {
      await restore(deleted);
    } catch {
      setError('Не удалось вернуть документ на устройстве. Попробуйте ещё раз.');
    } finally {
      restoringNow.current = false;
      setRestoring(false);
    }
  }

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const client = await sync.ready();
      const doc = await createDoc(client, 'Новый документ');
      void client.sync();
      await navigate({ to: '/docs/$id', params: { id: doc.id } });
    } catch {
      setError('Не удалось создать документ на устройстве. Попробуйте ещё раз.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={`docs-workspace${id ? ' docs-open' : ''}`}>
      <aside ref={index} className="docs-index" aria-label="Список документов">
        <Segmented<'docs' | 'trash'>
          label="Раздел документов"
          value={section}
          options={[
            { value: 'docs', label: 'Документы' },
            { value: 'trash', label: 'Корзина' },
          ]}
          onChange={setSection}
        />
        <Presence show={deleted !== null} className="docs-undo">
          <Note>
            <span>Документ в корзине · </span>
            <Button data-docs-undo size="sm" disabled={restoring} onClick={() => void undo()}>
              Вернуть
            </Button>
          </Note>
        </Presence>
        {error && <Note tone="bad">{error}</Note>}
        <Swap view={section} order={['docs', 'trash']}>
          {section === 'trash' ? (
            <Trash
              objects={objects.map((object) => {
                const preview = previews[object.id];
                return preview &&
                  (preview.updated > object.updated_at_ms || (object.deleted && object.pending))
                  ? { ...object, fields: { ...object.fields, preview: preview.preview } }
                  : object;
              })}
              loaded={loaded}
              online={online}
              version={sync.version}
              onRestore={restore}
            />
          ) : (
            <>
              {/* Как во «Входящих» и Planner: под заголовком раздела сразу управление, без второго заголовка. */}
              <div className="docs-bar">
                <Field
                  className="docs-search"
                  label="Поиск документов"
                  placeholder="Поиск"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <Button size="sm" onClick={() => void create()} disabled={creating || !sync.client}>
                  + Документ
                </Button>
              </div>
              {searchError && (
                <Note>Поиск на сервере недоступен. Показаны документы с этого устройства.</Note>
              )}
              <div ref={list} className="docs-rows">
                {slide.node}
                {rows.map((doc) => (
                  <Button
                    key={doc.id}
                    data-doc-id={doc.id}
                    className="docs-row"
                    dot={false}
                    aria-current={id === doc.id ? 'page' : undefined}
                    onClick={() => void navigate({ to: '/docs/$id', params: { id: doc.id } })}
                  >
                    <span className="docs-row-title">{doc.title}</span>
                    <span className="docs-row-preview">{doc.preview || 'Пустой документ'}</span>
                    <time dateTime={new Date(doc.updated).toISOString()}>
                      {new Date(doc.updated).toLocaleDateString('ru', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </time>
                  </Button>
                ))}
              </div>
              {loaded && !all.length && !q && (
                <div className="docs-empty">
                  <p>Здесь будут ваши заметки и документы.</p>
                  <Button variant="fill" disabled={creating} onClick={() => void create()}>
                    Создать первый документ
                  </Button>
                </div>
              )}
              {loaded && !rows.length && q && <p className="later">Ничего не найдено.</p>}
              {!loaded && <p className="later">Открываю документы…</p>}
            </>
          )}
        </Swap>
      </aside>
      <Swap
        view={id ?? 'list'}
        order={['list', ...all.map((doc) => doc.id)]}
        className="docs-reading"
      >
        {id && deletedIds.has(id) ? (
          <div className="docs-page">
            <Note>Документ в корзине. Верните его, чтобы продолжить редактирование.</Note>
            <Button
              onClick={() => {
                setSection('trash');
                void navigate({ to: '/docs' });
              }}
            >
              К корзине
            </Button>
          </div>
        ) : id ? (
          <Document
            key={id}
            id={id}
            item={all.find((doc) => doc.id === id) ?? null}
            onText={onText}
            onDelete={remove}
          />
        ) : (
          <p className="docs-empty">Выберите документ или создайте новый.</p>
        )}
      </Swap>
    </div>
  );
}

const STATUS: Record<DocStatus, string> = {
  saved: 'Сохранено',
  pending: 'Сохранено на устройстве',
  offline: 'Без сети — сохранится позже',
  error: 'Ошибка — повторим',
};

function Document({
  id,
  item,
  onText,
  onDelete,
}: {
  id: string;
  item: DocListItem | null;
  onText: (id: string, text: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const sync = useSync();
  const navigate = useNavigate();
  const [handle, setHandle] = useState<DocHandle | null>(null);
  const [status, setStatus] = useState<DocStatus>('pending');
  const [failure, setFailure] = useState<string | null>(null);
  const [fallback, setFallback] = useState<DocListItem | null>(null);
  const [generation, setGeneration] = useState(0);
  const [titleError, setTitleError] = useState(false);
  const [backlinksHidden, setBacklinksHidden] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletingNow = useRef(false);
  const touchY = useRef(0);
  const editorBox = useRef<HTMLDivElement>(null);
  const titleQueue = useRef(Promise.resolve());
  const title = item?.title ?? fallback?.title;
  const hasTitle = !!title;
  const titleValue = useRef('');

  useEffect(() => {
    const box = editorBox.current;
    if (!box) return;
    // Не onInput: в Chromium Lexical сам вставляет текст (beforeinput отменён), и input нет.
    const typing = () => setBacklinksHidden(true);
    box.addEventListener('beforeinput', typing, true);
    return () => box.removeEventListener('beforeinput', typing, true);
  }, [handle]);

  useEffect(() => {
    if (item || !sync.client) return;
    const abort = new AbortController();
    void fetch(`/api/v1/docs/${encodeURIComponent(id)}`, {
      credentials: 'include',
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('missing');
        const doc = (await response.json()) as SearchDoc;
        if (!abort.signal.aborted) setFallback(fromServer(doc));
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setFailure('Документ недоступен. Проверьте сеть или вернитесь к списку.');
      });
    return () => abort.abort();
  }, [id, item, sync.client, generation]);

  useEffect(() => {
    if (!sync.docs || !hasTitle) return;
    let alive = true;
    const lease = acquireDocument(sync.docs, id);
    let stop = () => {};
    let reset = () => {};
    void lease.opening
      .then((doc) => {
        if (!alive) return;
        reset = doc.onReset(() => {
          lease.invalidate();
          setHandle(null);
          setGeneration((value) => value + 1);
        });
        stop = doc.onStatus((value) => {
          setStatus(value);
          if (value === 'pending' || value === 'saved') onText(id, doc.text());
        });
        setHandle(doc);
      })
      .catch(() => {
        if (alive) setFailure('Не удалось открыть документ на устройстве.');
      });
    return () => {
      alive = false;
      stop();
      reset();
      lease.release();
      // Следующий документ открывается с чистого листа.
      setHandle(null);
      setFailure(null);
    };
    // Название меняется отдельно от содержимого: не переоткрываем редактор при переименовании.
  }, [id, sync.docs, hasTitle, generation, onText]);

  const metadataStatus =
    status === 'error' || status === 'offline'
      ? status
      : sync.state.status === 'error'
        ? 'offline'
        : sync.state.pending > 0
          ? 'pending'
          : status;
  const displayed =
    titleError || sync.state.problems > 0
      ? 'error'
      : !navigator.onLine
        ? 'offline'
        : metadataStatus;

  function rename(value: string) {
    titleValue.current = value;
    if (!value.trim()) return;
    // Очерёдность сохраняет последнюю букву даже при быстрых изменениях заголовка.
    titleQueue.current = titleQueue.current
      .then(async () => {
        const client = await sync.ready();
        if (!(await client.get(id))) await client.sync();
        await renameDoc(client, id, value);
        setTitleError(false);
        void client.sync();
      })
      .catch(() => setTitleError(true));
  }

  async function remove() {
    if (deletingNow.current) return;
    deletingNow.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      // Не даём последнему переименованию обогнать удаление в очереди.
      await titleQueue.current;
      await onDelete(id);
    } catch {
      setDeleteError('Не удалось удалить документ на устройстве. Попробуйте ещё раз.');
    } finally {
      deletingNow.current = false;
      setDeleting(false);
    }
  }

  return (
    <article
      className="docs-page"
      aria-label="Документ"
      onWheelCapture={(event) => {
        if (event.deltaY > 0) setBacklinksHidden(false);
      }}
      onTouchStartCapture={(event) => {
        touchY.current = event.touches[0]?.clientY ?? 0;
      }}
      onTouchMoveCapture={(event) => {
        const y = event.touches[0]?.clientY ?? touchY.current;
        if (y < touchY.current) setBacklinksHidden(false);
        touchY.current = y;
      }}
    >
      <div className="docs-page-head">
        <Button size="sm" dot={false} onClick={() => void navigate({ to: '/docs' })}>
          <DotIcon name="back" /> К документам
        </Button>
        <Button
          size="sm"
          dot={false}
          aria-expanded={historyOpen}
          onClick={() => {
            setRestored(false);
            setHistoryOpen(true);
          }}
        >
          <DotIcon name="history" /> История
        </Button>
        <Button
          size="sm"
          dot={false}
          disabled={!title || deleting}
          onClick={() => {
            setDeleteError(null);
            setConfirmDelete(true);
          }}
        >
          <DotIcon name="trash" /> Удалить
        </Button>
        <span role="status" className="docs-save">
          {STATUS[displayed]}
        </span>
      </div>
      <Sheet
        open={confirmDelete}
        title="Удалить документ"
        onClose={() => {
          if (!deleting) setConfirmDelete(false);
        }}
        footer={
          <div className="docs-trash-actions">
            {/* Как в остальных окнах (история, календарь, проекты): главное действие первым. */}
            <Button variant="fill" disabled={deleting} onClick={() => void remove()}>
              {deleting ? 'Удаляю…' : 'Удалить'}
            </Button>
            <Button disabled={deleting} onClick={() => setConfirmDelete(false)}>
              Отмена
            </Button>
          </div>
        }
      >
        <p>Документ уйдёт в корзину. Его можно вернуть</p>
        <Presence show={!!deleteError}>
          <Note tone="bad">{deleteError}</Note>
        </Presence>
      </Sheet>
      {failure && <Note tone="bad">{failure}</Note>}
      {restored && <Note>Версия восстановлена. Прежний текст — в истории</Note>}
      <History
        id={id}
        open={historyOpen}
        handle={handle}
        store={sync.docs ?? null}
        onClose={() => setHistoryOpen(false)}
        onRestored={() => {
          setHistoryOpen(false);
          setRestored(true);
        }}
      >
        {title && (
          <Field
            key={id}
            className="docs-title"
            label="Название документа"
            defaultValue={title}
            maxLength={500}
            onChange={(event) => rename(event.target.value)}
            onBlur={(event) => {
              if (!event.target.value.trim()) event.target.value = title;
            }}
          />
        )}
        {handle ? (
          <>
            <div
              ref={editorBox}
              className="docs-editor"
              onFocusCapture={(event) => {
                if (event.target.closest('[contenteditable="true"]')) setBacklinksHidden(true);
              }}
              // Esc, не закрывший меню (оно останавливает событие), — «закончил писать».
              onKeyDown={(event) => {
                if (event.key === 'Escape') setBacklinksHidden(false);
              }}
              onBlurCapture={(event) => {
                if (event.target.closest('[contenteditable="true"]')) setBacklinksHidden(false);
              }}
            >
              <DocEditor handle={handle} />
            </div>
            <DocumentBacklinks id={id} hidden={backlinksHidden} />
          </>
        ) : (
          !failure && <p className="later">Открываю документ…</p>
        )}
      </History>
      {(failure || displayed === 'error' || displayed === 'offline') && (
        <Button
          size="sm"
          onClick={() => {
            if (titleError) rename(titleValue.current);
            if (failure) setGeneration((value) => value + 1);
            void sync.client?.sync().then(() => sync.docs?.syncAll());
          }}
        >
          Повторить
        </Button>
      )}
    </article>
  );
}
