/**
 * Разговор с агентом (AGT-001, D-326): рассказываешь — агент запоминает в свою папку, спрашивает
 * непонятное, делает дела. Каждое его действие — в «Ленте» с откатом. То же самое — в Telegram:
 * «/agent текст» или ответ на сообщение агента.
 */
import { Button, Field } from '@qubite/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Fail, say } from '../auth/client';
import { useChat, useSay } from './agent-records';
import { channelLabel } from './agent-records-view';
import { whenLabel } from './agent-view';

export function AgentChat() {
  const chat = useChat();
  const send = useSay();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const messages = chat.data?.messages ?? [];
  const last = messages.at(-1)?.id;

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [last, chat.data?.pending]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setError(null);
    send.mutate(t, {
      onSuccess: () => setText(''),
      onError: (er) => setError(say(er)),
    });
  }

  if (chat.isError) {
    const denied = chat.error instanceof Fail && chat.error.status === 403;
    return (
      <p className="later" role="status">
        {denied
          ? 'Агент выключен: нет доступа к модулю «Агент Qubite». Его включает owner в Console.'
          : say(chat.error)}
      </p>
    );
  }
  return (
    <div className="talk">
      {messages.length === 0 && !chat.isPending && (
        <p className="later">
          Расскажи агенту о себе и учёбе: «русский у меня по вт и чт третьим уроком». Он запомнит и
          спросит, чего не знает. В Telegram — «/agent» и текст.
        </p>
      )}
      <ol className="talk-list" aria-label="Разговор с агентом" aria-live="polite">
        {messages.map((m) => {
          const where = channelLabel(m.channel);
          return (
            <li key={m.id} className={m.role === 'agent' ? 'talk-msg agent' : 'talk-msg'}>
              <p className="talk-meta">
                <b>{m.role === 'agent' ? 'Агент' : 'Ты'}</b> ·{' '}
                <time dateTime={m.at}>{whenLabel(m.at)}</time>
                {where && <> · {where}</>}
                {m.role === 'agent' && m.actions > 0 && <> · действий: {m.actions} (в «Ленте»)</>}
              </p>
              <p className="talk-text">{m.text}</p>
            </li>
          );
        })}
        {chat.data?.pending && (
          <li className="talk-msg agent" role="status">
            <p className="talk-text talk-think">Агент думает…</p>
          </li>
        )}
      </ol>
      <div ref={end} />
      <form className="talk-form" onSubmit={submit} aria-label="Написать агенту">
        <Field
          label="Написать агенту"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Например: русский по вт и чт, учительница строгая к оформлению"
          maxLength={4000}
        />
        <Button size="sm" variant="fill" type="submit" disabled={send.isPending || !text.trim()}>
          Отправить
        </Button>
      </form>
      {error && (
        <p className="act-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
