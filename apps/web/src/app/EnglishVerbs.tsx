/**
 * Вкладка «Глаголы» в «Английском» (ENG-008, D-887…D-889, D-897…D-899): ~150 неправильных
 * глаголов группами по звучанию, свои наборы (списком или с фото) и тренажёр с интервальным
 * повторением. Заниматься можно письменно («впиши вторую и третью форму» — главное), карточками
 * («знал / не знал / легко») или вслух; для закрепления — игры. Новые глаголы сначала показываем,
 * потом спрашиваем; на котором ошибся — спросим ещё раз через пару других. Сверку, срок
 * повторения, минуты и опыт считает сервер.
 */
import { Button, Field, Note, Presence, Segmented, Sheet, type CompanionHandle } from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { say } from '../auth/client';
import { canRecord } from './english';
import { useDictation } from './english-dictation';
import { playCue } from './english-feedback';
import { ENGLISH_HOME } from './english-lessons';
import { Denied, Gain, LessonScreen, Progress } from './EnglishParts';
import { VerbRound } from './EnglishVerbGames';
import {
  ResultBar,
  SessionResult,
  TrainerShell,
  VerbRows,
  type BarView,
  type Session,
} from './EnglishVerbParts';
import { AddWords } from './EnglishVerbSets';
import {
  answerVerb,
  deleteVerbSet,
  ENGLISH_VERBS,
  useEnglishVerbs,
  useRefreshIfClosed,
  type Verb,
  type VerbAnswered,
  type VerbGrade,
  type VerbMode,
  type VerbReply,
  type VerbsOverview,
} from './english-verbs';
import { anagram, anagramOk, GAMES, pickGame, question } from './english-verbs-games';
import {
  advance,
  done,
  EMPTY_TALLY,
  formOk,
  groupStats,
  headline,
  line,
  pickSession,
  startQueue,
  tally,
  type GroupStat,
  type Scope,
  type Tone,
} from './english-verbs-view';
import { SecHead } from './parts';

/** Как заниматься: письменно, карточками или вслух. */
type Study = 'type' | 'cards' | 'speak';
const STUDIES: readonly Study[] = ['type', 'cards', 'speak'];
const STUDY_STORE = 'qubite.english.verbs.study';
/** Игры, где сразу несколько глаголов на экране. */
const ROUNDS: readonly VerbMode[] = ['match', 'sprint', 'search'];

function readStudy(): Study {
  try {
    const saved = globalThis.localStorage?.getItem(STUDY_STORE);
    return STUDIES.find((s) => s === saved) ?? 'type';
  } catch {
    return 'type';
  }
}

function writeStudy(study: Study) {
  try {
    globalThis.localStorage?.setItem(STUDY_STORE, study);
  } catch {
    // Хранилище недоступно — выбор живёт до перезагрузки.
  }
}

export function EnglishVerbs() {
  const q = useEnglishVerbs();
  // Уже загруженное держим на экране: сбой фонового обновления не должен сносить занятие.
  if (q.data) return <VerbsHome o={q.data} />;
  if (q.isError) return <Denied error={q.error} />;
  return <p className="later">Загружаю глаголы…</p>;
}

/** Самое тревожное состояние в группе — цветом точки. */
function groupTone(s: Pick<GroupStat, 'hard' | 'due' | 'learned' | 'started' | 'verbs'>): Tone {
  if (s.hard > 0) return 'hard';
  if (s.due > 0) return 'due';
  if (s.verbs.length > 0 && s.learned === s.verbs.length) return 'learned';
  return s.started > 0 ? 'wait' : 'new';
}

/** Что открыто в окне: группа по звучанию или свой набор. */
interface Opened {
  title: string;
  hint: ReactNode;
  verbs: Verb[];
  scope: Scope;
  /** Свой набор — его можно удалить. */
  set?: string;
}

function VerbsHome({ o }: { o: VerbsOverview }) {
  const qc = useQueryClient();
  const [study, setStudy] = useState<Study>(readStudy);
  const [session, setSession] = useState<Session | null>(null);
  // Ключ занятия, которое сейчас на экране (для отложенного «Ещё глаголы»).
  const active = useRef<number | null>(null);
  // Содержимое окна остаётся на экране, пока окно закрывается.
  const [opened, setOpened] = useState<Opened | null>(null);
  const [sheet, setSheet] = useState(false);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stats = useMemo(() => groupStats(o), [o]);
  const byId = useMemo(() => new Map(o.verbs.map((v) => [v.id, v])), [o.verbs]);

  const start = (mode: VerbMode, scope: Scope, title: string, verbs = o.verbs) => {
    const game = GAMES.find((g) => g.id === mode);
    const picked = game
      ? { ids: pickGame(verbs, scope, game.size), ahead: false }
      : pickSession(verbs, scope);
    if (picked.ids.length === 0) return false;
    const key = Date.now();
    active.current = key;
    setSession({ ...picked, key, title, scope, mode });
    return true;
  };
  const refresh = async () => {
    void qc.invalidateQueries({ queryKey: ENGLISH_HOME });
    await qc.invalidateQueries({ queryKey: ENGLISH_VERBS });
    return qc.getQueryData<VerbsOverview>(ENGLISH_VERBS);
  };
  const close = () => {
    active.current = null;
    setSession(null);
    void refresh();
  };
  const more = async () => {
    if (!session) return;
    const fresh = await refresh();
    // Пока список обновлялся, занятие могли закрыть или начать другое — тогда не открываем.
    if (active.current !== session.key) return;
    if (!start(session.mode, session.scope, session.title, fresh?.verbs ?? o.verbs)) close();
  };
  const open = (next: Opened) => {
    setErr(null);
    setOpened(next);
    setSheet(true);
  };
  const removeSet = async (id: string) => {
    setErr(null);
    try {
      qc.setQueryData(ENGLISH_VERBS, await deleteVerbSet(id));
      setSheet(false);
    } catch (e) {
      setErr(say(e));
    }
  };

  const { counts } = o;
  return (
    <div className="eng-stack">
      <section className="eng-card" aria-label="Неправильные глаголы">
        <p className="eng-hint">Неправильные глаголы · {counts.total}</p>
        <h3 className="eng-h">{headline(o)}</h3>
        <ul className="vb-counts" aria-label="Прогресс">
          <li>
            <b>{counts.started}</b> начато
          </li>
          <li>
            <b>{counts.learned}</b> выучено
          </li>
          <li data-tone={counts.hard > 0 ? 'hard' : undefined}>
            <b>{counts.hard}</b> трудных
          </li>
        </ul>
        <Segmented<Study>
          label="Как заниматься"
          value={study}
          onChange={(v) => {
            setStudy(v);
            writeStudy(v);
          }}
          options={[
            { value: 'type', label: 'Вписать формы' },
            { value: 'cards', label: 'Карточки' },
            { value: 'speak', label: 'Вслух' },
          ]}
        />
        <div className="eng-row">
          <Button variant="fill" onClick={() => start(study, {}, 'Неправильные глаголы')}>
            {counts.due > 0 ? 'Повторить' : 'Заниматься'}
          </Button>
          {counts.hard > 0 && (
            <Button onClick={() => start(study, { hard: true }, 'Трудные глаголы')}>
              Трудные: {counts.hard}
            </Button>
          )}
        </div>
      </section>

      <SecHead text="ИГРЫ" label="Игры" />
      <div className="vb-games">
        {GAMES.map((g) => (
          <Button
            key={g.id}
            dot={false}
            className="vb-game"
            aria-label={`${g.title}: ${g.about}`}
            onClick={() => start(g.id, {}, g.title)}
          >
            <b>{g.title}</b>
            <em>{g.about}</em>
          </Button>
        ))}
      </div>

      <SecHead text="МОИ НАБОРЫ" label="Мои наборы">
        <Button size="sm" onClick={() => setAdding(true)}>
          Добавить
        </Button>
      </SecHead>
      {o.sets.length === 0 ? (
        <p className="eng-hint">
          Добавь свои слова списком или с фото — например, домашку с доски. Они будут учиться вместе
          с остальными.
        </p>
      ) : (
        <ul className="vb-groups">
          {o.sets.map((set) => {
            const verbs = set.verb_ids.flatMap((id) => byId.get(id) ?? []);
            const learned = verbs.filter((v) => v.progress.learned).length;
            const due = verbs.filter((v) => !v.progress.new && v.progress.due).length;
            const state = {
              verbs,
              learned,
              due,
              hard: verbs.filter((v) => v.progress.hard).length,
              started: verbs.filter((v) => !v.progress.new).length,
            };
            const from = set.source === 'photo' ? 'с фото' : 'списком';
            return (
              <li key={set.id}>
                <button
                  type="button"
                  className="vb-group"
                  onClick={() =>
                    open({
                      title: set.title,
                      hint: `Свой набор — добавлен ${from}`,
                      verbs,
                      scope: { ids: set.verb_ids },
                      set: set.id,
                    })
                  }
                >
                  <span className="vb-dot" data-tone={groupTone(state)} aria-hidden="true" />
                  <span className="vb-group-t">
                    <b>{set.title}</b>
                    <em>{from}</em>
                  </span>
                  <span className="vb-group-n">
                    {learned} из {verbs.length}
                    {due > 0 && <i>повторить {due}</i>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <SecHead text="ГРУППЫ" label="Группы по звучанию">
        <span className="n">{stats.length}</span>
      </SecHead>
      <ul className="vb-groups">
        {stats.map((s) => (
          <li key={s.group.id}>
            <button
              type="button"
              className="vb-group"
              onClick={() =>
                open({
                  title: s.group.title_ru,
                  hint: (
                    <>
                      Меняются одинаково: <span lang="en">{s.group.hint}</span>
                    </>
                  ),
                  verbs: s.verbs,
                  scope: { group: s.group.id },
                })
              }
            >
              <span className="vb-dot" data-tone={groupTone(s)} aria-hidden="true" />
              <span className="vb-group-t">
                <b>{s.group.title_ru}</b>
                <em lang="en">{s.group.hint}</em>
              </span>
              <span className="vb-group-n">
                {s.learned} из {s.verbs.length}
                {s.due > 0 && <i>повторить {s.due}</i>}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title={opened?.title ?? 'Глаголы'}
        footer={
          opened && (
            <div className="eng-row">
              <Button
                variant="fill"
                onClick={() => {
                  setSheet(false);
                  start(study, opened.scope, opened.title);
                }}
              >
                {opened.set ? 'Учить набор' : 'Учить группу'}
              </Button>
              {opened.set && (
                <Button variant="quiet" onClick={() => void removeSet(opened.set!)}>
                  Удалить набор
                </Button>
              )}
            </div>
          )
        }
      >
        {opened && (
          <>
            <p className="eng-hint">{opened.hint}</p>
            {err && <Note tone="bad">{err}</Note>}
            <VerbRows verbs={opened.verbs} today={o.today} />
          </>
        )}
      </Sheet>

      <AddWords
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={(next) => {
          qc.setQueryData(ENGLISH_VERBS, next);
          setAdding(false);
        }}
      />

      {session && (
        <LessonScreen label="Тренажёр глаголов" onClose={close}>
          {ROUNDS.includes(session.mode) ? (
            <VerbRound
              key={session.key}
              o={o}
              session={session}
              onClose={close}
              onMore={() => void more()}
            />
          ) : (
            <VerbSession
              key={session.key}
              o={o}
              session={session}
              onClose={close}
              onMore={() => void more()}
            />
          )}
        </LessonScreen>
      )}
    </div>
  );
}

type Phase = 'intro' | 'ask' | 'result';

const KIND: Partial<Record<VerbMode, string>> = {
  type: 'Впиши вторую и третью форму',
  cards: 'Вспомни вторую и третью форму',
  speak: 'Скажи вслух три формы подряд',
};

/** Занятие по одному глаголу за раз: письменно, карточками, вслух, викторина, анаграмма. */
function VerbSession({
  o,
  session,
  onClose,
  onMore,
}: {
  o: VerbsOverview;
  session: Session;
  onClose: () => void;
  onMore: () => void;
}) {
  const nate = useRef<CompanionHandle>(null);
  const second = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(o.verbs.map((v) => [v.id, v])), [o.verbs]);
  const fresh = useMemo(
    () => session.ids.flatMap((id) => byId.get(id) ?? []).filter((v) => v.progress.new),
    [session.ids, byId],
  );
  const { mode } = session;
  const typing = mode === 'type';
  // Письменно и вслух новые глаголы сначала показываем: спрашивать незнакомое нечестно.
  const teach = (typing || mode === 'speak') && fresh.length > 0;
  const [phase, setPhase] = useState<Phase>(teach ? 'intro' : 'ask');
  const [queue, setQueue] = useState(() => startQueue(session.ids));
  const [v2, setV2] = useState('');
  const [v3, setV3] = useState('');
  const [shown, setShown] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [built, setBuilt] = useState<number[]>([]);
  const [heard, setHeard] = useState<string | null>(null);
  const [answered, setAnswered] = useState<VerbAnswered | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [score, setScore] = useState(EMPTY_TALLY);
  const dict = useDictation('en');
  const settled = useRefreshIfClosed();
  const mic = canRecord();
  const verb = byId.get(queue.ids[queue.at] ?? '');
  const total = queue.ids.length;
  const seed = `${session.key}:${queue.at}`;
  const quiz = useMemo(
    () => (mode === 'quiz' && verb ? question(verb, o.verbs, seed) : null),
    [mode, verb, o.verbs, seed],
  );
  const puzzle = useMemo(
    () => (mode === 'anagram' && verb ? anagram(verb, seed) : null),
    [mode, verb, seed],
  );

  const step = (correct: boolean) => {
    const next = advance(queue, correct);
    setQueue(next);
    setAnswered(null);
    setV2('');
    setV3('');
    setShown(false);
    setPicked(null);
    setBuilt([]);
    setHeard(null);
    setErr(null);
    nate.current?.setMood('idle');
    if (done(next)) setPhase('result');
  };
  const send = async (reply: VerbReply): Promise<VerbAnswered | null> => {
    if (!verb || busy) return null;
    setBusy(true);
    setErr(null);
    nate.current?.setMood('think');
    try {
      const a = await answerVerb(verb.id, mode, reply);
      settled();
      playCue(a.correct ? 'ok' : 'bad');
      nate.current?.setMood(a.correct ? 'happy' : 'angry');
      setScore((s) => tally(s, verb.id, a.correct, a.game.xp));
      return a;
    } catch (e) {
      setErr(say(e));
      nate.current?.setMood('idle');
      return null;
    } finally {
      setBusy(false);
    }
  };
  const check = async (e: FormEvent) => {
    e.preventDefault();
    if (answered || busy || !v2.trim()) return;
    if (!v3.trim()) {
      second.current?.focus();
      return;
    }
    const a = await send({ given: { v2: v2.trim(), v3: v3.trim() } });
    if (a) setAnswered(a);
  };
  const grade = async (g: VerbGrade) => {
    const a = await send({ grade: g });
    if (a) step(a.correct);
  };
  const choose = async (option: string) => {
    if (!quiz || picked) return;
    setPicked(option);
    const a = await send({ correct: option === quiz.answer });
    if (a) setAnswered(a);
    else setPicked(null);
  };
  const assemble = async () => {
    if (!puzzle || !verb) return;
    const word = built.map((i) => puzzle.letters[i]).join('');
    const a = await send({ correct: anagramOk(verb, puzzle.form, word) });
    if (a) setAnswered(a);
  };
  const talk = async () => {
    if (dict.state !== 'listening') {
      setErr(null);
      await dict.start();
      return;
    }
    const said = (await dict.stop()).trim();
    if (!said) {
      setErr('Не расслышал — скажи ещё раз, ближе к микрофону.');
      return;
    }
    setHeard(said);
    const a = await send({ said });
    if (a) setAnswered(a);
  };

  const ready = v2.trim() !== '' && v3.trim() !== '';
  const listening = dict.state === 'listening';
  const view: BarView =
    phase !== 'ask'
      ? phase
      : answered
        ? 'answered'
        : mode === 'cards' && shown
          ? 'grade'
          : mode === 'quiz'
            ? 'wait'
            : 'check';
  return (
    <TrainerShell
      nate={nate}
      title={session.title}
      phase={
        phase === 'intro'
          ? 'Новые глаголы'
          : phase === 'result'
            ? 'Итог'
            : `Глагол ${queue.at + 1} из ${total}`
      }
      progress={
        phase === 'ask' && (
          <Progress
            label="Ход занятия"
            total={total}
            done={queue.at + (answered ? 1 : 0)}
            now={answered ? null : queue.at}
          />
        )
      }
      onClose={() => {
        dict.cancel();
        onClose();
      }}
      view={view}
      verdict={answered ? (answered.correct ? 'ok' : 'wrong') : null}
      bar={
        <>
          {phase === 'intro' && (
            <Button variant="fill" autoFocus onClick={() => setPhase('ask')}>
              Запомнил — проверь
            </Button>
          )}
          {phase === 'ask' && answered && (
            <>
              <p>{answered.correct ? 'Верно!' : `Правильно: ${line(answered.expected)}`}</p>
              <Button variant="fill" autoFocus onClick={() => step(answered.correct)}>
                {queue.at + 1 < total || !answered.correct ? 'Дальше' : 'Итог'}
              </Button>
            </>
          )}
          {phase === 'ask' && !answered && typing && (
            <Button variant="fill" type="submit" form="vb-forms" disabled={busy || !ready}>
              {busy ? 'Проверяю…' : 'Проверить'}
            </Button>
          )}
          {phase === 'ask' && !answered && mode === 'cards' && !shown && (
            <Button variant="fill" autoFocus onClick={() => setShown(true)}>
              Показать формы
            </Button>
          )}
          {phase === 'ask' && !answered && mode === 'cards' && shown && (
            <div className="eng-row">
              <Button disabled={busy} onClick={() => void grade('again')}>
                Не знал
              </Button>
              <Button variant="fill" disabled={busy} onClick={() => void grade('good')}>
                Знал
              </Button>
              <Button disabled={busy} onClick={() => void grade('easy')}>
                Легко
              </Button>
            </div>
          )}
          {phase === 'ask' && !answered && mode === 'speak' && (
            <Button
              variant="fill"
              aria-pressed={listening}
              disabled={!mic || busy || dict.state === 'working'}
              onClick={() => void talk()}
            >
              {listening ? 'Готово' : dict.state === 'working' || busy ? 'Слушаю…' : 'Сказать'}
            </Button>
          )}
          {phase === 'ask' && !answered && mode === 'quiz' && (
            <p className="eng-hint">{busy ? 'Проверяю…' : 'Выбери ответ'}</p>
          )}
          {phase === 'ask' && !answered && puzzle && (
            <Button
              variant="fill"
              disabled={busy || built.length < puzzle.letters.length}
              onClick={() => void assemble()}
            >
              {busy ? 'Проверяю…' : 'Проверить'}
            </Button>
          )}
          {phase === 'result' && <ResultBar onClose={onClose} onMore={onMore} />}
        </>
      }
    >
      {phase === 'intro' && (
        <section className="eng-card" aria-label="Новые глаголы">
          <p className="eng-kind">Посмотри и запомни</p>
          <p>
            Это новые глаголы. Прочитай формы — можно вслух — и я спрошу их{' '}
            {typing ? 'письменно' : 'вслух'}.
          </p>
          <VerbRows verbs={fresh} as="new" />
        </section>
      )}
      {phase === 'ask' && verb && (
        <section className="eng-card eng-task" aria-label="Глагол">
          <p className="eng-kind">
            {quiz
              ? quiz.form === 'v2'
                ? 'Какая вторая форма (V2)?'
                : 'Какая третья форма (V3)?'
              : puzzle
                ? `Собери из букв ${puzzle.form === 'v2' ? 'вторую форму (V2)' : 'третью форму (V3)'}`
                : KIND[mode]}
          </p>
          <p className="vb-word" lang="en">
            {verb.v1}
          </p>
          <p className="eng-hint">{verb.ru}</p>
          {typing && (
            <form id="vb-forms" className="eng-gaps" onSubmit={(e) => void check(e)}>
              <Field
                key={`v2:${queue.at}`}
                label="Вторая форма (V2)"
                lang="en"
                value={v2}
                onChange={(e) => setV2(e.target.value)}
                disabled={busy || !!answered}
                error={
                  answered && !formOk(v2, verb.v2, verb.v2_alt) ? `Правильно: ${verb.v2}` : null
                }
                maxLength={60}
                autoFocus
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
              />
              <Field
                key={`v3:${queue.at}`}
                ref={second}
                label="Третья форма (V3)"
                lang="en"
                value={v3}
                onChange={(e) => setV3(e.target.value)}
                disabled={busy || !!answered}
                error={
                  answered && !formOk(v3, verb.v3, verb.v3_alt) ? `Правильно: ${verb.v3}` : null
                }
                maxLength={60}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
            </form>
          )}
          {mode === 'cards' && (
            <Presence show={shown}>
              <p className="vb-answer" lang="en">
                {verb.v2} · {verb.v3}
              </p>
              {(verb.v2_alt.length > 0 || verb.v3_alt.length > 0) && (
                <p className="eng-hint">
                  Можно и так: <span lang="en">{[...verb.v2_alt, ...verb.v3_alt].join(', ')}</span>
                </p>
              )}
            </Presence>
          )}
          {mode === 'speak' && (
            <>
              {!mic && (
                <Note>Микрофон здесь недоступен — выбери «Вписать формы» или «Карточки».</Note>
              )}
              {listening && (
                <p className="eng-hint" role="status">
                  Нейт слушает{dict.partial ? `: «${dict.partial}»` : '…'}
                </p>
              )}
              {heard && (
                <p className="eng-hint">
                  Нейт услышал: <span lang="en">«{heard}»</span>
                </p>
              )}
              {dict.error && (
                <p className="eng-hint" role="status">
                  {dict.error}
                </p>
              )}
            </>
          )}
          {quiz && (
            <div className="eng-options" role="group" aria-label="Варианты">
              {quiz.options.map((option) => (
                <Button
                  key={option}
                  dot={false}
                  className="eng-opt"
                  data-state={
                    answered
                      ? option === quiz.answer
                        ? 'ok'
                        : option === picked
                          ? 'bad'
                          : undefined
                      : option === picked
                        ? 'picked'
                        : undefined
                  }
                  disabled={!!picked}
                  onClick={() => void choose(option)}
                >
                  <span lang="en">{option}</span>
                </Button>
              ))}
            </div>
          )}
          {puzzle && (
            <>
              <div className="vb-built" role="group" aria-label="Собрано">
                {built.length === 0 && <span className="eng-hint">Нажимай буквы по порядку</span>}
                {built.map((i, at) => (
                  <Button
                    key={i}
                    dot={false}
                    className="eng-opt eng-tile vb-letter"
                    data-state="picked"
                    disabled={!!answered}
                    aria-label={`${puzzle.letters[i]}, убрать`}
                    onClick={() => setBuilt(built.filter((_, n) => n !== at))}
                  >
                    <span lang="en">{puzzle.letters[i]}</span>
                  </Button>
                ))}
              </div>
              <div className="eng-options" role="group" aria-label="Буквы">
                {puzzle.letters.map((letter, i) => (
                  <Button
                    key={i}
                    dot={false}
                    className="eng-opt eng-tile vb-letter"
                    disabled={!!answered || built.includes(i)}
                    onClick={() => setBuilt([...built, i])}
                  >
                    <span lang="en">{letter}</span>
                  </Button>
                ))}
              </div>
            </>
          )}
          {answered && <Gain d={answered.game} />}
        </section>
      )}
      {phase === 'result' && <SessionResult score={score} verbs={byId} ahead={session.ahead} />}
      {err && <Note tone="bad">{err}</Note>}
    </TrainerShell>
  );
}
