import { Button, Field, Note, Presence } from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { must, say } from '../auth/client';
import { WORK, useWork, when, type WorkItem, type WorkQuestion } from './api';

/**
 * Работа агентов (HAR-002, D-643): что идёт, что готово — проверь, что ждёт владельца, очередь
 * и расход лимита. Данные — GitHub Issues, их читает сервер своим токеном; ответ кнопкой
 * становится комментарием в issue, агент читает его сам.
 */
export function WorkTab() {
  const qc = useQueryClient();
  const [fresh, setFresh] = useState(false);
  const work = useWork(fresh);
  const refresh = async () => {
    setFresh(true);
    await qc.invalidateQueries({ queryKey: WORK });
  };
  if (work.isPending) return <p className="cs-small">Спрашиваем GitHub…</p>;
  if (work.isError)
    return (
      <div className="cs-stack">
        <Note tone="bad">{say(work.error)}</Note>
        <div className="cs-row">
          <Button size="sm" onClick={() => void refresh()}>
            Попробовать ещё
          </Button>
        </div>
      </div>
    );
  const w = work.data;
  if (!w.configured)
    return (
      <div className="cs-panel">
        <h2 className="cs-h">GitHub не настроен</h2>
        <p className="cs-small">
          Раздел читает задачи агентов из GitHub Issues репозитория {w.repo}. Для этого серверу
          нужен токен: впишите его в QUBITE_GITHUB_TOKEN в .env на сервере и перезапустите Qubite.
          Токен — fine-grained, только этот репозиторий, права Issues: Read and write. В браузер он
          не попадает.
        </p>
      </div>
    );
  return (
    <div className="cs-stack">
      <div className="cs-set">
        <span className="cs-small">
          Из GitHub · {w.repo} · обновлено {when(w.fetched_at)}
        </span>
        <Button size="sm" disabled={work.isFetching} onClick={() => void refresh()}>
          {work.isFetching ? 'Обновляем…' : 'Обновить'}
        </Button>
      </div>
      {w.usage && (
        <div className="cs-panel" role="group" aria-label="Расход лимита">
          <div className="cs-set">
            <h2 className="cs-h">Лимит агентов</h2>
            <a className="cs-link" href={w.usage.url} target="_blank" rel="noreferrer">
              запись →
            </a>
          </div>
          <dl className="cs-stats cs-usage">
            <div>
              <dt>За окно</dt>
              <dd>{percent(w.usage.window_percent)}</dd>
            </div>
            <div>
              <dt>За неделю</dt>
              <dd>{percent(w.usage.week_percent)}</dd>
            </div>
          </dl>
          <p className="cs-small cs-pre">
            {w.usage.text} · {when(w.usage.at)}
          </p>
        </div>
      )}
      <div className="cs-panel" role="group" aria-label="Ждёт тебя">
        <div className="cs-set">
          <h2 className="cs-h">Ждёт тебя</h2>
          <span className="cs-pill">{w.questions.length}</span>
        </div>
        {w.questions.length === 0 ? (
          <p className="cs-small">Вопросов нет — агенты справляются сами.</p>
        ) : (
          w.questions.map((q) => <Question key={q.number} q={q} />)
        )}
      </div>
      <Group title="Готово — проверь" items={w.review} empty="Пока нечего проверять." />
      <Group title="Идёт" items={w.running} empty="Сейчас никто не работает." />
      <Group title="Очередь" items={w.queue} empty="Очередь пуста." numbered />
    </div>
  );
}

const percent = (p: number | null | undefined) => (p == null ? '—' : `${p}%`);

function Group({
  title,
  items,
  empty,
  numbered,
}: {
  title: string;
  items: WorkItem[];
  empty: string;
  numbered?: boolean;
}) {
  return (
    <div className="cs-panel" role="group" aria-label={title}>
      <div className="cs-set">
        <h2 className="cs-h">{title}</h2>
        <span className="cs-pill">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="cs-small">{empty}</p>
      ) : (
        <ol className="cs-work">
          {items.map((it, i) => (
            <li key={it.number}>
              <a className="cs-task" href={it.url} target="_blank" rel="noreferrer">
                {numbered && <span className="cs-place">{i + 1}.</span>}#{it.number} {it.title}
              </a>
              <span className="cs-small">
                обновлено {when(it.updated_at)}
                {it.labels.length > 0 && ` · ${it.labels.join(', ')}`}
              </span>
              {it.links.length > 0 && (
                <span className="cs-links">
                  {it.links.map((l) => (
                    <a
                      key={l.url}
                      className="cs-link"
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {l.label} →
                    </a>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Вопрос: вариант — одной кнопкой (первая, оранжевая, — рекомендация агента), или свой ответ.
 * Ответ уходит комментарием в issue; кнопка не срабатывает, если палец уехал (прокрутка).
 */
function Question({ q }: { q: WorkQuestion }) {
  const qc = useQueryClient();
  const [own, setOwn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const send = async (answer: string) => {
    if (busy || !answer.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await must(
        api.POST('/api/owner/work/questions/{number}/answer', {
          params: { path: { number: q.number } },
          body: { answer: answer.trim() },
        }),
      );
      setSent(true);
      // Карточка сначала уходит, потом список обновляется — без рывка.
      window.setTimeout(() => void qc.invalidateQueries({ queryKey: WORK }), 900);
    } catch (err) {
      setError(say(err));
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(own);
  };
  return (
    <Presence show={!sent}>
      <form className="cs-question" aria-label={q.title} onSubmit={submit} noValidate>
        <a className="cs-task" href={q.url} target="_blank" rel="noreferrer">
          #{q.number} {q.title}
        </a>
        {q.text && <p className="cs-pre">{q.text}</p>}
        {q.options.length > 0 && (
          <div className="cs-options" role="group" aria-label="Варианты ответа">
            {q.options.map((o, i) => (
              <Button
                key={o}
                variant={i === 0 ? 'fill' : 'outline'}
                disabled={busy}
                onClick={() => void send(o)}
              >
                {i === 0 && !/рекоменд/i.test(o) ? `${o} · рекомендую` : o}
              </Button>
            ))}
          </div>
        )}
        <Field
          label={q.options.length > 0 ? 'Или свой ответ' : 'Ответ'}
          value={own}
          onChange={(e) => setOwn(e.target.value)}
          maxLength={2000}
          error={error}
        />
        <div className="cs-row">
          <Button type="submit" size="sm" disabled={busy || !own.trim()}>
            {busy ? 'Отправляем…' : 'Ответить своим'}
          </Button>
        </div>
      </form>
    </Presence>
  );
}
