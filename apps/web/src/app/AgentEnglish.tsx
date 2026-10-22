/**
 * «Английский» (ENG-001): разговор с Нейтом — строгим и язвительным репетитором — голосом и
 * текстом. Нейт живой: слушает, думает, говорит, сердится на ошибку и (ворчливо) радуется верному.
 * Ошибки — списком «как сказал → как правильно — почему», «повтори» — отдельной строкой.
 * Итог разговора — в записях агента, «Английский.md».
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
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Fail, say } from '../auth/client';
import {
  canRecord,
  fetchSpeech,
  record,
  TurnFail,
  useEnglish,
  useFinish,
  useStart,
  useTurn,
  type EnglishMessage,
  type Recording,
  type Saying,
} from './english';
import {
  minutesLabel,
  moodFor,
  phaseLabel,
  REACTION_MS,
  reactionOf,
  scoreLabel,
  voiceNote,
  type Phase,
} from './english-view';

export function AgentEnglish() {
  const wide = useMedia(WIDE);
  const screen = useEnglish();
  const start = useStart();
  const finish = useFinish();
  const turn = useTurn();
  const neit = useRef<CompanionHandle>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recording | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());
  const end = useRef<HTMLDivElement>(null);
  const mic = canRecord();

  /** Замолчать: прошлый звук больше не меняет, что делает Нейт. */
  const hush = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    a.onended = null;
    a.onerror = null;
    a.pause();
    audio.current = null;
  }, []);

  const data = screen.data;
  const messages = data?.messages ?? [];
  const voice = data?.voice ?? { listen: false, speak: false };
  const live = !!data?.session;
  const last = messages.at(-1)?.id;

  // Нейт всегда показывает, что происходит.
  useEffect(() => {
    neit.current?.setMood(moodFor(phase));
    if (phase === 'right') neit.current?.jump();
  }, [phase]);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [last]);

  // Ушёл с экрана — замолчать, микрофон выключить, ссылки на звук освободить.
  useEffect(() => {
    const map = urls.current;
    return () => {
      rec.current?.cancel();
      hush();
      map.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [hush]);

  const play = useCallback(
    async (m: EnglishMessage) => {
      if (!voice.speak) return;
      try {
        let url = urls.current.get(m.id);
        if (!url) {
          setPhase('thinking');
          url = URL.createObjectURL(await fetchSpeech(m.id));
          urls.current.set(m.id, url);
        }
        hush();
        const a = new Audio(url);
        audio.current = a;
        a.onended = () => setPhase('idle');
        a.onerror = () => setPhase('idle');
        setPhase('speaking');
        await a.play();
      } catch (e) {
        setPhase('idle');
        // браузер не дал играть без нажатия — молча: есть кнопка «Ещё раз»
        if (!(e instanceof DOMException)) setError(say(e));
      }
    },
    [voice.speak, hush],
  );

  async function talk(saying: Saying) {
    setError(null);
    setPhase('thinking');
    try {
      const t = await turn.mutateAsync(saying);
      if ('text' in saying) setText('');
      const reaction = reactionOf(t.tutor.verdict, t.tutor.repeated);
      if (reaction) {
        setPhase(reaction);
        await new Promise((r) => setTimeout(r, REACTION_MS));
      }
      if (voice.speak) await play(t.tutor);
      else setPhase('idle');
    } catch (e) {
      setPhase('idle');
      if (e instanceof TurnFail && e.heard) setText(e.heard);
      setError(say(e));
    }
  }

  async function micDown() {
    setError(null);
    if (rec.current) return micUp();
    try {
      hush();
      rec.current = await record(() => void micUp());
      setPhase('listening');
    } catch {
      setError('Микрофон недоступен: разреши его браузеру или пиши текстом.');
    }
  }

  async function micUp() {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    const { audio: clip, ms } = await r.stop();
    if (ms < 400 || clip.size === 0) {
      setPhase('idle');
      setError('Слишком коротко — нажми «Говорить», скажи фразу и нажми «Готово».');
      return;
    }
    await talk({ audio: clip, ms });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (t) void talk({ text: t });
  }

  async function begin() {
    setError(null);
    try {
      const s = await start.mutateAsync();
      const hello = s.messages.at(-1);
      if (hello && s.messages.length === 1) void play(hello);
    } catch (e) {
      setError(say(e));
    }
  }

  if (screen.isError) {
    const denied = screen.error instanceof Fail && screen.error.status === 403;
    return (
      <p className="later" role="status">
        {denied
          ? 'Английский — часть агента: нет доступа к модулю «Агент Qubite». Его включает owner в Console.'
          : say(screen.error)}
      </p>
    );
  }

  const busy = turn.isPending || phase === 'thinking';
  const listening = phase === 'listening';
  const note = voiceNote(voice.listen, voice.speak, mic);
  const totals = data?.totals;

  return (
    <div className="eng">
      <div className="eng-stage">
        <Companion ref={neit} kind="neit" pitch={wide ? 7.5 : 6} label="Нейт — репетитор" />
        <div className="eng-who">
          <b>Нейт</b>
          <span className="eng-phase" aria-live="polite">
            {phaseLabel(phase)}
          </span>
          {totals && totals.turns > 0 && (
            <span className="eng-score">
              {totals.sessions} разг. · {scoreLabel(totals.correct, totals.turns)}
            </span>
          )}
        </div>
      </div>

      <Presence show={!!data && !!note}>
        <Note>{note}</Note>
      </Presence>

      {data && !live && (
        <div className="eng-start">
          <p className="later">
            Говори с Нейтом по-английски — он строгий и язвительный: ловит каждую ошибку, объясняет
            и заставляет повторить правильно. Итог разговора он запишет в «Английский.md».
          </p>
          {data.last && (
            <p className="eng-last">
              Прошлый разговор: {minutesLabel(data.last.started_at, data.last.last_at)}, реплик{' '}
              {data.last.turns}, с ошибками {data.last.mistakes}.
            </p>
          )}
          <Button variant="fill" onClick={() => void begin()} disabled={start.isPending}>
            Начать разговор
          </Button>
        </div>
      )}

      {live && (
        <>
          <ol className="talk-list" aria-label="Разговор с Нейтом" aria-live="polite">
            {messages.map((m) => (
              <Line key={m.id} m={m} speak={voice.speak} onPlay={() => void play(m)} />
            ))}
            {busy && (
              <li className="talk-msg agent" role="status">
                <p className="talk-text talk-think">Нейт думает…</p>
              </li>
            )}
          </ol>
          <div ref={end} />
          <div className="eng-controls">
            {voice.listen && mic && (
              <Button
                variant="fill"
                onClick={() => void micDown()}
                disabled={busy}
                aria-pressed={listening}
              >
                {listening ? 'Готово' : 'Говорить'}
              </Button>
            )}
            <form className="talk-form eng-form" onSubmit={submit} aria-label="Написать Нейту">
              <Field
                label="Написать по-английски"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Yesterday I went to school…"
                maxLength={1000}
                disabled={listening}
              />
              <Button size="sm" type="submit" disabled={busy || listening || !text.trim()}>
                Отправить
              </Button>
            </form>
            <Button
              size="sm"
              onClick={() => {
                rec.current?.cancel();
                rec.current = null;
                hush();
                setPhase('idle');
                finish.mutate(undefined, { onError: (e) => setError(say(e)) });
              }}
              disabled={busy || finish.isPending}
            >
              Закончить
            </Button>
          </div>
        </>
      )}
      {error && (
        <p className="act-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Одна реплика: у Нейта — ошибки, «повтори» и «Ещё раз». */
function Line({ m, speak, onPlay }: { m: EnglishMessage; speak: boolean; onPlay: () => void }) {
  const tutor = m.role === 'tutor';
  return (
    <li
      className={tutor ? 'talk-msg agent' : 'talk-msg'}
      data-verdict={tutor ? (m.verdict ?? 'none') : undefined}
    >
      <p className="talk-meta">
        <b>{tutor ? 'Нейт' : 'Ты'}</b>
        {!tutor && m.via === 'voice' && <> · голосом</>}
        {tutor && m.verdict === 'mistake' && <> · ошибка</>}
        {tutor && (m.verdict === 'ok' || m.repeated) && <> · верно</>}
      </p>
      <p className="talk-text" lang="en">
        {m.text}
      </p>
      {tutor && m.mistakes.length > 0 && (
        <ul className="eng-fix" aria-label="Ошибки">
          {m.mistakes.map((x, i) => (
            <li key={i}>
              {x.wrong && (
                <>
                  <s lang="en">{x.wrong}</s> →{' '}
                </>
              )}
              <b lang="en">{x.right}</b>
              {x.why && <span className="eng-why"> — {x.why}</span>}
            </li>
          ))}
        </ul>
      )}
      {tutor && m.repeat && (
        <p className="eng-repeat">
          Повтори: <b lang="en">{m.repeat}</b>
        </p>
      )}
      {tutor && speak && (
        <Button size="sm" dot={false} onClick={onPlay} className="eng-play">
          Ещё раз
        </Button>
      )}
    </li>
  );
}
