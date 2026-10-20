/**
 * «Записи» агента (AGT-001, D-320…D-325): папка, которую агент ведёт сам, — «Кто я», «О тебе»,
 * «Память», «Проекты», «Навыки» и свои файлы («Расписание.md»). Читать, править руками (это твоя
 * поправка — видна в ленте), скачать `.md`; внизу файла — «Поправить»: пишешь словами, что не
 * так, агент исправляет сразу. Сверху — «Агент хочет знать».
 *
 * «Навыки» (AGT-003): по папке — экран всех навыков с описаниями и «когда пользовался»; у навыка —
 * закрепить (куратор не трогает), убрать в архив и вернуть одной кнопкой.
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
  useSkillChange,
  useSkills,
  type SkillChange,
} from './agent-records';
import {
  fileName,
  kindLabel,
  skillUse,
  tree,
  usage,
  type AgentFile,
  type AgentQuestion,
  type AgentSkill,
} from './agent-records-view';

/** «Открыт экран всех навыков», а не файл. */
const SKILLS_VIEW = 'skills';

export function AgentRecords() {
  const files = useFiles();
  const [open, setOpen] = useState<string | null>(null);
  const list = files.data?.files ?? [];
  const shown =
    open === SKILLS_VIEW || (open && list.some((f) => f.id === open))
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
              {folder.name === 'Навыки' ? (
                <button
                  type="button"
                  className={`rec-folder-name rec-folder-open${shown === SKILLS_VIEW ? ' on' : ''}`}
                  aria-current={shown === SKILLS_VIEW ? 'true' : undefined}
                  onClick={() => setOpen(SKILLS_VIEW)}
                >
                  Навыки — все
                </button>
              ) : (
                folder.name && <p className="rec-folder-name">{folder.name}</p>
              )}
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
        {shown === SKILLS_VIEW ? <SkillsView onOpen={setOpen} /> : shown && <FileView id={shown} />}
      </div>
    </div>
  );
}

/** Кнопки навыка: закрепить / открепить, в архив / вернуть. */
function SkillButtons({ skill }: { skill: AgentSkill }) {
  const change = useSkillChange();
  const [error, setError] = useState<string | null>(null);
  const act = (c: SkillChange) => {
    setError(null);
    change.mutate({ id: skill.id, change: c }, { onError: (er) => setError(say(er)) });
  };
  return (
    <>
      <div className="act-btns">
        {skill.archived ? (
          <Button
            size="sm"
            variant="fill"
            disabled={change.isPending}
            onClick={() => act('restore')}
          >
            Вернуть из архива
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              dot={false}
              disabled={change.isPending}
              onClick={() => act(skill.pinned ? 'unpin' : 'pin')}
            >
              {skill.pinned ? 'Открепить' : 'Закрепить'}
            </Button>
            {!skill.pinned && (
              <Button
                size="sm"
                dot={false}
                disabled={change.isPending}
                onClick={() => act('archive')}
              >
                В архив
              </Button>
            )}
          </>
        )}
      </div>
      {error && (
        <p className="act-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * Все навыки: что агент умеет, когда пользовался, что уберёт куратор. Навык — записанный способ
 * делать типовое; он не даёт агенту новых прав и инструментов.
 */
function SkillsView({ onOpen }: { onOpen: (id: string) => void }) {
  const skills = useSkills();
  if (skills.isPending) return <p className="later">Загружаю навыки…</p>;
  if (skills.isError) return <p className="later">{say(skills.error)}</p>;
  const all = skills.data.skills;
  const live = all.filter((s) => !s.archived);
  const archived = all.filter((s) => s.archived);
  const row = (s: AgentSkill) => (
    <li key={s.id} className="skill-row">
      <div>
        <button type="button" className="skill-name" onClick={() => onOpen(s.id)}>
          {s.name}
        </button>
        {s.builtin && <span className="skill-tag">встроенный</span>}
        {s.pinned && <span className="skill-tag">закреплён</span>}
        <p className="skill-desc">{s.description}</p>
        <p className="act-why">{skillUse(s)}</p>
      </div>
      <SkillButtons skill={s} />
    </li>
  );
  return (
    <section className="rec-view panel" aria-label="Навыки">
      <header className="rec-head">
        <div>
          <h2>Навыки</h2>
          <p>
            Агент записывает их сам, когда ты его поправил, когда дело из нескольких шагов удалось
            или одно и то же повторилось три раза. Не пользовался {skills.data.unused_days} дней —
            уберёт в архив сам (раз в неделю); закреплённые не трогает. Навык не даёт агенту новых
            прав.
          </p>
        </div>
      </header>
      {live.length === 0 ? (
        <p className="later">Навыков пока нет — агент заведёт их сам.</p>
      ) : (
        <ul className="skill-list" aria-label="Навыки агента">
          {live.map(row)}
        </ul>
      )}
      {archived.length > 0 && (
        <>
          <h3 className="rec-sub">Архив</h3>
          <ul className="skill-list" aria-label="Архив навыков">
            {archived.map(row)}
          </ul>
        </>
      )}
    </section>
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
      {file.data.kind === 'skill' && <SkillBar id={file.data.id} />}
      <FixField key={file.data.id} file={file.data} />
    </div>
  );
}

/** У файла навыка: как им пользуются и кнопки. */
function SkillBar({ id }: { id: string }) {
  const skills = useSkills();
  const skill = skills.data?.skills.find((s) => s.id === id);
  if (!skill) return null;
  return (
    <div className="skill-bar" aria-label="Навык">
      <p className="act-why">{skillUse(skill)}</p>
      <SkillButtons skill={skill} />
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
