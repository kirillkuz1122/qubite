/**
 * «Английский → Разговор» живым голосом через подписку ChatGPT (ENG-005, D-573). Нажал «Начать» —
 * сервер выдал временный ключ, браузер подключился к OpenAI Realtime напрямую (WebRTC). Говори
 * как с человеком: Нейт слышит, отвечает голосом, его можно перебить. Расшифровка обеих сторон —
 * на экране по мере речи, готовые реплики — в истории разговора. «Пауза» — микрофон и Нейт
 * молчат, время не идёт; «Закончить» — итог в «Английский.md». Не вышло — понятная причина и
 * «Говорить через ElevenLabs».
 */
import {
  Button,
  Companion,
  Field,
  Note,
  Presence,
  useMedia,
  WIDE,
  type CompanionHandle,
} from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Fail, say } from '../auth/client';
import { ENGLISH, useFinish, type EnglishMessage, type EnglishOverview } from './english';
import { useChangeSettings } from './english-lessons';
import {
  canRealtime,
  EMPTY,
  finishRealtime,
  minutesLeft,
  RealtimeTalk,
  saveLines,
  serverFailure,
  startRealtime,
  type Activity,
  type Item,
  type RtFailure,
  type Transcript,
} from './english-realtime';
import { moodFor, phaseLabel, type Phase } from './english-view';

type LinkState = 'idle' | 'connecting' | 'live' | 'closed';

function phaseOf(a: Activity, link: LinkState, paused: boolean): Phase {
  if (link !== 'live' || paused) return link === 'connecting' ? 'thinking' : 'idle';
  return a ?? 'idle';
}

export function EnglishRealtime({ data }: { data: EnglishOverview }) {
  const wide = useMedia(WIDE);
  const qc = useQueryClient();
  const change = useChangeSettings();
  const finish = useFinish();
  const neit = useRef<CompanionHandle>(null);
  const talk = useRef<RealtimeTalk | null>(null);
  const callId = useRef<string | null>(null);
  // Реплики, которые не удалось отправить, — со следующей отправкой.
  const unsent = useRef<Item[]>([]);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const [link, setLink] = useState<LinkState>('idle');
  const [transcript, setTranscript] = useState<Transcript>(EMPTY);
  // Реплики до этого сеанса (с сервера при подключении); без связи — с экрана.
  const [before, setBefore] = useState<EnglishMessage[]>([]);
  const [activity, setActivity] = useState<Activity>(null);
  const [paused, setPaused] = useState(false);
  const [failure, setFailure] = useState<RtFailure | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [ending, setEnding] = useState(false);
  const engine = data.engine;
  const phase = phaseOf(activity, link, paused);

  useEffect(() => {
    neit.current?.setMood(moodFor(phase));
  }, [phase]);

  const send = useCallback((items: Item[]) => {
    const id = callId.current;
    if (!id) return;
    const batch = [...unsent.current, ...items];
    unsent.current = [];
    saving.current = saving.current
      .then(() => saveLines(id, batch))
      .catch(() => {
        unsent.current = [...batch, ...unsent.current];
      });
  }, []);

  /** Сеанс кончился (сам или кнопкой): секунды — серверу; `end` — закрыть и разговор. */
  const settle = useCallback(
    async (end: boolean) => {
      const t = talk.current;
      const id = callId.current;
      talk.current = null;
      if (!t || !id) return;
      t.close();
      if (unsent.current.length) send([]);
      await saving.current;
      callId.current = null;
      await finishRealtime(id, t.seconds, end).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ENGLISH });
      void qc.invalidateQueries({ queryKey: ['english', 'settings'] });
    },
    [qc, send],
  );

  // Ушёл с экрана — закрыть связь и сообщить, сколько длилось.
  useEffect(() => () => void settle(false), [settle]);

  async function begin() {
    setFailure(null);
    setNote(null);
    setTranscript(EMPTY);
    setBefore(data.messages);
    setLink('connecting');
    let started;
    try {
      started = await startRealtime();
    } catch (e) {
      setLink('idle');
      setFailure(
        e instanceof Fail ? serverFailure(e.code, e.message) : serverFailure('other', say(e)),
      );
      return;
    }
    callId.current = started.realtime.id;
    setBefore(started.messages);
    setLeft(started.realtime.max_seconds);
    if (started.fallback) setNote(started.fallback);
    const t = new RealtimeTalk(started.realtime, {
      onTranscript: setTranscript,
      onActivity: setActivity,
      onLink: (s) => {
        setLink(s);
        if (s === 'closed') setActivity(null);
      },
      onFailure: (f) => {
        setFailure(f);
        // Связь закрылась сама (время вышло, сеть) — сообщить серверу.
        if (talk.current === t) void settle(false);
      },
      onTick: setLeft,
      onLines: send,
    });
    talk.current = t;
    setPaused(false);
    await t.start();
  }

  function togglePause() {
    const t = talk.current;
    if (!t) return;
    if (t.paused) t.resume();
    else t.pause();
    setPaused(t.paused);
  }

  async function end() {
    setEnding(true);
    try {
      if (talk.current) await settle(true);
      else
        await finish
          .mutateAsync()
          .catch((e: unknown) => setFailure({ code: 'other', text: say(e), fallback: false }));
    } finally {
      setEnding(false);
      setLink('idle');
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || !talk.current) return;
    talk.current.text(t);
    setText('');
  }

  function toElevenLabs() {
    change.mutate({ voice_engine: 'elevenlabs' });
  }

  const live = link === 'live' || link === 'connecting';
  const history = link === 'idle' ? data.messages : before;
  const browserOk = canRealtime();
  const shown = [...history.map(fromServer), ...transcript.items.filter((i) => i.text || !i.done)];

  return (
    <div className="eng">
      <div className="eng-stage">
        <Companion ref={neit} kind="neit" pitch={wide ? 7.5 : 6} label="Нейт — репетитор" />
        <div className="eng-who">
          <b>Нейт</b>
          <span className="eng-phase" aria-live="polite">
            {link === 'connecting' ? 'Подключаюсь…' : paused ? 'Пауза' : phaseLabel(phase)}
          </span>
          <span className="eng-score">Живой голос ChatGPT</span>
        </div>
      </div>

      <Presence show={!engine.chatgpt_connected}>
        <Note>
          Живой голос работает по твоей подписке ChatGPT, а она не подключена.{' '}
          <Link to="/settings/ai">Войти через ChatGPT →</Link>
        </Note>
      </Presence>
      <Presence show={engine.chatgpt_connected && !engine.realtime_ready}>
        <Note>
          Живой голос на сервере выключен (провайдер ChatGPT) — пока говори через ElevenLabs.
        </Note>
      </Presence>
      <Presence show={!browserOk}>
        <Note>
          Этот браузер не умеет живой разговор (WebRTC) — открой Qubite в Chrome, Edge или Safari.
        </Note>
      </Presence>
      <Presence show={!!note}>
        <Note>{note}</Note>
      </Presence>

      {shown.length > 0 && (
        <ol className="talk-list" aria-label="Разговор с Нейтом" aria-live="polite">
          {shown.map((m) => (
            <li
              key={m.id}
              className={m.role === 'tutor' ? 'talk-msg agent' : 'talk-msg'}
              data-draft={m.done ? undefined : ''}
            >
              <p className="talk-meta">
                <b>{m.role === 'tutor' ? 'Нейт' : 'Ты'}</b>
                {m.role === 'learner' && <> · голосом</>}
              </p>
              <p className="talk-text" lang="en">
                {m.text || '…'}
              </p>
            </li>
          ))}
        </ol>
      )}

      <div className="eng-controls">
        {failure && (
          <div className="eng-blocked" role="alert">
            <p>{failure.text}</p>
            {failure.code === 'chatgpt_not_connected' && (
              <Link className="limit-link" to="/settings/ai">
                Подключить ChatGPT →
              </Link>
            )}
            {failure.fallback && (
              <Button size="sm" onClick={toElevenLabs} disabled={change.isPending}>
                Говорить через ElevenLabs
              </Button>
            )}
          </div>
        )}
        {!live && (
          <>
            {link === 'idle' && history.length === 0 && (
              <p className="later">
                Живой разговор: говори с Нейтом как с человеком — он слышит сразу, отвечает голосом
                и ловит каждую ошибку. Можно перебивать. Внизу — что сказал ты и что ответил он.
              </p>
            )}
            <Button
              variant="fill"
              onClick={() => void begin()}
              disabled={!browserOk || !engine.chatgpt_connected || !engine.realtime_ready}
            >
              {failure || link === 'closed' ? 'Начать снова' : 'Начать разговор'}
            </Button>
          </>
        )}
        {live && (
          <>
            <Button
              variant="fill"
              onClick={togglePause}
              aria-pressed={paused}
              disabled={link !== 'live'}
            >
              {paused ? 'Продолжить' : 'Пауза'}
            </Button>
            {link === 'live' && !paused && (
              <p className="eng-hint">
                Говори — Нейт ответит, когда ты договоришь. Перебей его голосом.
                {left !== null && <> Осталось {minutesLeft(left)}.</>}
              </p>
            )}
            {phase === 'speaking' && (
              <Button size="sm" dot={false} onClick={() => talk.current?.interrupt()}>
                Перебить
              </Button>
            )}
            <form className="talk-form eng-form" onSubmit={submit} aria-label="Написать Нейту">
              <Field
                label="Написать по-английски"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Yesterday I went to school…"
                maxLength={1000}
                disabled={link !== 'live'}
              />
              <Button size="sm" type="submit" disabled={link !== 'live' || !text.trim()}>
                Отправить
              </Button>
            </form>
          </>
        )}
        {(live || !!data.session) && (
          <Button size="sm" onClick={() => void end()} disabled={ending}>
            Закончить
          </Button>
        )}
      </div>
    </div>
  );
}

function fromServer(m: EnglishMessage): Item {
  return { id: m.id, role: m.role === 'tutor' ? 'tutor' : 'learner', text: m.text, done: true };
}
