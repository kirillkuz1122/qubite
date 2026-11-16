/**
 * Вкладка «Глаголы» в «Английском» (ENG-008, D-887…D-889, D-897): ~150 неправильных глаголов
 * группами по звучанию и тренажёр с интервальным повторением. Заниматься можно письменно («впиши
 * вторую и третью форму» — главное) или карточками («знал / не знал / легко»). Новые глаголы
 * сначала показываем, потом спрашиваем; на котором ошибся — спросим ещё раз через пару других.
 * Сверку, срок повторения, минуты и опыт считает сервер.
 */
import {
  Button,
  Companion,
  Field,
  Note,
  Presence,
  Segmented,
  Sheet,
  Swap,
  useMedia,
  WIDE,
  type CompanionHandle,
} from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { say } from '../auth/client';
import { playCue } from './english-feedback';
import { ENGLISH_HOME } from './english-lessons';
import { Denied, Gain, LessonScreen, Progress } from './EnglishParts';
import {
  answerVerb,
  ENGLISH_VERBS,
  useEnglishVerbs,
  type Verb,
  type VerbAnswered,
  type VerbGrade,
  type VerbReply,
  type VerbsOverview,
} from './english-verbs';
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
  stateLabel,
  tally,
  tone,
  whenLabel,
  type GroupStat,
  type Picked,
  type Scope,
  type Tone,
} from './english-verbs-view';
import { SecHead } from './parts';

/** Как заниматься: письменно или карточками. */
type Study = 'type' | 'cards';
const STUDIES: readonly Study[] = ['type', 'cards'];
const STUDY_STORE = 'qubite.english.verbs.study';

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

interface Session extends Picked {
  /** Меняется с каждым новым занятием: экран начинает с чистого листа. */
  key: number;
  title: string;
  scope: Scope;
  study: Study;
}

export function EnglishVerbs() {
  const q = useEnglishVerbs();
  // Уже загруженное держим на экране: сбой фонового обновления не должен сносить занятие.
  if (q.data) return <VerbsHome o={q.data} />;
  if (q.isError) return <Denied error={q.error} />;
  return <p className="later">Загружаю глаголы…</p>;
}

/** Самое тревожное состояние в группе — цветом точки. */
function groupTone(s: GroupStat): Tone {
  if (s.hard > 0) return 'hard';
  if (s.due > 0) return 'due';
  if (s.learned === s.verbs.length) return 'learned';
  return s.started > 0 ? 'wait' : 'new';
}

function VerbsHome({ o }: { o: VerbsOverview }) {
  const qc = useQueryClient();
  const [study, setStudy] = useState<Study>(readStudy);
  const [session, setSession] = useState<Session | null>(null);
  // Ключ занятия, которое сейчас на экране (для отложенного «Ещё глаголы»).
  const active = useRef<number | null>(null);
  // Группа остаётся на экране, пока окно закрывается.
  const [group, setGroup] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const stats = useMemo(() => groupStats(o), [o]);
  const opened = stats.find((s) => s.group.id === group) ?? null;

  const start = (scope: Scope, title: string, verbs = o.verbs) => {
    const picked = pickSession(verbs, scope);
    if (picked.ids.length === 0) return false;
    const key = Date.now();
    active.current = key;
    setSession({ ...picked, key, title, scope, study });
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
    if (!start(session.scope, session.title, fresh?.verbs ?? o.verbs)) close();
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
          ]}
        />
        <div className="eng-row">
          <Button variant="fill" onClick={() => start({}, 'Неправильные глаголы')}>
            {counts.due > 0 ? 'Повторить' : 'Заниматься'}
          </Button>
          {counts.hard > 0 && (
            <Button onClick={() => start({ hard: true }, 'Трудные глаголы')}>
              Трудные: {counts.hard}
            </Button>
          )}
        </div>
      </section>

      <SecHead text="ГРУППЫ" label="Группы по звучанию">
        <span className="n">{stats.length}</span>
      </SecHead>
      <ul className="vb-groups">
        {stats.map((s) => (
          <li key={s.group.id}>
            <button
              type="button"
              className="vb-group"
              onClick={() => {
                setGroup(s.group.id);
                setSheet(true);
              }}
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
        title={opened?.group.title_ru ?? 'Группа'}
        footer={
          opened && (
            <Button
              variant="fill"
              onClick={() => {
                setSheet(false);
                start({ group: opened.group.id }, opened.group.title_ru);
              }}
            >
              Учить группу
            </Button>
          )
        }
      >
        {opened && (
          <>
            <p className="eng-hint">
              Меняются одинаково: <span lang="en">{opened.group.hint}</span>
            </p>
            <VerbRows verbs={opened.verbs} today={o.today} />
          </>
        )}
      </Sheet>

      {session && (
        <LessonScreen label="Тренажёр глаголов" onClose={close}>
          <VerbSession
            key={session.key}
            o={o}
            session={session}
            onClose={close}
            onMore={() => void more()}
          />
        </LessonScreen>
      )}
    </div>
  );
}

/** Глаголы списком: три формы, перевод, что с глаголом и когда повторять. */
function VerbRows({ verbs, today }: { verbs: readonly Verb[]; today: string }) {
  return (
    <ul className="vb-rows">
      {verbs.map((v) => (
        <li key={v.id}>
          <span className="vb-dot" data-tone={tone(v.progress)} aria-hidden="true" />
          <span className="vb-row-t">
            <b lang="en">{line(v)}</b>
            <em>
              {v.ru}
              {!v.progress.new && ` · ${stateLabel(v.progress)}`}
            </em>
          </span>
          <span className="vb-row-when">{whenLabel(v.progress, today)}</span>
        </li>
      ))}
    </ul>
  );
}

type Phase = 'intro' | 'ask' | 'result';

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
  const wide = useMedia(WIDE);
  const nate = useRef<CompanionHandle>(null);
  const second = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(o.verbs.map((v) => [v.id, v])), [o.verbs]);
  const fresh = useMemo(
    () => session.ids.flatMap((id) => byId.get(id) ?? []).filter((v) => v.progress.new),
    [session.ids, byId],
  );
  const typing = session.study === 'type';
  const [phase, setPhase] = useState<Phase>(typing && fresh.length > 0 ? 'intro' : 'ask');
  const [queue, setQueue] = useState(() => startQueue(session.ids));
  const [v2, setV2] = useState('');
  const [v3, setV3] = useState('');
  const [shown, setShown] = useState(false);
  const [answered, setAnswered] = useState<VerbAnswered | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [score, setScore] = useState(EMPTY_TALLY);
  const verb = byId.get(queue.ids[queue.at] ?? '');
  const total = queue.ids.length;

  const step = (correct: boolean) => {
    const next = advance(queue, correct);
    setQueue(next);
    setAnswered(null);
    setV2('');
    setV3('');
    setShown(false);
    nate.current?.setMood('idle');
    if (done(next)) setPhase('result');
  };
  const send = async (reply: VerbReply): Promise<VerbAnswered | null> => {
    if (!verb || busy) return null;
    setBusy(true);
    setErr(null);
    nate.current?.setMood('think');
    try {
      const a = await answerVerb(verb.id, session.study, reply);
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
    if (answered || busy) return;
    if (!v2.trim()) return;
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

  const ready = v2.trim() !== '' && v3.trim() !== '';
  return (
    <div className="eng-lesson">
      <header className="eng-stage">
        <Companion ref={nate} kind="neit" pitch={wide ? 6 : 4} label="Нейт — репетитор" />
        <div className="eng-who">
          <b>{session.title}</b>
          <span className="eng-phase">
            {phase === 'intro' && 'Новые глаголы'}
            {phase === 'ask' && verb && `Глагол ${queue.at + 1} из ${total}`}
            {phase === 'result' && 'Итог'}
          </span>
          {phase === 'ask' && (
            <Progress
              label="Ход занятия"
              total={total}
              done={queue.at + (answered ? 1 : 0)}
              now={answered ? null : queue.at}
            />
          )}
        </div>
        <Button size="sm" dot={false} onClick={onClose} className="eng-close">
          Закрыть
        </Button>
      </header>
      <section className="eng-lesson-work" aria-label={phase === 'ask' ? 'Глагол' : undefined}>
        <div className="eng-lesson-content">
          <div className="eng-lesson-column">
            {phase === 'intro' && (
              <section className="eng-card" aria-label="Новые глаголы">
                <p className="eng-kind">Посмотри и запомни</p>
                <p>Это новые глаголы. Прочитай формы — можно вслух — и я спрошу их письменно.</p>
                <ul className="vb-rows">
                  {fresh.map((v) => (
                    <li key={v.id}>
                      <span className="vb-dot" data-tone="new" aria-hidden="true" />
                      <span className="vb-row-t">
                        <b lang="en">{line(v)}</b>
                        <em>{v.ru}</em>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {phase === 'ask' && verb && (
              <section className="eng-card eng-task">
                <p className="eng-kind">
                  {typing ? 'Впиши вторую и третью форму' : 'Вспомни вторую и третью форму'}
                </p>
                <p className="vb-word" lang="en">
                  {verb.v1}
                </p>
                <p className="eng-hint">{verb.ru}</p>
                {typing ? (
                  <form id="vb-forms" className="eng-gaps" onSubmit={(e) => void check(e)}>
                    <Field
                      key={`v2:${queue.at}`}
                      label="Вторая форма (V2)"
                      lang="en"
                      value={v2}
                      onChange={(e) => setV2(e.target.value)}
                      disabled={busy || !!answered}
                      error={
                        answered && !formOk(v2, verb.v2, verb.v2_alt)
                          ? `Правильно: ${verb.v2}`
                          : null
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
                        answered && !formOk(v3, verb.v3, verb.v3_alt)
                          ? `Правильно: ${verb.v3}`
                          : null
                      }
                      maxLength={60}
                      autoCapitalize="none"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
                  </form>
                ) : (
                  <Presence show={shown}>
                    <p className="vb-answer" lang="en">
                      {verb.v2} · {verb.v3}
                    </p>
                    {(verb.v2_alt.length > 0 || verb.v3_alt.length > 0) && (
                      <p className="eng-hint">
                        Можно и так:{' '}
                        <span lang="en">{[...verb.v2_alt, ...verb.v3_alt].join(', ')}</span>
                      </p>
                    )}
                  </Presence>
                )}
                {answered && <Gain d={answered.game} />}
              </section>
            )}
            {phase === 'result' && (
              <section className="eng-card" aria-label="Итог занятия">
                <h3 className="eng-h">Занятие закончено</h3>
                <p>
                  С первого раза: {score.clean.length} из {score.clean.length + score.missed.length}
                </p>
                {score.missed.length > 0 && (
                  <>
                    <p className="eng-hint">Эти вернутся раньше остальных:</p>
                    <ul className="vb-rows">
                      {score.missed
                        .flatMap((id) => byId.get(id) ?? [])
                        .map((v) => (
                          <li key={v.id}>
                            <span className="vb-dot" data-tone="hard" aria-hidden="true" />
                            <span className="vb-row-t">
                              <b lang="en">{line(v)}</b>
                              <em>{v.ru}</em>
                            </span>
                          </li>
                        ))}
                    </ul>
                  </>
                )}
                {score.xp > 0 && <p className="eng-gain">+{score.xp} XP</p>}
                {session.ahead && (
                  <p className="eng-hint">
                    Это было занятие впрок: срок повторения оно не сдвигает, ошибки — учитывает.
                  </p>
                )}
              </section>
            )}
            {err && <Note tone="bad">{err}</Note>}
          </div>
        </div>
        <footer className="eng-lesson-bottom">
          <div className="eng-lesson-column">
            <div
              className="eng-answer-bar"
              data-ok={answered?.correct ? '' : undefined}
              data-wrong={answered && !answered.correct ? '' : undefined}
            >
              <Swap
                className="eng-answer-bar-content"
                view={phase !== 'ask' ? phase : answered ? 'answered' : shown ? 'grade' : 'check'}
                order={['intro', 'check', 'grade', 'answered', 'result']}
              >
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
                {phase === 'ask' && !answered && !typing && !shown && (
                  <Button variant="fill" autoFocus onClick={() => setShown(true)}>
                    Показать формы
                  </Button>
                )}
                {phase === 'ask' && !answered && !typing && shown && (
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
                {phase === 'result' && (
                  <div className="eng-row">
                    <Button onClick={onClose}>Готово</Button>
                    <Button variant="fill" autoFocus onClick={onMore}>
                      Ещё глаголы
                    </Button>
                  </div>
                )}
              </Swap>
            </div>
          </div>
        </footer>
      </section>
    </div>
  );
}
