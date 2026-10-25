/**
 * «Английский» (ENG-001): разговор с Нейтом — строгим и язвительным репетитором — голосом и
 * текстом. Нейт живой: слушает, думает, говорит, сердится на ошибку и (ворчливо) радуется верному.
 * Ошибки — списком «как сказал → как правильно — почему», «повтори» — отдельной строкой.
 * Итог разговора — в записях агента, «Английский.md».
 *
 * Разговор потоком (D-457…D-459): микрофон включён — говори как с человеком; полсекунды паузы —
 * Нейт отвечает, текст появляется по словам, голос играет сразу кусками. Заговорил поверх — он
 * замолкает. Под ответом — через сколько он ответил. Нет потока (старый браузер, сеть) —
 * запасной путь: «Говорить» → «Готово» и ответ целиком.
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
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Fail, say } from '../auth/client';
import { canLive, LiveTalk, stopHint } from './english-live';
import { EnglishRealtime } from './EnglishRealtime';
import { LimitLink } from './LimitLink';
import {
  appendTurn,
  canRecord,
  ENGLISH,
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
  waitLabel,
  phaseLabel,
  REACTION_MS,
  reactionOf,
  scoreLabel,
  voiceNote,
  type Phase,
} from './english-view';

/**
 * Голос разговора — из настроек «Английского» (ENG-005): живой через подписку ChatGPT или
 * ElevenLabs (распознал → ответил → озвучил), он же запасной.
 */
export function AgentEnglish() {
  const screen = useEnglish();
  // Старый сервер без выбора голоса — ElevenLabs.
  const engine = (screen.data?.engine as { engine?: string } | undefined)?.engine;
  if (screen.data && engine === 'chatgpt') return <EnglishRealtime data={screen.data} />;
  return <ElevenLabsEnglish />;
}

function ElevenLabsEnglish() {
  const wide = useMedia(WIDE);
  const screen = useEnglish();
  const start = useStart();
  const finish = useFinish();
  const turn = useTurn();
  const neit = useRef<CompanionHandle>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [text, setText] = useState('');
  // Ошибка и её код: отказ по лимиту показывает ссылку на настройки лимитов (AI-003).
  const [failure, setFailure] = useState<{ text: string; code: string | null } | null>(null);
  const setError = useCallback(
    (text: string | null, code: string | null = null) =>
      setFailure(text === null ? null : { text, code }),
    [],
  );
  const error = failure?.text ?? null;
  const rec = useRef<Recording | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());
  const end = useRef<HTMLDivElement>(null);
  const mic = canRecord();
  const qc = useQueryClient();
  // Разговор потоком: соединение, черновики, замеры.
  const talkRef = useRef<LiveTalk | null>(null);
  const [stream, setStream] = useState<'off' | 'on' | 'reconnecting' | 'broken'>('off');
  // Отказ по лимиту или зацикливанию: что сделать; микрофон ждёт «Попробовать снова».
  const [blocked, setBlocked] = useState<{ text: string; code: string } | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [saying, setSaying] = useState<string | null>(null);
  const [waits, setWaits] = useState<Record<string, number>>({});
  const pendingReaction = useRef<Phase | null>(null);
  // Связь обрывалась: ход, начатый до обрыва, сервер мог записать, а ответ на экран не дошёл.
  const stale = useRef(false);

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
  const voice = data?.voice ?? { listen: false, speak: false, live: false };
  const live = !!data?.session;
  const streaming = stream === 'on';
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

  // Идёт разговор — открыть поток; закончился или ушёл с экрана — закрыть.
  useEffect(() => {
    if (!live || !canLive()) return;
    const react = (p: Phase | null) => {
      if (!p) return setPhase('idle');
      setPhase(p);
      setTimeout(() => setPhase((now) => (now === p ? 'idle' : now)), REACTION_MS);
    };
    const t = new LiveTalk({
      onSpeech: (on) => {
        setPhase(on ? 'listening' : 'thinking');
        if (on) setHeard('');
      },
      onPartial: (text) => setHeard(text),
      onHeard: (text) => {
        setHeard(text);
        setPhase('thinking');
      },
      onSay: (piece) => setSaying((now) => (now ?? '') + piece),
      onVoice: (on) => {
        setVoicePlaying(on);
        if (on) setPhase('speaking');
        else {
          const p = pendingReaction.current;
          pendingReaction.current = null;
          react(p);
        }
      },
      onReply: (turn, wait) => {
        // После обрыва — весь разговор заново: в нём и ход, ответ на который пропал.
        if (stale.current) {
          stale.current = false;
          void qc.invalidateQueries({ queryKey: ENGLISH });
        } else appendTurn(qc, turn);
        setHeard(null);
        setSaying(null);
        if (wait !== null) setWaits((w) => ({ ...w, [turn.tutor.id]: wait }));
        const p = reactionOf(turn.tutor.verdict, turn.tutor.repeated);
        // Говорит — отреагирует, когда договорит.
        setVoicePlaying((on) => {
          if (on) pendingReaction.current = p;
          else react(p);
          return on;
        });
      },
      onError: (code, message, heardText, stop) => {
        setPhase('idle');
        setSaying(null);
        if (heardText) setText(heardText);
        setHeard(null);
        if (stop) {
          setMicOn(false);
          setBlocked({ text: stopHint(code, message), code });
        } else setError(message, code);
      },
      onLink: (state) => {
        setStream(state);
        if (state === 'reconnecting') {
          // Ответ на начатый ход по этой связи уже не придёт — не ждать его вечно.
          stale.current = true;
          setHeard(null);
          setSaying(null);
          setPhase('idle');
        } else if (stale.current) {
          // Связь вернулась — подтянуть то, что сервер успел записать без нас.
          void qc.invalidateQueries({ queryKey: ENGLISH });
        }
      },
      onClose: () => {
        setMicOn(false);
        setStream('broken');
      },
    });
    talkRef.current = t;
    t.ready().then(
      () => setStream('on'),
      () => setStream('broken'),
    );
    return () => {
      t.close();
      talkRef.current = null;
      setMicOn(false);
      setBlocked(null);
      setStream('off');
    };
  }, [live, qc, setError]);

  /** «Попробовать снова»: снять отказ, переподключиться, вернуть микрофон, если был включён. */
  async function retry() {
    const t = talkRef.current;
    if (!t) return;
    setBlocked(null);
    setError(null);
    if (!t.retry()) return;
    try {
      await t.listen();
      setMicOn(true);
    } catch {
      setError('Микрофон недоступен: разреши его браузеру или пиши текстом.');
    }
  }

  async function toggleMic() {
    const t = talkRef.current;
    if (!t) return;
    setError(null);
    if (t.listening) {
      t.stopMic();
      setMicOn(false);
      return;
    }
    try {
      hush();
      await t.listen();
      setMicOn(true);
    } catch {
      setError('Микрофон недоступен: разреши его браузеру или пиши текстом.');
    }
  }

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
    [voice.speak, hush, setError],
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
      setError(say(e), e instanceof Fail ? e.code : null);
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
    if (!t) return;
    const lt = talkRef.current;
    if (streaming && lt) {
      setError(null);
      hush();
      lt.hush();
      setText('');
      setHeard(t);
      setSaying(null);
      setPhase('thinking');
      lt.text(t);
      return;
    }
    void talk({ text: t });
  }

  async function begin() {
    setError(null);
    try {
      const s = await start.mutateAsync();
      const hello = s.messages.at(-1);
      if (hello && s.messages.length === 1) void play(hello);
    } catch (e) {
      setError(say(e), e instanceof Fail ? e.code : null);
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

  const busy = turn.isPending || (phase === 'thinking' && !streaming);
  const listening = phase === 'listening' && !streaming;
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
              <Line
                key={m.id}
                m={m}
                speak={voice.speak}
                wait={waits[m.id] ?? m.latency?.first_audio_ms ?? null}
                onPlay={() => void play(m)}
              />
            ))}
            {heard !== null && (
              <li className="talk-msg" data-draft="">
                <p className="talk-meta">
                  <b>Ты</b> · голосом
                </p>
                <p className="talk-text" lang="en">
                  {heard || '…'}
                </p>
              </li>
            )}
            {saying !== null && (
              <li className="talk-msg agent" data-draft="">
                <p className="talk-meta">
                  <b>Нейт</b>
                </p>
                <p className="talk-text" lang="en">
                  {saying}
                </p>
              </li>
            )}
            {(busy || (streaming && phase === 'thinking' && saying === null)) && (
              <li className="talk-msg agent" role="status">
                <p className="talk-text talk-think">Нейт думает…</p>
              </li>
            )}
          </ol>
          <div ref={end} />
          <div className="eng-controls">
            {blocked && (
              <div className="eng-blocked" role="alert">
                <p>{blocked.text}</p>
                <LimitLink code={blocked.code} />
                <Button size="sm" onClick={() => void retry()}>
                  Попробовать снова
                </Button>
              </div>
            )}
            {stream === 'reconnecting' && (
              <p className="eng-hint" role="status">
                Связь прервалась — переподключаюсь…
              </p>
            )}
            {stream === 'broken' && !blocked && canLive() && (
              <div className="eng-blocked" role="status">
                <p>Связь для разговора потоком не вернулась — пиши текстом или говори кнопкой.</p>
                <Button size="sm" onClick={() => void retry()}>
                  Попробовать снова
                </Button>
              </div>
            )}
            {streaming && !blocked && (voice.live || voice.listen) && (
              <Button variant="fill" onClick={() => void toggleMic()} aria-pressed={micOn}>
                {micOn ? 'Выключить микрофон' : 'Включить микрофон'}
              </Button>
            )}
            {streaming && micOn && (
              <p className="eng-hint">
                Говори — полсекунды паузы, и Нейт ответит. Перебей его голосом.
              </p>
            )}
            {streaming && voicePlaying && (
              <Button size="sm" dot={false} onClick={() => talkRef.current?.interrupt()}>
                Перебить
              </Button>
            )}
            {!streaming &&
              !blocked &&
              // Пока переподключаемся, включённый микрофон потока ждёт связь — вторая запись не нужна.
              (stream === 'broken' || (stream === 'reconnecting' && !micOn) || !canLive()) &&
              voice.listen &&
              mic && (
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
                talkRef.current?.stopMic();
                talkRef.current?.hush();
                setMicOn(false);
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
          {error} <LimitLink code={failure?.code ?? null} />
        </p>
      )}
    </div>
  );
}

/** Одна реплика: у Нейта — ошибки, «повтори» и «Ещё раз». */
function Line({
  m,
  speak,
  wait,
  onPlay,
}: {
  m: EnglishMessage;
  speak: boolean;
  /** Через сколько ответил (мс от конца фразы до первого звука). */
  wait: number | null;
  onPlay: () => void;
}) {
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
        {tutor && wait !== null && <> · {waitLabel(wait)}</>}
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
