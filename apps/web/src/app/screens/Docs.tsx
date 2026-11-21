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
  EmptyState,
  IconButton,
  Menu,
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
import * as Y from 'yjs';
import { downloadMarkdown, fileNameFor, readMarkdownFile } from '../docs/markdown-file';
import { downloadBlob, drawMindmap, readPalette, toPng, toSvg } from '../docs/mindmap/export';
import { probeAdvance } from '../docs/mindmap/measure';
import { extractDocLinks, markdownToYUpdate, renderDocText } from '../docs/render';
import { DocEditor } from '../docs/Editor';
import { MindMap } from '../docs/mindmap/MindMap';
import { isMindmap, mindmapUpdate, readTree } from '../docs/mindmap/model';
import { collocationsTemplate, COLLOCATIONS_TITLE } from '../docs/mindmap/text';
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

/** Какие документы — mind map (D-1003): значок в списке и холст на всю ширину без ожидания. */
function readMaps(key: string): ReadonlySet<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
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

const MAX_IMPORT_BYTES = 480 * 1024;
// Столько разных упоминаний принимает отправка документа (docs.ts).
const MAX_IMPORT_LINKS = 200;
// Предел текста документа на сервере (D-474).
const MAX_IMPORT_CHARACTERS = 200_000;

function inspectUpdate(update: Uint8Array): { links: number; characters: number } {
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, update);
    // Текст для сервера — Markdown из дерева, он может оказаться длиннее файла.
    return {
      links: extractDocLinks(probe).length,
      characters: Array.from(renderDocText(probe)).length,
    };
  } finally {
    probe.destroy();
  }
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
  const fileInput = useRef<HTMLInputElement>(null);
  const importingNow = useRef(false);
  const [freshImports, setFreshImports] = useState<ReadonlySet<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const previewKey = `qubite.docs.previews.${rememberedAccount() ?? 'unknown'}`;
  const [previews, setPreviews] = useState<Previews>(() => readPreviews(previewKey));
  const mapsKey = `qubite.docs.maps.${rememberedAccount() ?? 'unknown'}`;
  const [maps, setMaps] = useState<ReadonlySet<string>>(() => readMaps(mapsKey));
  const onKind = useCallback(
    (docId: string, map: boolean) =>
      setMaps((current) => {
        if (current.has(docId) === map) return current;
        const next = new Set(current);
        if (map) next.add(docId);
        else next.delete(docId);
        try {
          localStorage.setItem(mapsKey, JSON.stringify([...next]));
        } catch {
          /* Вид всё равно хранится в самом документе. */
        }
        return next;
      }),
    [mapsKey],
  );
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
          // Импортированный в этом сеансе: снимок с сервера создан до текста, превью ещё пустое.
          // Непустое серверное превью побеждает; набор живёт до перезагрузки страницы.
          (!doc.preview && freshImports.has(doc.id)) ||
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

  /** Новая карта создаётся без сети, как импорт .md: объект, затем её Yjs (D-1003). */
  async function createMindmap(template: boolean) {
    setCreating(true);
    setError(null);
    try {
      const client = await sync.ready();
      const store = sync.docs;
      if (!store) throw new Error('store');
      const sample = collocationsTemplate();
      const update = template ? mindmapUpdate(sample.root, sample.branches) : mindmapUpdate('');
      const doc = await createDoc(client, template ? COLLOCATIONS_TITLE : 'Новая mind map');
      const handle = await store.open(doc.id);
      let text = '';
      try {
        Y.applyUpdate(handle.doc, update);
        await handle.markSeeded();
        text = handle.text();
      } finally {
        await handle.close();
      }
      onKind(doc.id, true);
      onText(doc.id, text);
      setObjects(await client.all());
      void client
        .sync()
        .then(() => store.syncAll())
        .catch(() => {});
      await navigate({ to: '/docs/$id', params: { id: doc.id } });
    } catch {
      setError('Не удалось создать mind map на устройстве. Попробуйте ещё раз.');
    } finally {
      setCreating(false);
    }
  }

  async function importFiles(files: File[]) {
    if (!files.length || importingNow.current) return;
    setImportErrors([]);
    setImportResult(null);
    if (files.length > 20) {
      setImportErrors(['Выберите не больше 20 файлов за раз.']);
      return;
    }
    importingNow.current = true;
    setImporting(true);
    const imported: string[] = [];
    try {
      const client = await sync.ready();
      const store = sync.docs;
      if (!store) throw new Error('Хранилище документов ещё открывается. Попробуйте ещё раз.');
      for (const file of files) {
        try {
          const { title, text } = await readMarkdownFile(file);
          // Разбор до создания: ошибка формата не оставит пустой документ.
          const update = markdownToYUpdate(text);
          // Сервер не примет обновление Yjs больше 512 КиБ (D-751); лимит клиента — с запасом.
          const { links, characters } = inspectUpdate(update);
          if (links > MAX_IMPORT_LINKS)
            throw new Error('В документе больше 200 разных ссылок. Разделите файл.');
          if (characters > MAX_IMPORT_CHARACTERS)
            throw new Error('После разбора в документе больше 200 000 знаков. Разделите файл.');
          if (update.byteLength > MAX_IMPORT_BYTES)
            throw new Error('Документ слишком большой для синхронизации. Разделите файл.');
          const doc = await createDoc(client, title);
          const handle = await store.open(doc.id);
          try {
            Y.applyUpdate(handle.doc, update);
            // Без этого закрытый документ не отправит текст: сервер ждёт seed (D-753).
            await handle.markSeeded();
          } finally {
            await handle.close();
          }
          imported.push(doc.id);
          setFreshImports((current) => new Set(current).add(doc.id));
          onText(doc.id, text);
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : 'Не удалось загрузить файл.';
          setImportErrors((current) => [...current, `${file.name}: ${reason}`]);
        }
      }
      setObjects(await client.all());
      setQuery('');
      if (files.length === 1 && imported[0]) {
        await navigate({ to: '/docs/$id', params: { id: imported[0] } });
      } else {
        setImportResult(`Загружено ${imported.length} из ${files.length}`);
        await navigate({ to: '/docs' });
      }
      // Текст закрытых документов отправится обычным фоновым обменом.
      void client
        .sync()
        .then(() => store.syncAll())
        .catch(() => {});
    } catch (cause) {
      setImportErrors([
        cause instanceof Error ? cause.message : 'Не удалось открыть хранилище на устройстве.',
      ]);
    } finally {
      importingNow.current = false;
      setImporting(false);
    }
  }

  const cantImport = importing || creating || !sync.client || !sync.docs;
  const pickFiles = () => fileInput.current?.click();

  return (
    <div
      className={`docs-workspace${id ? ' docs-open' : ''}${id && maps.has(id) ? ' docs-mindmap' : ''}`}
    >
      <aside
        ref={index}
        className="docs-index"
        aria-label="Список документов"
        data-swipe-tabs=""
      >
        <Segmented<'docs' | 'trash'>
          swipeTabs
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
        <input
          ref={fileInput}
          hidden
          type="file"
          aria-label="Импорт Markdown"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          multiple
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
            void importFiles(files);
          }}
        />
        {importResult && <Note>{importResult}</Note>}
        {importErrors.map((message, index) => (
          <Note key={index} tone="bad">
            {message}
          </Note>
        ))}
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
                {/* Одна главная «+»; редкое (импорт) — в меню «Ещё» (DS-013, D-910). */}
                <IconButton
                  icon="plus"
                  label="Новый документ"
                  variant="fill"
                  onClick={() => void create()}
                  disabled={creating || importing || !sync.client}
                />
                <Menu
                  label="Ещё"
                  items={[
                    {
                      label: 'Mind map',
                      icon: 'mindmap',
                      onPick: () => void createMindmap(false),
                      disabled: creating || importing || !sync.client,
                    },
                    {
                      label: 'Mind map: collocations',
                      icon: 'mindmap',
                      onPick: () => void createMindmap(true),
                      disabled: creating || importing || !sync.client,
                    },
                    {
                      label: 'Импорт .md',
                      icon: 'upload',
                      onPick: pickFiles,
                      disabled: cantImport,
                    },
                  ]}
                />
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
                    <span className="docs-row-title">
                      {maps.has(doc.id) && (
                        <span className="docs-row-kind" title="Mind map">
                          <DotIcon name="mindmap" size={16} />
                        </span>
                      )}
                      {doc.title}
                    </span>
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
                <EmptyState
                  className="docs-empty"
                  kind="neit"
                  title="Здесь будут ваши заметки и документы."
                  hint="Нейт помнит всё, что сюда попадёт, — и без сети тоже."
                >
                  <Button
                    variant="fill"
                    disabled={creating || importing}
                    onClick={() => void create()}
                  >
                    Создать первый документ
                  </Button>
                  <Button variant="quiet" disabled={cantImport} onClick={pickFiles}>
                    Импорт .md
                  </Button>
                </EmptyState>
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
            onKind={onKind}
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
  onKind,
  onDelete,
}: {
  id: string;
  item: DocListItem | null;
  onText: (id: string, text: string) => void;
  onKind: (id: string, map: boolean) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const sync = useSync();
  const navigate = useNavigate();
  const [handle, setHandle] = useState<DocHandle | null>(null);
  const [status, setStatus] = useState<DocStatus>('pending');
  const [openFailure, setFailure] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [fallback, setFallback] = useState<DocListItem | null>(null);
  const [generation, setGeneration] = useState(0);
  const [titleError, setTitleError] = useState(false);
  const [backlinksHidden, setBacklinksHidden] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const deletingNow = useRef(false);
  const touchY = useRef(0);
  const editorBox = useRef<HTMLDivElement>(null);
  const titleQueue = useRef(Promise.resolve());
  const title = item?.title ?? fallback?.title;
  // «Сервер такого не знает» — только пока документа нет и на устройстве: только что созданный
  // документ сервер узнаёт чуть позже, чем он появляется в списке, и ошибкой это не является.
  const failure =
    openFailure ??
    (missing && !item ? 'Документ недоступен. Проверьте сеть или вернитесь к списку.' : null);
  const hasTitle = !!title;
  const titleValue = useRef('');
  // Вид документа живёт в его Yjs (D-1001): может прийти с другого устройства после открытия.
  const [map, setMap] = useState(false);
  useEffect(() => {
    if (!handle) return;
    const check = () => setMap(isMindmap(handle.doc));
    check();
    handle.doc.on('update', check);
    return () => handle.doc.off('update', check);
  }, [handle]);
  useEffect(() => {
    if (handle) onKind(id, map);
  }, [handle, id, map, onKind]);

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
        if (abort.signal.aborted) return;
        setFallback(fromServer(doc));
        setMissing(false);
      })
      .catch(() => {
        if (!abort.signal.aborted) setMissing(true);
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

  function download(kind: 'md' | 'png' | 'svg') {
    if (!handle) return;
    setDownloadError(null);
    const name = titleValue.current || title || 'Документ';
    if (kind === 'md') {
      downloadMarkdown(name, handle.text());
      return;
    }
    const drawing = drawMindmap(
      readTree(handle.doc),
      handle.links,
      readPalette(),
      probeAdvance(document.body),
    );
    const file = fileNameFor(name).replace(/\.md$/, `.${kind}`);
    if (kind === 'svg')
      downloadBlob(new Blob([toSvg(drawing)], { type: 'image/svg+xml;charset=utf-8' }), file);
    else
      void toPng(drawing)
        .then((blob) => downloadBlob(blob, file))
        .catch((error: unknown) =>
          setDownloadError(error instanceof Error ? error.message : 'Картинка не собралась.'),
        );
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
        {/* У документа три кнопки-значка: история, скачать, «Ещё» с удалением (DS-013, D-910). */}
        <Button
          size="sm"
          variant="quiet"
          className="docs-back"
          onClick={() => void navigate({ to: '/docs' })}
        >
          <DotIcon name="back" /> К документам
        </Button>
        <span className="docs-break" aria-hidden="true" />
        <span className="docs-page-tools">
          <IconButton
            icon="history"
            label="История"
            variant="frame"
            aria-expanded={historyOpen}
            onClick={() => {
              setRestored(false);
              setHistoryOpen(true);
            }}
          />
          {map ? (
            // У карты три формата: список .md, картинка PNG и рисунок SVG (D-1007).
            <Menu
              label="Скачать"
              icon="download"
              disabled={!handle}
              items={[
                { label: 'Список .md', icon: 'list', onPick: () => download('md') },
                { label: 'Картинка PNG', icon: 'download', onPick: () => download('png') },
                { label: 'Рисунок SVG', icon: 'download', onPick: () => download('svg') },
              ]}
            />
          ) : (
            <IconButton
              icon="download"
              label="Скачать .md"
              variant="frame"
              disabled={!handle}
              onClick={() => {
                if (handle)
                  downloadMarkdown(titleValue.current || title || 'Документ', handle.text());
              }}
            />
          )}
          <Menu
            label="Ещё"
            items={[
              {
                label: 'Удалить',
                icon: 'trash',
                tone: 'bad',
                disabled: !title || deleting,
                onPick: () => {
                  setDeleteError(null);
                  setConfirmDelete(true);
                },
              },
            ]}
          />
        </span>
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
            <Button variant="quiet" disabled={deleting} onClick={() => setConfirmDelete(false)}>
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
      <Presence show={!!downloadError}>
        <Note tone="bad">{downloadError}</Note>
      </Presence>
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
        {handle && map ? (
          <>
            <MindMap key={handle.doc.guid} handle={handle} title={title ?? ''} />
            {/* «Ссылаются сюда» и у карты (D-1000): под холстом, как под текстом документа. */}
            <DocumentBacklinks id={id} hidden={false} />
          </>
        ) : handle ? (
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
