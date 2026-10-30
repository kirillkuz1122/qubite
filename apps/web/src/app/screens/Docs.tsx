import {
  createDoc,
  docList,
  renameDoc,
  type DocHandle,
  type DocListItem,
  type DocStatus,
} from '@qubite/sync-client';
import { Button, DotIcon, Field, Note, Swap, useSlide } from '@qubite/ui';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DocEditor } from '../docs/Editor';
import { acquireDocument } from '../docs/handles';
import { SecHead } from '../parts';
import { rememberedAccount, useSync } from '../sync-context';
import '../docs/docs.css';

interface SearchDoc {
  id: string;
  title: string;
  preview: string;
  updated_at: string;
}
interface Preview { preview: string; updated: number }
type Previews = Record<string, Preview>;

function readPreviews(key: string): Previews {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, item]: [string, unknown]) => {
      if (!item || typeof item !== 'object') return false;
      const preview = item as Partial<Preview>;
      return typeof preview.preview === 'string' && typeof preview.updated === 'number' && Number.isFinite(preview.updated);
    })) as Previews;
  }
  catch { return {}; }
}

function fromServer(doc: SearchDoc): DocListItem {
  return { id: doc.id, title: doc.title, preview: doc.preview, updated: Date.parse(doc.updated_at) };
}

export function DocsScreen() {
  const sync = useSync();
  const navigate = useNavigate();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const id = path.startsWith('/docs/') ? decodeURIComponent(path.slice('/docs/'.length)) : null;
  const [query, setQuery] = useState('');
  const [local, setLocal] = useState<DocListItem[]>([]);
  const [remote, setRemote] = useState<DocListItem[] | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState(false);
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
    return () => { window.removeEventListener('online', change); window.removeEventListener('offline', change); };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!sync.client) return;
    void sync.client.all().then((objects) => {
      if (alive) { setLocal(docList(objects)); setLoaded(true); }
    }).catch(() => { if (alive) setError('Не удалось открыть список на устройстве.'); });
    return () => { alive = false; };
  }, [sync.client, sync.version]);

  useEffect(() => {
    setRemote(null);
    setSearchError(false);
    if (!query.trim() || !online) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/v1/docs?q=${encodeURIComponent(query.trim())}`, {
        credentials: 'include', signal: abort.signal,
      }).then(async (response) => {
        if (!response.ok) throw new Error('search');
        const body = await response.json() as { docs: SearchDoc[] };
        if (!abort.signal.aborted) setRemote(body.docs.map(fromServer));
      }).catch(() => { if (!abort.signal.aborted) setSearchError(true); });
    }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, online, sync.version]);

  const onText = useCallback((docId: string, text: string) => {
    const update = { preview: text.replace(/\s+/g, ' ').slice(0, 160), updated: Date.now() };
    setPreviews((current) => {
      const next = { ...current, [docId]: update };
      try { localStorage.setItem(previewKey, JSON.stringify(next)); } catch { /* Текст хранит DocStore. */ }
      return next;
    });
  }, [previewKey]);

  const all = local.map((doc) => {
    const preview = previews[doc.id];
    return preview && preview.updated > doc.updated ? { ...doc, ...preview } : doc;
  }).sort((a, b) => b.updated - a.updated);
  const q = query.trim().toLocaleLowerCase('ru');
  const matches = all.filter((doc) => `${doc.title} ${doc.preview}`.toLocaleLowerCase('ru').includes(q));
  // В сетевой результат добавляем ещё не отправленные документы и локальные правки.
  const rows = remote ? [...new Map([...remote, ...matches].map((doc) => [doc.id, doc])).values()] : matches;

  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (row) slide.to(row.offsetTop, row.offsetHeight);
    else slide.hide();
  }, [id, rows.length, query, slide.to, slide.hide]);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const client = await sync.ready();
      const doc = await createDoc(client, 'Новый документ');
      void client.sync();
      await navigate({ to: '/docs/$id', params: { id: doc.id } });
    } catch { setError('Не удалось создать документ на устройстве. Попробуйте ещё раз.'); }
    finally { setCreating(false); }
  }

  return (
    <div className={`docs-workspace${id ? ' docs-open' : ''}`}>
      <aside className="docs-index" aria-label="Список документов">
        <SecHead text="ДОКУМЕНТЫ" label="Мои документы">
          <Button size="sm" onClick={() => void create()} disabled={creating || !sync.client}>+ Документ</Button>
        </SecHead>
        <Field label="Поиск документов" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        {error && <Note tone="bad">{error}</Note>}
        {searchError && <Note>Поиск на сервере недоступен. Показаны документы с этого устройства.</Note>}
        <div ref={list} className="docs-rows">
          {slide.node}
          {rows.map((doc) => (
            <Button key={doc.id} className="docs-row" dot={false}
              aria-current={id === doc.id ? 'page' : undefined}
              onClick={() => void navigate({ to: '/docs/$id', params: { id: doc.id } })}>
              <span className="docs-row-title">{doc.title}</span>
              <span className="docs-row-preview">{doc.preview || 'Пустой документ'}</span>
              <time dateTime={new Date(doc.updated).toISOString()}>{new Date(doc.updated).toLocaleDateString('ru', { day: 'numeric', month: 'short' })}</time>
            </Button>
          ))}
        </div>
        {loaded && !all.length && !q && (
          <div className="docs-empty">
            <p>Здесь будут ваши заметки и документы.</p>
            <Button variant="fill" disabled={creating} onClick={() => void create()}>Создать первый документ</Button>
          </div>
        )}
        {loaded && !rows.length && q && <p className="later">Ничего не найдено.</p>}
        {!loaded && <p className="later">Открываю документы…</p>}
      </aside>
      <Swap view={id ?? 'list'} order={['list', ...all.map((doc) => doc.id)]} className="docs-reading">
        {id ? <Document key={id} id={id} item={all.find((doc) => doc.id === id) ?? null} onText={onText} />
          : <p className="docs-empty">Выберите документ или создайте новый.</p>}
      </Swap>
    </div>
  );
}

const STATUS: Record<DocStatus, string> = {
  saved: 'Сохранено', pending: 'Сохранено на устройстве',
  offline: 'Без сети — сохранится позже', error: 'Ошибка — повторим',
};

function Document({ id, item, onText }: {
  id: string; item: DocListItem | null; onText: (id: string, text: string) => void;
}) {
  const sync = useSync();
  const navigate = useNavigate();
  const [handle, setHandle] = useState<DocHandle | null>(null);
  const [status, setStatus] = useState<DocStatus>('pending');
  const [failure, setFailure] = useState<string | null>(null);
  const [fallback, setFallback] = useState<DocListItem | null>(null);
  const [generation, setGeneration] = useState(0);
  const [titleError, setTitleError] = useState(false);
  const titleQueue = useRef(Promise.resolve());
  const title = item?.title ?? fallback?.title;
  const hasTitle = !!title;
  const titleValue = useRef('');

  useEffect(() => {
    if (item || !sync.client) return;
    const abort = new AbortController();
    void fetch(`/api/v1/docs/${encodeURIComponent(id)}`, { credentials: 'include', signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('missing');
        const doc = await response.json() as SearchDoc;
        if (!abort.signal.aborted) setFallback(fromServer(doc));
      }).catch(() => { if (!abort.signal.aborted) setFailure('Документ недоступен. Проверьте сеть или вернитесь к списку.'); });
    return () => abort.abort();
  }, [id, item, sync.client, generation]);

  useEffect(() => {
    if (!sync.docs || !hasTitle) return;
    let alive = true;
    const lease = acquireDocument(sync.docs, id);
    let stop = () => {};
    let reset = () => {};
    setHandle(null);
    setFailure(null);
    void lease.opening.then((doc) => {
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
    }).catch(() => { if (alive) setFailure('Не удалось открыть документ на устройстве.'); });
    return () => {
      alive = false;
      stop(); reset();
      lease.release();
    };
    // Название меняется отдельно от содержимого: не переоткрываем редактор при переименовании.
  }, [id, sync.docs, hasTitle, generation, onText]);

  const metadataStatus = status === 'error' || status === 'offline' ? status
    : sync.state.status === 'error' ? 'offline'
    : sync.state.pending > 0 ? 'pending' : status;
  const displayed = titleError || sync.state.problems > 0 ? 'error'
    : !navigator.onLine ? 'offline' : metadataStatus;

  function rename(value: string) {
    titleValue.current = value;
    if (!value.trim()) return;
    // Очерёдность сохраняет последнюю букву даже при быстрых изменениях заголовка.
    titleQueue.current = titleQueue.current.then(async () => {
      const client = await sync.ready();
      if (!await client.get(id)) await client.sync();
      await renameDoc(client, id, value);
      setTitleError(false);
      void client.sync();
    }).catch(() => setTitleError(true));
  }

  return (
    <article className="docs-page" aria-label="Документ">
      <div className="docs-page-head">
        <Button size="sm" dot={false} onClick={() => void navigate({ to: '/docs' })}>
          <DotIcon name="back" /> К документам
        </Button>
        <span role="status" className="docs-save">{STATUS[displayed]}</span>
      </div>
      {failure && <Note tone="bad">{failure}</Note>}
      {title && <Field key={id} className="docs-title" label="Название документа" defaultValue={title}
        maxLength={500} onChange={(event) => rename(event.target.value)}
        onBlur={(event) => { if (!event.target.value.trim()) event.target.value = title; }} />}
      {handle ? <div className="docs-editor"><DocEditor handle={handle} /></div>
        : !failure && <p className="later">Открываю документ…</p>}
      {(failure || displayed === 'error' || displayed === 'offline') && <Button size="sm" onClick={() => {
        if (titleError) rename(titleValue.current);
        if (failure) setGeneration((value) => value + 1);
        void sync.client?.sync().then(() => sync.docs?.syncAll());
      }}>Повторить</Button>}
    </article>
  );
}
