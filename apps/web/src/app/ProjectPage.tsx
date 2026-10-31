/**
 * Проект как папка (PROJ-001, D-470…D-479): заголовок проекта и вкладки «Задачи», «События»,
 * «Файлы» (файлы и документы), «Память» (что агент знает о проекте) и «Лента».
 * Дела и сам проект — синхронизацией (без сети тоже), файлы и документы — запросами к серверу.
 */
import { PROJECT_COLORS, type PlannerProject, type ProjectColor } from '@qubite/sync-client';
import { Button, DotIcon, Field, Note, Presence, Segmented, Sheet, Swap } from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { api } from '../api';
import { Fail, must, say } from '../auth/client';
import { AgentTimeline } from './AgentTimeline';
import { SecHead } from './parts';
import { usePlanner } from './planner-context';
import { iso } from './planner-view';
import { ProjectBoardSettings, ProjectTasks } from './ProjectTasks';
import {
  PROJECT,
  useCreateDoc,
  useDocs,
  useLinkDoc,
  useMemoryWrite,
  useProjectPage,
  useRemoveFile,
  useUnlinkDoc,
  useUploadFile,
} from './project';
import {
  MAX_FILE_BYTES,
  PROJECT_TABS,
  buildAgenda,
  countsLabel,
  feedLine,
  feedWhen,
  fileUrl,
  sizeLabel,
  type ProjectFeedItem,
  type ProjectPage as Page,
  type ProjectTab,
} from './project-view';
import './project.css';

const COLOR_NAME: Record<ProjectColor, string> = {
  orange: 'Оранжевый',
  sky: 'Голубой',
  yellow: 'Жёлтый',
  green: 'Зелёный',
  peach: 'Персиковый',
};

export function ProjectPage({ id }: { id: string }) {
  const planner = usePlanner();
  const page = useProjectPage(id);
  const qc = useQueryClient();
  const [tab, setTab] = useState<ProjectTab>('tasks');
  const [editing, setEditing] = useState(false);
  const [projectMenu, setProjectMenu] = useState(false);
  const [boardSettings, setBoardSettings] = useState(false);
  /** каждое открытие окна — форма заново со свежими значениями проекта */
  const [opened, setOpened] = useState(0);

  // дело поменялось (здесь, в Planner или на другом устройстве) — лента и счётчики свежие
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: [...PROJECT, id] });
  }, [planner.data, qc, id]);

  const local = planner.data.projects.find((p) => p.id === id);
  const tasks = useMemo(
    () => planner.data.tasks.filter((t) => t.project_id === id),
    [planner.data.tasks, id],
  );

  if (page.isError) {
    const missing = page.error instanceof Fail && page.error.status === 404;
    return (
      <div className="pp">
        <Back />
        <p className="later" role="status">
          {missing ? 'Такого проекта нет — возможно, его удалили.' : say(page.error)}
        </p>
      </div>
    );
  }
  if (!page.data) {
    return (
      <div className="pp">
        <Back />
        <p className="later">Открываю проект…</p>
      </div>
    );
  }
  const data = page.data;
  const head = {
    title: local?.title ?? data.project.title,
    color: (local?.color ?? data.project.color) as ProjectColor,
    tag: local?.tag ?? data.project.tag,
    notes: local ? local.notes : data.project.notes,
    status: local?.status ?? data.project.status,
  };
  const shownTasks = local || tasks.length ? tasks.length : data.tasks.length;

  return (
    <div className="pp" data-project={id}>
      <Back />
      <section className="pp-head panel" aria-label={`Проект ${head.title}`}>
        <div className="pp-head-top">
          <span className="q-dot pp-dot" style={{ background: `var(--q-${head.color})` }} />
          <div className="pp-head-t">
            <h2>{head.title}</h2>
            <p className="pp-tag">
              #{head.tag}
              {head.status === 'archived' && ' · в архиве'}
            </p>
          </div>
          {local && (
            <Button
              size="sm"
              dot={false}
              aria-label="Меню проекта"
              aria-expanded={projectMenu}
              onClick={() => setProjectMenu(!projectMenu)}
            >
              <DotIcon name="more" size={16} />
            </Button>
          )}
        </div>
        <Presence show={projectMenu}>
          <div className="pp-project-actions" aria-label="Действия проекта">
            <Button
              size="sm"
              dot={false}
              onClick={() => {
                setOpened((value) => value + 1);
                setProjectMenu(false);
                setEditing(true);
              }}
            >
              Править
            </Button>
            <Button
              size="sm"
              dot={false}
              onClick={() => {
                setOpened((value) => value + 1);
                setProjectMenu(false);
                setBoardSettings(true);
              }}
            >
              Настроить колонки
            </Button>
          </div>
        </Presence>
        {head.notes ? (
          <p className="pp-notes">{head.notes}</p>
        ) : (
          <p className="pp-notes pp-empty">Описания нет — «Править», чтобы добавить.</p>
        )}
        <p className="pp-counts">
          {countsLabel(shownTasks, data.files.length, data.docs ? data.docs.length : null)}
        </p>
      </section>

      <Segmented<ProjectTab>
        label="Разделы проекта"
        value={tab}
        onChange={(t) => setTab(t)}
        options={[
          { value: 'tasks', label: 'Задачи' },
          { value: 'events', label: 'События' },
          { value: 'files', label: 'Файлы' },
          { value: 'memory', label: 'Память' },
          { value: 'feed', label: 'Лента' },
        ]}
      />
      <Swap view={tab} order={PROJECT_TABS}>
        {tab === 'tasks' ? (
          <ProjectTasks id={id} />
        ) : tab === 'events' ? (
          <EventsTab id={id} page={data} />
        ) : tab === 'files' ? (
          <FilesTab id={id} page={data} />
        ) : tab === 'memory' ? (
          <MemoryTab id={id} page={data} />
        ) : (
          <FeedTab id={id} page={data} />
        )}
      </Swap>

      {local && (
        <>
          <Sheet open={editing} onClose={() => setEditing(false)} title="Проект">
            <EditProject key={opened} project={local} onClose={() => setEditing(false)} />
          </Sheet>
          <Sheet
            open={boardSettings}
            onClose={() => setBoardSettings(false)}
            title="Колонки проекта"
          >
            <ProjectBoardSettings
              key={opened}
              project={local}
              onClose={() => setBoardSettings(false)}
            />
          </Sheet>
        </>
      )}
    </div>
  );
}

function Back() {
  const navigate = useNavigate();
  return (
    <div className="pp-back">
      <Button size="sm" dot={false} onClick={() => void navigate({ to: '/planner' })}>
        ← Все проекты
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- заголовок

function EditProject({ project, onClose }: { project: PlannerProject; onClose: () => void }) {
  const planner = usePlanner();
  const [title, setTitle] = useState(project.title);
  const [notes, setNotes] = useState(project.notes);
  const [color, setColor] = useState<ProjectColor>(project.color);
  const [status, setStatus] = useState(project.status);

  function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    void planner.editProject(project.id, { title, notes, color, status });
    onClose();
  }

  return (
    <form className="pp-form" onSubmit={save} aria-label="Править проект">
      <Field label="Название" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="rec-label" htmlFor="pp-notes">
        Описание
      </label>
      <textarea
        id="pp-notes"
        className="pp-area"
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <Segmented<ProjectColor>
        label="Цвет"
        value={color}
        onChange={(c) => setColor(c)}
        options={PROJECT_COLORS.map((c) => ({ value: c, label: COLOR_NAME[c] }))}
      />
      <Segmented<'active' | 'archived'>
        label="Статус"
        value={status}
        onChange={(s) => setStatus(s)}
        options={[
          { value: 'active', label: 'Идёт' },
          { value: 'archived', label: 'В архиве' },
        ]}
      />
      <div className="act-btns">
        <Button size="sm" variant="fill" type="submit" disabled={!title.trim()}>
          Сохранить
        </Button>
        <Button size="sm" dot={false} type="button" onClick={onClose}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- события

function EventsTab({ id, page }: { id: string; page: Page }) {
  const planner = usePlanner();
  const tasks = planner.data.tasks.filter((t) => t.project_id === id);
  const days = buildAgenda(tasks, page.events, iso(new Date()));
  return (
    <div className="pp-tab">
      {days.length === 0 && (
        <p className="later">
          У дел проекта пока нет сроков — поставь срок, и дело появится здесь.
        </p>
      )}
      {days.map((d) => (
        <section className="pp-day" key={d.date} aria-label={d.label}>
          <h3 className={d.date === 'overdue' ? 'pp-day-h late' : 'pp-day-h'}>{d.label}</h3>
          <ul>
            {d.items.map((i) => (
              <li key={i.id} className={i.done ? 'done' : undefined}>
                <span className="pp-time">{i.time ?? 'весь день'}</span>
                <span
                  className="q-dot"
                  style={{ background: `var(--q-${i.kind === 'event' ? 'sky' : 'orange'})` }}
                />
                <span className="pp-what">{i.title}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="later pp-soon">
        События календаря (встречи, уроки) появятся здесь вместе с разделом «Календарь».
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- файлы и документы

function FilesTab({ id, page }: { id: string; page: Page }) {
  const upload = useUploadFile(id);
  const remove = useRemoveFile(id);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  async function send(list: FileList | null) {
    setError(null);
    for (const file of Array.from(list ?? [])) {
      if (file.size > MAX_FILE_BYTES) {
        setError(`«${file.name}» больше 25 МБ — такой не положить.`);
        continue;
      }
      try {
        await upload.mutateAsync(file);
      } catch (e) {
        setError(say(e));
      }
    }
    if (input.current) input.current.value = '';
  }

  function drop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    void send(e.dataTransfer.files);
  }

  return (
    <div className="pp-tab">
      <SecHead text="ФАЙЛЫ" label="Файлы">
        <span className="sec-h-end">
          <span className="n">{page.files.length}</span>
          <Button size="sm" onClick={() => input.current?.click()} disabled={upload.isPending}>
            + Файл
          </Button>
        </span>
      </SecHead>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Выбрать файлы"
        onChange={(e) => void send(e.target.files)}
      />
      <div
        className={over ? 'pp-drop over' : 'pp-drop'}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        {page.files.length === 0 ? (
          <p className="later">
            {upload.isPending ? 'Кладу файл…' : 'Файлов нет — «+ Файл» или перетащи сюда.'}
          </p>
        ) : (
          <ul className="pp-files" aria-label="Файлы проекта">
            {page.files.map((f) => (
              <li key={f.name} className="pp-file">
                <a className="pp-file-name" href={fileUrl(id, f.name)} download={f.name}>
                  {f.name}
                </a>
                <span className="pp-file-meta">
                  {sizeLabel(f.size)} · {feedWhen(f.created_at)}
                </span>
                <Button
                  size="sm"
                  dot={false}
                  aria-label={`Убрать файл ${f.name}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(f.name)}
                >
                  Убрать
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <Note tone="bad">{error}</Note>}

      <Docs id={id} page={page} />

      <p className="later pp-soon">
        Скоро: редактор кода, структура файлов и git проекта — отдельной задачей.
      </p>
    </div>
  );
}

function Docs({ id, page }: { id: string; page: Page }) {
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState(false);
  const navigate = useNavigate();
  const unlink = useUnlinkDoc(id);
  if (page.docs === null || page.docs === undefined) {
    return (
      <>
        <SecHead text="ДОКУМЕНТЫ" label="Документы" />
        <p className="later">Документы закрыты: нет доступа к модулю Docs. Его включает owner.</p>
      </>
    );
  }
  return (
    <>
      <SecHead text="ДОКУМЕНТЫ" label="Документы">
        <span className="sec-h-end">
          <span className="n">{page.docs.length}</span>
          <Button size="sm" onClick={() => setCreating(true)}>
            + Документ
          </Button>
        </span>
      </SecHead>
      {page.docs.length === 0 ? (
        <p className="later">Документов нет — создай или привяжи уже написанный.</p>
      ) : (
        <ul className="pp-docs" aria-label="Документы проекта">
          {page.docs.map((d) => (
            <li key={d.id}>
              <Button
                dot={false}
                className="pp-doc"
                onClick={() => void navigate({ to: '/docs/$id', params: { id: d.id } })}
              >
                <span className="pp-doc-t">{d.title}</span>
                <span className="pp-doc-pre">{d.preview || 'пусто'}</span>
              </Button>
              <Button
                size="sm"
                dot={false}
                disabled={unlink.isPending}
                onClick={() => unlink.mutate(d.id)}
              >
                Убрать из проекта
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="act-btns">
        <Button size="sm" dot={false} onClick={() => setLinking(true)}>
          Привязать документ
        </Button>
      </div>
      <NewDoc id={id} open={creating} onClose={() => setCreating(false)} />
      <LinkDoc id={id} page={page} open={linking} onClose={() => setLinking(false)} />
      {unlink.isError && <Note tone="bad">{say(unlink.error)}</Note>}
    </>
  );
}

function NewDoc({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const create = useCreateDoc(id);
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      const doc = await create.mutateAsync({ title: title.trim(), body: '' });
      setTitle('');
      onClose();
      await navigate({ to: '/docs/$id', params: { id: doc.id } });
    } catch {
      // ошибка видна ниже
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Новый документ">
      <form className="pp-form" onSubmit={save} aria-label="Новый документ">
        <Field label="Название" value={title} onChange={(e) => setTitle(e.target.value)} />
        {create.isError && <Note tone="bad">{say(create.error)}</Note>}
        <div className="act-btns">
          <Button
            size="sm"
            variant="fill"
            type="submit"
            disabled={!title.trim() || create.isPending}
          >
            Создать
          </Button>
          <Button size="sm" dot={false} type="button" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function LinkDoc({
  id,
  page,
  open,
  onClose,
}: {
  id: string;
  page: Page;
  open: boolean;
  onClose: () => void;
}) {
  const docs = useDocs(open);
  const link = useLinkDoc(id);
  const here = new Set((page.docs ?? []).map((d) => d.id));
  const other = (docs.data?.docs ?? []).filter((d) => !here.has(d.id));
  return (
    <Sheet open={open} onClose={onClose} title="Привязать документ">
      {docs.isPending ? (
        <p className="later">Ищу документы…</p>
      ) : docs.isError ? (
        <Note tone="bad">{say(docs.error)}</Note>
      ) : other.length === 0 ? (
        <p className="later">Других документов нет — все уже в этом проекте.</p>
      ) : (
        <ul className="pp-docs" aria-label="Мои документы">
          {other.map((d) => (
            <li key={d.id} className="pp-link-row">
              <span className="pp-doc-t">{d.title}</span>
              <Button
                size="sm"
                dot={false}
                disabled={link.isPending}
                aria-label={`Привязать ${d.title}`}
                onClick={() => link.mutate(d.id, { onSuccess: onClose })}
              >
                Привязать
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- память агента

function MemoryTab({ id, page }: { id: string; page: Page }) {
  const navigate = useNavigate();
  const write = useMemoryWrite(id);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const memory = page.memory;

  if (!page.agent) {
    return (
      <div className="pp-tab">
        <p className="later">
          Агент выключен: нет доступа к модулю «Агент Qubite». Его включает owner в Console.
        </p>
      </div>
    );
  }

  if (!memory) {
    return (
      <div className="pp-tab">
        <p className="later">
          Агент пока ничего не записал о проекте. Расскажи ему в «Агент» → «Разговор» — или заведи
          файл проекта сам.
        </p>
        <div className="act-btns">
          <Button
            size="sm"
            disabled={write.isPending}
            onClick={() => write.mutate({ path: page.memory_path, body: '' })}
          >
            Завести файл проекта
          </Button>
        </div>
        {write.isError && <Note tone="bad">{say(write.error)}</Note>}
      </div>
    );
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!memory) return;
    try {
      await write.mutateAsync({ file: memory.file_id, body: text, revision: memory.revision });
      setEditing(false);
    } catch {
      // ошибка видна ниже
    }
  }

  return (
    <div className="pp-tab">
      <section className="panel pp-memory" aria-label="Память агента о проекте">
        <div className="rec-head">
          <div>
            <h2>{memory.path}</h2>
            <p>
              {memory.chars.toLocaleString('ru-RU')} из {memory.limit.toLocaleString('ru-RU')}{' '}
              знаков · агент читает это в каждом разговоре о проекте
            </p>
          </div>
          {!editing && (
            <div className="act-btns">
              <Button
                size="sm"
                dot={false}
                onClick={() => {
                  setText(memory.body);
                  setEditing(true);
                }}
              >
                Править
              </Button>
            </div>
          )}
        </div>
        <Presence show={editing}>
          <form className="rec-edit" onSubmit={save} aria-label="Править память проекта">
            <label className="rec-label" htmlFor="pp-memory">
              Текст файла (Markdown)
            </label>
            <textarea
              id="pp-memory"
              rows={Math.min(20, Math.max(6, text.split('\n').length + 2))}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="rec-hint">
              {text.length.toLocaleString('ru-RU')} из {memory.limit.toLocaleString('ru-RU')}{' '}
              знаков. Правка видна в ленте агента и откатывается.
            </p>
            {write.isError && <Note tone="bad">{say(write.error)}</Note>}
            <div className="act-btns">
              <Button size="sm" variant="fill" type="submit" disabled={write.isPending}>
                Сохранить
              </Button>
              <Button size="sm" dot={false} type="button" onClick={() => setEditing(false)}>
                Отмена
              </Button>
            </div>
          </form>
        </Presence>
        {!editing && <pre className="rec-text">{memory.body || 'Файл пуст.'}</pre>}
      </section>
      <div className="act-btns">
        <Button size="sm" dot={false} onClick={() => void navigate({ to: '/agent' })}>
          Вся папка агента →
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- лента

function FeedTab({ id, page }: { id: string; page: Page }) {
  const [more, setMore] = useState<ProjectFeedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [end, setEnd] = useState(page.feed.length < 50);
  const items = [...page.feed, ...more.filter((m) => !page.feed.some((f) => f.seq === m.seq))];

  async function load() {
    const last = items.at(-1);
    if (!last || busy) return;
    setBusy(true);
    try {
      const next = await must(
        api.GET('/api/v1/projects/{id}/feed', {
          params: { path: { id }, query: { before: last.seq } },
        }),
      );
      setMore((m) => [...m, ...next.items]);
      if (next.items.length < 50) setEnd(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pp-tab">
      {page.agent && (
        <>
          <SecHead text="АГЕНТ" label="Что сделал агент" />
          <AgentTimeline trail={{ project: id }} compact />
        </>
      )}
      <SecHead text="ИЗМЕНЕНИЯ" label="Изменения в проекте" />
      {items.length === 0 ? (
        <p className="later">Пока ничего не происходило.</p>
      ) : (
        <ul className="pp-feed" aria-label="Изменения в проекте">
          {items.map((i) => (
            <li key={i.seq}>
              <span className="pp-time">{feedWhen(i.at)}</span>
              <span className="pp-what">{feedLine(i)}</span>
            </li>
          ))}
        </ul>
      )}
      {!end && (
        <div className="act-btns">
          <Button size="sm" dot={false} disabled={busy} onClick={() => void load()}>
            Показать ещё
          </Button>
        </div>
      )}
    </div>
  );
}
