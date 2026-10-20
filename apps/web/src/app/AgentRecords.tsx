/**
 * «Записи» агента (AGT-001, D-320…D-325): папка, которую агент ведёт сам, — «Кто я», «О тебе»,
 * «Память», «Проекты», «Навыки» и свои файлы («Расписание.md»). Читать, править руками (это твоя
 * поправка — видна в ленте), скачать `.md`; внизу файла — «Поправить»: пишешь словами, что не
 * так, агент исправляет сразу. Сверху — «Агент хочет знать».
 */
import { Button, Field } from '@qubite/ui';
import { useState, type FormEvent } from 'react';
import { Fail, say } from '../auth/client';
import {
  useAnswer,
  useChat,
  useEditFile,
  useFile,
  useFiles,
  useFixFile,
  useQuestions,
} from './agent-records';
import {
  fileName,
  kindLabel,
  tree,
  usage,
  type AgentFile,
  type AgentQuestion,
} from './agent-records-view';

export function AgentRecords() {
  const files = useFiles();
  const [open, setOpen] = useState<string | null>(null);
  const list = files.data?.files ?? [];
  const shown =
    open && list.some((f) => f.id === open)
      ? open
      : (list.find((f) => f.kind === 'memory')?.id ?? null);

  if (files.isPending) return <p className="later">Загружаю записи…</p>;
  if (files.isError) {
    const denied = files.error instanceof Fail && files.error.status === 403;
    return (
      <p className="later" role="status">
        {denied
          ? 'Агент выключен: нет доступа к модулю «Агент Qubite». Его включает owner в Console.'
          : say(files.error)}
      </p>
    );
  }
  return (
    <div className="rec">
      <Questions />
      <div className="rec-body">
        <nav className="rec-tree" aria-label="Файлы агента">
          {tree(list).map((folder) => (
            <div key={folder.name || '/'} className="rec-folder">
              {folder.name && <p className="rec-folder-name">{folder.name}</p>}
              <ul>
                {folder.files.map((f) => {
                  const u = usage(f);
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        className={f.id === shown ? 'on' : undefined}
                        aria-current={f.id === shown ? 'true' : undefined}
                        onClick={() => setOpen(f.id)}
                      >
                        <span>{fileName(f.path)}</span>
                        {u.full && <i className="rec-full" title="почти полон" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        {shown && <FileView id={shown} />}
      </div>
    </div>
  );
}

function FileView({ id }: { id: string }) {
  const file = useFile(id);
  if (file.isPending) return <p className="later">Открываю…</p>;
  if (file.isError) return <p className="later">{say(file.error)}</p>;
  // Новый ключ — новое состояние правки, когда файл сменился на сервере; «Поправить» живёт
  // дольше: ответ агента приходит уже после новой версии файла.
  return (
    <div className="rec-view panel">
      <FileBody key={`${file.data.id}:${file.data.revision}`} file={file.data} />
      <FixField key={file.data.id} file={file.data} />
    </div>
  );
}

function FileBody({ file }: { file: AgentFile }) {
  const edit = useEditFile();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(file.body);
  const [error, setError] = useState<string | null>(null);
  const u = usage(file);
  const core = file.kind === 'core';

  function save(e: FormEvent) {
    e.preventDefault();
    if (text === file.body) {
      setEditing(false);
      return;
    }
    setError(null);
    edit.mutate(
      { id: file.id, body: text, revision: file.revision },
      {
        onSuccess: () => setEditing(false),
        onError: (er) =>
          setError(
            er instanceof Fail && er.status === 409
              ? 'Файл только что изменился (агент или другая вкладка). Отмени и открой заново.'
              : say(er),
          ),
      },
    );
  }

  return (
    <article className="rec-file" aria-label={fileName(file.path)}>
      <header className="rec-head">
        <div>
          <h2>{fileName(file.path)}</h2>
          <p>
            {kindLabel(file.kind)} ·{' '}
            <span className={u.full ? 'rec-warn' : undefined}>{u.label}</span>
          </p>
        </div>
        <div className="act-btns">
          {!editing && (
            <Button size="sm" dot={false} onClick={() => setEditing(true)}>
              Править
            </Button>
          )}
          <a className="rec-download" href={`/api/v1/agent/files/${file.id}/download`} download>
            Скачать .md
          </a>
        </div>
      </header>
      {core && file.core && (
        <details className="rec-core">
          <summary>Основа — её пишем мы, агент её не меняет</summary>
          <pre className="rec-text">{file.core}</pre>
        </details>
      )}
      {core && <h3 className="rec-sub">Твои правила</h3>}
      {editing ? (
        <form onSubmit={save} className="rec-edit">
          <label className="rec-label" htmlFor={`rec-${file.id}`}>
            Текст файла (Markdown)
          </label>
          <textarea
            id={`rec-${file.id}`}
            value={text}
            rows={Math.min(24, Math.max(8, text.split('\n').length + 2))}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="rec-hint">
            {text.length.toLocaleString('ru-RU')} из {file.limit.toLocaleString('ru-RU')} знаков.
            Пароли и коды сервер вычеркнет.
          </p>
          {error && (
            <p className="act-error" role="alert">
              {error}
            </p>
          )}
          <div className="act-btns">
            <Button size="sm" variant="fill" type="submit" disabled={edit.isPending}>
              Сохранить
            </Button>
            <Button
              size="sm"
              dot={false}
              type="button"
              onClick={() => {
                setText(file.body);
                setError(null);
                setEditing(false);
              }}
            >
              Отмена
            </Button>
          </div>
        </form>
      ) : file.body.trim() ? (
        <pre className="rec-text">{file.body}</pre>
      ) : (
        <p className="later">
          {core ? 'Пока пусто — скажи агенту, как с тобой работать.' : 'Пока пусто.'}
        </p>
      )}
    </article>
  );
}

/** «Поправить»: «это не так, на самом деле…» — агент исправляет сразу, без «да». */
function FixField({ file }: { file: AgentFile }) {
  const fix = useFixFile();
  const chat = useChat();
  const [text, setText] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messages = chat.data?.messages ?? [];
  const mine = sent ? messages.find((m) => m.id === sent) : undefined;
  const answer = sent ? messages.find((m) => m.reply_to === sent) : undefined;
  const thinking = !!sent && (!mine || mine.status === 'pending');

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setError(null);
    fix.mutate(
      { id: file.id, text: t },
      {
        onSuccess: (m) => {
          setSent(m.id);
          setText('');
        },
        onError: (er) => setError(say(er)),
      },
    );
  }

  return (
    <form className="rec-fix" onSubmit={submit} aria-label="Поправить">
      <Field
        label="Поправить"
        placeholder="Что не так? Например: «на самом деле русский по вт и чт»"
        value={text}
        onChange={(e) => setText(e.target.value)}
        hint="Агент исправит сразу — правка будет видна в «Ленте», её можно откатить."
      />
      <Button
        size="sm"
        variant="fill"
        type="submit"
        disabled={fix.isPending || thinking || !text.trim()}
      >
        Поправить
      </Button>
      {thinking && (
        <p className="rec-status" role="status">
          Агент исправляет…
        </p>
      )}
      {answer && (
        <p className="rec-status" role="status">
          <b>Агент:</b> {answer.text}
        </p>
      )}
      {error && (
        <p className="act-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** «Агент хочет знать»: ответить кнопкой или словами, или «Не сейчас». */
function Questions() {
  const questions = useQuestions();
  const list = questions.data?.questions ?? [];
  if (list.length === 0) return null;
  return (
    <section className="rec-ask panel" aria-label="Агент хочет знать">
      <h2>Агент хочет знать</h2>
      <ul>
        {list.map((q) => (
          <QuestionRow key={q.id} q={q} />
        ))}
      </ul>
    </section>
  );
}

function QuestionRow({ q }: { q: AgentQuestion }) {
  const answer = useAnswer();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = (value: string) => {
    setError(null);
    answer.mutate({ id: q.id, answer: value }, { onError: (er) => setError(say(er)) });
  };
  return (
    <li>
      <p className="rec-q">{q.text}</p>
      {q.why && <p className="act-why">зачем: {q.why}</p>}
      <form
        className="rec-q-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send(text.trim());
        }}
      >
        {q.options.map((o) => (
          <Button
            key={o}
            size="sm"
            dot={false}
            type="button"
            disabled={answer.isPending}
            onClick={() => send(o)}
          >
            {o}
          </Button>
        ))}
        <Field
          label="Ответ"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ответить словами"
        />
        <Button size="sm" variant="fill" type="submit" disabled={answer.isPending || !text.trim()}>
          Ответить
        </Button>
        <Button
          size="sm"
          dot={false}
          type="button"
          disabled={answer.isPending}
          onClick={() => send('')}
        >
          Не сейчас
        </Button>
      </form>
      {error && (
        <p className="act-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
