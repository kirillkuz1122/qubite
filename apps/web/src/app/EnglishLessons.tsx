/**
 * «Английский» как модуль (ENG-002, D-480): уроки по программе ENG-000, разговор с Нейтом
 * (ENG-001), игра и настройки. Урок: теория, которую Нейт объясняет на языке уровня, → задания как
 * в Duolingo (выбрать, соединить, собрать, вставить, перевести, на слух без текста, сказать вслух,
 * описать картинку, роль) → итог: огонёк, опыт, домашка делом в Planner, разбор ошибок. Спросить
 * Нейта можно в любой момент — и по-русски (D-491). Сверку, опыт и огонёк считает сервер.
 */
import {
  Button,
  Companion,
  Field,
  Note,
  Presence,
  Segmented,
  Swap,
  Switch,
  useMedia,
  WIDE,
  type CompanionHandle,
} from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Fail, say } from '../auth/client';
import { AgentEnglish } from './AgentEnglish';
import { canRecord, record, type Recording } from './english';
import {
  askNate,
  ENGLISH_HOME,
  fetchPhrase,
  finishRun,
  sendAnswer,
  startRun,
  useAdapt,
  useChangeSettings,
  useEnglishHome,
  useEnglishSettings,
  useLesson,
  usePlace,
  usePlacementTest,
  type Answered,
  type Delta,
  type Finished,
  type Game,
  type Home,
  type Reply,
  type Run,
  type SettingsBody,
  type Task,
} from './english-lessons';
import {
  byModule,
  days,
  gaps,
  kindLabel,
  resumeAt,
  ring,
  runTasks,
  spoken,
  theory,
  tiles,
  WEEKDAYS,
} from './english-lessons-view';
import { LimitLink } from './LimitLink';

type Tab = 'lessons' | 'talk' | 'game' | 'settings';
const TABS: readonly Tab[] = ['lessons', 'talk', 'game', 'settings'];

/**
 * Открыть урок по ссылке: `/agent?tab=english&lesson=a0-m1-l1&homework=1` (домашка из Planner);
 * вкладку — `&view=talk`.
 */
function linked(): { lesson: string; kind: Run['kind'] } | null {
  const q = new URLSearchParams(globalThis.location?.search ?? '');
  const lesson = q.get('lesson');
  if (!lesson) return null;
  return { lesson, kind: q.get('homework') ? 'homework' : 'lesson' };
}

/** Проиграть фразу урока голосом Нейта (готовую — бесплатно). */
async function playPhrase(text: string, voice?: string): Promise<void> {
  const blob = await fetchPhrase(text, voice);
  const url = URL.createObjectURL(blob);
  const a = new Audio(url);
  a.onended = () => URL.revokeObjectURL(url);
  await a.play();
}

function Speak({ text, label = 'Послушать' }: { text: string; label?: string }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <Button
        size="sm"
        dot={false}
        onClick={() => {
          setErr(null);
          playPhrase(text).catch((e) => setErr(say(e)));
        }}
      >
        {label}
      </Button>
      {err && (
        <span className="eng-hint" role="status">
          {err}
        </span>
      )}
    </>
  );
}

export function EnglishModule() {
  const [tab, setTab] = useState<Tab>(() => {
    const asked = new URLSearchParams(globalThis.location?.search ?? '').get('view');
    return TABS.find((t) => t === asked) ?? 'lessons';
  });
  const [open, setOpen] = useState<{ lesson: string; kind: Run['kind'] } | null>(linked);
  return (
    <div className="eng">
      <Segmented<Tab>
        label="Английский"
        value={tab}
        variant="chips"
        onChange={(v) => setTab(v)}
        options={[
          { value: 'lessons', label: 'Уроки' },
          { value: 'talk', label: 'Разговор' },
          { value: 'game', label: 'Игра' },
          { value: 'settings', label: 'Настройки' },
        ]}
      />
      <Swap view={tab} order={TABS}>
        {tab === 'lessons' &&
          (open ? (
            <LessonPlayer key={open.lesson + open.kind} {...open} onClose={() => setOpen(null)} />
          ) : (
            <LessonsHome onOpen={(lesson, kind) => setOpen({ lesson, kind })} />
          ))}
        {tab === 'talk' && <AgentEnglish />}
        {tab === 'game' && <GameView />}
        {tab === 'settings' && <SettingsView />}
      </Swap>
    </div>
  );
}

// ---------------------------------------------------------------- главная

function Denied({ error }: { error: unknown }) {
  const denied = error instanceof Fail && error.status === 403;
  return (
    <p className="later" role="status">
      {denied
        ? 'Английский — часть агента: нет доступа к модулю «Агент Qubite». Его включает owner в Console.'
        : say(error)}
    </p>
  );
}

/** Кольцо дня — точками: сколько минут из цели. */
function Ring({ game }: { game: Game }) {
  const dots = 10;
  const lit = Math.round(ring(game) * dots);
  return (
    <div
      className="eng-ring"
      role="img"
      aria-label={`Сегодня ${game.minutes_today} из ${game.goal_minutes} минут`}
    >
      {Array.from({ length: dots }, (_, i) => (
        <span key={i} data-on={i < lit ? '' : undefined} />
      ))}
    </div>
  );
}

function Today({ home }: { home: Home }) {
  const g = home.game;
  return (
    <section className="eng-card eng-today" aria-label="Сегодня">
      <div className="eng-today-row">
        <Ring game={g} />
        <div className="eng-today-text">
          <b>
            {g.minutes_today} из {g.goal_minutes} мин
          </b>
          <span className="eng-hint">
            {g.ring ? 'Цель дня закрыта.' : 'Огонёк — от 5 минут или урока.'}
          </span>
        </div>
        <div className="eng-flame" aria-label={`Огонёк: ${days(g.streak)}`}>
          <b>{g.streak}</b>
          <span>огонёк</span>
        </div>
      </div>
      <ol className="eng-week" aria-label="Неделя">
        {g.week.map((d) => (
          <li
            key={d.day}
            data-on={d.counted ? '' : undefined}
            data-frozen={d.frozen ? '' : undefined}
          >
            <span>{WEEKDAYS[d.weekday - 1]}</span>
          </li>
        ))}
      </ol>
      <p className="eng-hint">
        Звание: <b>{g.rank}</b> · {g.xp} XP
        {g.next_rank && g.next_rank_xp !== null && (
          <>
            {' '}
            · до «{g.next_rank}» — {g.next_rank_xp - g.xp}
          </>
        )}{' '}
        · заморозок {g.freezes} · лучший огонёк {days(g.best_streak)}
      </p>
      {g.frozen > 0 && <Note>Заморозка спасла огонёк ({days(g.frozen)}).</Note>}
      {g.lost_streak > 0 && g.streak === 0 && (
        <Note>
          Огонёк погас — лучший ({days(g.best_streak)}) никуда не делся. Сделай сегодня двойную
          норму, и огонёк в {days(g.lost_streak)} вернётся.
        </Note>
      )}
    </section>
  );
}

function Quests({ game }: { game: Game }) {
  return (
    <section className="eng-card" aria-label="Задания дня">
      <h3 className="eng-h">Задания дня</h3>
      <ul className="eng-quests">
        {game.quests.map((q) => (
          <li key={q.id} data-done={q.done >= q.target ? '' : undefined}>
            <span>{q.title}</span>
            <span className="eng-hint">
              {q.counter === 'seconds'
                ? `${Math.floor(q.done / 60)}/${q.target / 60} мин`
                : `${q.done}/${q.target}`}
            </span>
          </li>
        ))}
      </ul>
      <p className="eng-hint">Все три — +30 XP. Не успел — завтра будут другие, без штрафа.</p>
    </section>
  );
}

function Placement({ onDone }: { onDone: () => void }) {
  const [going, setGoing] = useState(false);
  const test = usePlacementTest(going);
  const place = usePlace();
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [err, setErr] = useState<string | null>(null);
  const items = useMemo(() => test.data?.stages.flatMap((s) => s.items) ?? [], [test.data]);

  const submit = (shift: number, all = answers) => {
    setErr(null);
    place.mutate({ answers: all, shift }, { onSuccess: onDone, onError: (e) => setErr(say(e)) });
  };

  if (!going) {
    return (
      <section className="eng-card eng-start" aria-label="Входной тест">
        <h3 className="eng-h">С чего начнём?</h3>
        <p>
          Короткий тест на 5 минут: 20 вопросов снизу вверх. Нейт поймёт твой уровень и начнёт с
          нужного урока. Потом уровень можно поправить в настройках.
        </p>
        <div className="eng-row">
          <Button variant="fill" onClick={() => setGoing(true)}>
            Пройти тест
          </Button>
          <Button onClick={() => submit(0, {})} disabled={place.isPending}>
            Начать с нуля
          </Button>
        </div>
        {err && <p className="act-error">{err}</p>}
      </section>
    );
  }
  if (test.isError) return <Denied error={test.error} />;
  const item = items[at];
  return (
    <section className="eng-card" aria-label="Входной тест">
      <p className="eng-hint">
        Вопрос {Math.min(at + 1, items.length)} из {items.length || 20}
      </p>
      {item ? (
        <TaskBody
          key={item.id}
          task={item}
          busy={false}
          result={null}
          canMic={false}
          onReply={(r) => {
            const value = 'value' in r ? r.value : '';
            setAnswers((a) => ({ ...a, [item.id]: value }));
            setAt((i) => i + 1);
          }}
        />
      ) : (
        test.data && (
          <div className="eng-start">
            <p>Готово. Как было?</p>
            <div className="eng-row">
              <Button onClick={() => submit(-1)} disabled={place.isPending}>
                Трудно
              </Button>
              <Button variant="fill" onClick={() => submit(0)} disabled={place.isPending}>
                Нормально
              </Button>
              <Button onClick={() => submit(1)} disabled={place.isPending}>
                Легко
              </Button>
            </div>
          </div>
        )
      )}
      {err && <p className="act-error">{err}</p>}
    </section>
  );
}

function LessonsHome({ onOpen }: { onOpen: (lesson: string, kind: Run['kind']) => void }) {
  const q = useEnglishHome();
  const qc = useQueryClient();
  if (q.isError) return <Denied error={q.error} />;
  const home = q.data;
  if (!home) return <p className="later">Загружаю программу…</p>;
  if (!home.learner.placed_at) {
    return <Placement onDone={() => void qc.invalidateQueries({ queryKey: ENGLISH_HOME })} />;
  }
  const next = home.steps.find((s) => s.id === home.next);
  const level = home.levels.find((l) => l.id === home.learner.level);
  const homework = home.steps.filter((s) => s.homework);
  return (
    <>
      <Today home={home} />
      <section className="eng-card eng-next" aria-label="Следующий урок">
        {next ? (
          <>
            <p className="eng-hint">
              Уровень {level?.id.toUpperCase()} · {level?.title_ru}
            </p>
            <h3 className="eng-h">{next.title_ru}</h3>
            <p>{next.goal_ru}</p>
            {next.notes.map((n) => (
              <p key={n} className="eng-hint">
                Нейт: {n}
              </p>
            ))}
            <Button variant="fill" onClick={() => onOpen(next.id, 'lesson')}>
              {next.passed ? 'Повторить урок' : 'Начать урок'}
            </Button>
          </>
        ) : (
          <p>Уроки A0–A2 пройдены. Уроки B1–B2 появятся позже — пока говори с Нейтом.</p>
        )}
      </section>
      {(home.review_due > 0 || homework.length > 0) && (
        <section className="eng-card" aria-label="Повторение и домашка">
          {home.review_due > 0 && (
            <div className="eng-row">
              <span>Повторить ошибки: {home.review_due}</span>
              <Button size="sm" onClick={() => onOpen('review', 'review')}>
                Повторить
              </Button>
            </div>
          )}
          {homework.map((s) => (
            <div key={s.id} className="eng-row">
              <span>Домашка: {s.title_ru}</span>
              <Button size="sm" onClick={() => onOpen(s.id, 'homework')}>
                Сделать
              </Button>
            </div>
          ))}
        </section>
      )}
      <Quests game={home.game} />
      <Path home={home} onOpen={onOpen} />
    </>
  );
}

function Path({ home, onOpen }: { home: Home; onOpen: (l: string, k: Run['kind']) => void }) {
  const [level, setLevel] = useState(home.learner.level);
  return (
    <section className="eng-card" aria-label="Программа">
      <h3 className="eng-h">Программа</h3>
      <Segmented
        label="Уровень"
        variant="chips"
        value={level}
        onChange={(v) => setLevel(v)}
        options={home.levels.map((l) => ({ value: l.id, label: l.id.toUpperCase() }))}
      />
      {byModule(home.steps, level).map((m) => (
        <div key={m.title} className="eng-module">
          <p className="eng-hint">{m.title}</p>
          <ol className="eng-path">
            {m.steps.map((s) => (
              <li
                key={s.id}
                data-passed={s.passed ? '' : undefined}
                data-next={s.id === home.next ? '' : undefined}
              >
                <button
                  type="button"
                  disabled={!s.ready}
                  onClick={() => onOpen(s.id, 'lesson')}
                  aria-label={`${s.title_ru}${s.passed ? ' — пройден' : ''}`}
                >
                  <span className="eng-path-dot" aria-hidden="true" />
                  <span>
                    {s.title_ru}
                    {s.skipped && <em> · пропущен агентом</em>}
                    {s.repeat && <em> · повторить: {s.repeat}</em>}
                    {!s.ready && <em> · скоро</em>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ))}
      {home.ops.length > 0 && (
        <div className="eng-ops">
          <p className="eng-hint">
            Нейт подстроил программу под тебя (откатить — в «Ленте» агента):
          </p>
          <ul>
            {home.ops.map((o) => (
              <li key={o.id}>
                {o.summary}
                {o.state !== 'applied' && <em> · {o.state === 'stale' ? 'устарела' : 'ждёт'}</em>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- урок

type Phase = 'intro' | 'theory' | 'tasks' | 'result';

function LessonPlayer({
  lesson: id,
  kind,
  onClose,
}: {
  lesson: string;
  kind: Run['kind'];
  onClose: () => void;
}) {
  const view = useLesson(kind === 'review' ? null : id);
  const qc = useQueryClient();
  const nate = useRef<CompanionHandle>(null);
  const wide = useMedia(WIDE);
  const [phase, setPhase] = useState<Phase>(kind === 'lesson' ? 'theory' : 'intro');
  const [run, setRun] = useState<Run | null>(null);
  const [at, setAt] = useState(0);
  const [result, setResult] = useState<Answered | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; code: string | null } | null>(null);
  const [done, setDone] = useState<Finished | null>(null);
  const [toast, setToast] = useState<Delta | null>(null);
  const lesson = view.data?.lesson ?? null;
  const list = useMemo(() => (run ? runTasks(lesson, run) : []), [lesson, run]);

  const begin = async () => {
    setErr(null);
    try {
      const r = await startRun(kind === 'review' ? 'review' : id, kind);
      setRun(r);
      setAt(resumeAt(r, kind === 'review' ? runTasks(null, r) : runTasks(lesson, r)));
      setPhase('tasks');
    } catch (e) {
      setErr({ text: say(e), code: e instanceof Fail ? e.code : null });
    }
  };

  const reply = async (r: Reply) => {
    const item = list[at];
    if (!run || !item) return;
    setBusy(true);
    setErr(null);
    nate.current?.setMood('think');
    try {
      const a = await sendAnswer(run.id, item.task.id, r, item.lesson);
      setResult(a);
      setToast(a.game);
      nate.current?.setMood(a.correct ? 'happy' : 'angry');
      if (a.correct) nate.current?.jump();
    } catch (e) {
      nate.current?.setMood('idle');
      setErr({ text: say(e), code: e instanceof Fail ? e.code : null });
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    setResult(null);
    nate.current?.setMood('idle');
    if (at + 1 < list.length) {
      setAt(at + 1);
      return;
    }
    if (!run) return;
    setBusy(true);
    try {
      const f = await finishRun(run.id);
      setDone(f);
      setPhase('result');
      if (f.passed) nate.current?.jump();
      void qc.invalidateQueries({ queryKey: ENGLISH_HOME });
    } catch (e) {
      setErr({ text: say(e), code: e instanceof Fail ? e.code : null });
    } finally {
      setBusy(false);
    }
  };

  if (view.isError) return <Denied error={view.error} />;
  if (kind !== 'review' && !view.data) return <p className="later">Загружаю урок…</p>;
  const item = list[at];
  const title =
    kind === 'review'
      ? 'Повторение ошибок'
      : `${kind === 'homework' ? 'Домашка: ' : ''}${lesson?.title.ru ?? ''}`;

  return (
    <div className="eng-lesson">
      <div className="eng-stage">
        <Companion ref={nate} kind="neit" pitch={wide ? 6 : 5} label="Нейт — репетитор" />
        <div className="eng-who">
          <b>{title}</b>
          <span className="eng-phase">
            {phase === 'theory' && 'Нейт объясняет'}
            {phase === 'tasks' && item && `Задание ${at + 1} из ${list.length}`}
            {phase === 'result' && 'Итог'}
          </span>
        </div>
        <Button size="sm" dot={false} onClick={onClose} className="eng-close">
          Выйти
        </Button>
      </div>

      {phase === 'intro' && (
        <section className="eng-card eng-start" aria-label="Начать">
          <p>
            {kind === 'review'
              ? 'Нейт собрал задания, на которых ты ошибся. Исправишь — уйдут дальше в повторение.'
              : (lesson?.homework?.about_ru ?? 'Домашка от Нейта.')}
          </p>
          <Button variant="fill" onClick={() => void begin()}>
            Начать
          </Button>
        </section>
      )}
      {phase === 'theory' && view.data && <Theory view={view.data} onGo={() => void begin()} />}

      {phase === 'tasks' && item && (
        <section className="eng-card eng-task" aria-label="Задание">
          <p className="eng-kind">{kindLabel(item.task)}</p>
          <TaskBody
            key={`${item.lesson ?? ''}:${item.task.id}`}
            task={item.task}
            busy={busy}
            result={result}
            canMic={canRecord()}
            onReply={(r) => void reply(r)}
          />
          {result && <Verdict a={result} />}
          {result && (
            <div className="eng-row">
              {!result.correct && (
                <Button size="sm" onClick={() => setResult(null)}>
                  Ещё раз
                </Button>
              )}
              <Button variant="fill" onClick={() => void next()} disabled={busy}>
                {at + 1 < list.length ? 'Дальше' : 'Закончить'}
              </Button>
            </div>
          )}
        </section>
      )}
      {phase === 'tasks' && run && list.length === 0 && (
        <p className="later">Повторять пока нечего — ошибок на сегодня нет.</p>
      )}

      {phase === 'result' && done && <Result f={done} kind={kind} onClose={onClose} />}

      <Presence show={!!toast && (toast.xp > 0 || toast.unlocked.length > 0)}>
        {toast && <Gain d={toast} />}
      </Presence>

      {kind !== 'review' && phase !== 'result' && <Ask lesson={id} />}

      {err && (
        <p className="act-error" role="alert">
          {err.text} <LimitLink code={err.code} />
        </p>
      )}
    </div>
  );
}

function Theory({
  view,
  onGo,
}: {
  view: NonNullable<ReturnType<typeof useLesson>['data']>;
  onGo: () => void;
}) {
  const { lesson, level } = view;
  const t = theory(lesson, level);
  return (
    <section className="eng-card eng-theory" aria-label="Теория">
      <p>
        <b>Цель:</b> {lesson.goal_ru}
      </p>
      {lesson.agent_notes_ru?.map((n) => (
        <Note key={n}>Нейт помнит: {n}</Note>
      ))}
      <h3 className="eng-h">{lesson.grammar.title_ru}</h3>
      <p lang={t.main === lesson.grammar.explain_ru ? 'ru' : 'en'}>{t.main}</p>
      {t.second && <p className="eng-hint">{t.second}</p>}
      <ul className="eng-examples">
        {lesson.grammar.examples.map((e) => (
          <li key={e.en}>
            <b lang="en">{e.en}</b> — {e.ru} <Speak text={e.en} />
          </li>
        ))}
      </ul>
      {lesson.grammar.mistakes.length > 0 && (
        <>
          <h4 className="eng-h">Так не говори</h4>
          <ul className="eng-fix">
            {lesson.grammar.mistakes.map((m) => (
              <li key={m.wrong}>
                <s lang="en">{m.wrong}</s> → <b lang="en">{m.right}</b>
                <span className="eng-why"> — {m.why_ru}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h4 className="eng-h">Слова</h4>
      <ul className="eng-words">
        {lesson.words.map((w) => (
          <li key={w.en}>
            <b lang="en">{w.en}</b> — {w.ru}
            {w.note_ru && <span className="eng-why"> ({w.note_ru})</span>}
          </li>
        ))}
      </ul>
      <p className="eng-hint">{lesson.pass.about_ru}</p>
      <Button variant="fill" onClick={onGo}>
        К заданиям
      </Button>
    </section>
  );
}

/** Спросить Нейта по уроку — можно по-русски (D-491). */
function Ask({ lesson }: { lesson: string }) {
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; code: string | null } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      setAnswer(await askNate(lesson, text.trim()));
      setText('');
    } catch (x) {
      setErr({ text: say(x), code: x instanceof Fail ? x.code : null });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="eng-card eng-ask" aria-label="Спросить Нейта">
      <form className="talk-form" onSubmit={(e) => void submit(e)}>
        <Field
          label="Спросить Нейта (можно по-русски)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="А почему тут is, а не am?"
          maxLength={1000}
        />
        <Button size="sm" type="submit" disabled={busy || !text.trim()}>
          Спросить
        </Button>
      </form>
      {answer && (
        <p className="eng-answer" role="status">
          <b>Нейт:</b> {answer}
        </p>
      )}
      {err && (
        <p className="act-error">
          {err.text} <LimitLink code={err.code} />
        </p>
      )}
    </section>
  );
}

function Verdict({ a }: { a: Answered }) {
  return (
    <div className="eng-verdict" data-ok={a.correct ? '' : undefined} role="status">
      <b>{a.correct ? 'Верно' : 'Неверно'}</b>
      {a.heard && (
        <p className="eng-hint">
          Нейт услышал: <span lang="en">«{a.heard}»</span>
        </p>
      )}
      {a.say && <p lang="en">Нейт: {a.say}</p>}
      {!a.correct && a.right && (
        <p>
          Правильно: <b lang="en">{a.right}</b>
        </p>
      )}
      {a.mistakes.length > 0 && (
        <ul className="eng-fix">
          {a.mistakes.map((m, i) => (
            <li key={i}>
              <s lang="en">{m.wrong}</s> → <b lang="en">{m.right}</b>
              {m.why && <span className="eng-why"> — {m.why}</span>}
            </li>
          ))}
        </ul>
      )}
      {a.explain_ru && <p className="eng-hint">{a.explain_ru}</p>}
      {a.offline && (
        <p className="eng-hint">AI сейчас недоступен — проверил по обязательным словам.</p>
      )}
    </div>
  );
}

function Gain({ d }: { d: Delta }) {
  return (
    <p className="eng-gain" role="status">
      {d.xp > 0 && <b>+{d.xp} XP</b>}
      {d.streak_up && <> · огонёк {days(d.streak)}</>}
      {d.ring_closed && <> · цель дня закрыта</>}
      {d.quests_closed && <> · все задания дня</>}
      {d.unlocked.map((u) => (
        <span key={u.kind + u.id}>
          {' '}
          · {u.kind === 'badge' ? 'достижение' : 'Частица'} «{u.title}»
        </span>
      ))}
    </p>
  );
}

function Result({ f, kind, onClose }: { f: Finished; kind: Run['kind']; onClose: () => void }) {
  return (
    <section className="eng-card eng-result" aria-label="Итог">
      <h3 className="eng-h">
        {kind === 'review' ? 'Повторение закончено' : f.passed ? 'Урок пройден' : 'Пока не пройден'}
      </h3>
      {kind !== 'review' && (
        <p>
          Верно {Math.round(f.accuracy * 100)}% (нужно {Math.round(f.need_accuracy * 100)}%), вслух{' '}
          {f.spoken} из {f.need_speak}
          {f.missing.length > 0 && <> · не сделано обязательное: {f.missing.join(', ')}</>}
        </p>
      )}
      <Gain d={f.game} />
      {f.review_ru && (
        <p>
          <b>Разбор Нейта:</b> {f.review_ru}
        </p>
      )}
      {f.program_actions.length > 0 && (
        <p className="eng-hint">Нейт поправил программу под тебя — видно в «Ленте» агента.</p>
      )}
      {f.homework_task && kind === 'lesson' && (
        <Note tone="ok">Домашка — уже в Planner, срок завтра.</Note>
      )}
      <Button variant="fill" onClick={onClose}>
        К урокам
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------- задания

function TaskBody({
  task,
  busy,
  result,
  canMic,
  onReply,
}: {
  task: Task;
  busy: boolean;
  result: Answered | null;
  canMic: boolean;
  onReply: (r: Reply) => void;
}) {
  const locked = busy || !!result;
  let body: ReactNode;
  switch (task.type) {
    case 'choose':
    case 'listen':
      body = <Choose task={task} locked={locked} answered={!!result} onReply={onReply} />;
      break;
    case 'match':
      body = <Match task={task} locked={locked} onReply={onReply} />;
      break;
    case 'build':
      body = <Build task={task} locked={locked} onReply={onReply} />;
      break;
    case 'fill':
      body = <Fill task={task} locked={locked} onReply={onReply} />;
      break;
    case 'translate':
      body = (
        <>
          <p className="eng-say" lang={task.from === 'en' ? 'en' : 'ru'}>
            {task.text}
          </p>
          <TextAnswer label="Перевод" locked={locked} onReply={onReply} />
        </>
      );
      break;
    default:
      body = <SpeakTask task={task} locked={locked} canMic={canMic} onReply={onReply} />;
  }
  return (
    <div className="eng-body">
      <p className="eng-ask-text">{task.ask_ru}</p>
      {task.hint_ru && <p className="eng-hint">Подсказка: {task.hint_ru}</p>}
      {body}
    </div>
  );
}

function Choose({
  task,
  locked,
  answered,
  onReply,
}: {
  task: Task;
  locked: boolean;
  answered: boolean;
  onReply: (r: Reply) => void;
}) {
  const [typed, setTyped] = useState('');
  const listen = task.type === 'listen';
  return (
    <>
      {listen && task.audio && (
        <div className="eng-row">
          <Speak text={task.audio} label="Послушать" />
          {/* текст речи спрятан до ответа (D-491) */}
          {answered && task.show_text !== false && (
            <span className="eng-hint" lang="en">
              «{task.audio}»
            </span>
          )}
        </div>
      )}
      {task.question && (
        <p className="eng-say" lang={listen ? 'ru' : undefined}>
          {task.question}
        </p>
      )}
      {task.options ? (
        <div className="eng-options" role="group" aria-label="Варианты">
          {task.options.map((o) => (
            <Button key={o} dot={false} disabled={locked} onClick={() => onReply({ value: o })}>
              <span lang="en">{o}</span>
            </Button>
          ))}
        </div>
      ) : (
        <form
          className="talk-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) onReply({ value: typed.trim() });
          }}
        >
          <Field label="Ответ" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <Button size="sm" type="submit" disabled={locked || !typed.trim()}>
            Проверить
          </Button>
        </form>
      )}
    </>
  );
}

function Match({
  task,
  locked,
  onReply,
}: {
  task: Task;
  locked: boolean;
  onReply: (r: Reply) => void;
}) {
  const pairs = useMemo(() => task.pairs ?? [], [task.pairs]);
  const left = pairs.map((p) => p.en);
  const right = useMemo(() => [...pairs.map((p) => p.ru)].sort(), [pairs]);
  const [pick, setPick] = useState<string | null>(null);
  const [made, setMade] = useState<[string, string][]>([]);
  const used = (side: 0 | 1, w: string) => made.some((m) => m[side] === w);
  const choose = (ru: string) => {
    if (!pick) return;
    const next: [string, string][] = [...made, [pick, ru]];
    setMade(next);
    setPick(null);
    if (next.length === pairs.length) onReply({ value: next });
  };
  return (
    <div className="eng-match">
      <div role="group" aria-label="Английские слова">
        {left.map((w) => (
          <Button
            key={w}
            dot={false}
            size="sm"
            disabled={locked || used(0, w)}
            aria-pressed={pick === w}
            onClick={() => setPick(w)}
          >
            <span lang="en">{w}</span>
          </Button>
        ))}
      </div>
      <div role="group" aria-label="Перевод">
        {right.map((w) => (
          <Button
            key={w}
            dot={false}
            size="sm"
            disabled={locked || used(1, w) || !pick}
            onClick={() => choose(w)}
          >
            {w}
          </Button>
        ))}
      </div>
      {made.length > 0 && !locked && (
        <Button size="sm" dot={false} onClick={() => setMade([])}>
          Сначала
        </Button>
      )}
    </div>
  );
}

function Build({
  task,
  locked,
  onReply,
}: {
  task: Task;
  locked: boolean;
  onReply: (r: Reply) => void;
}) {
  const all = useMemo(() => tiles(task), [task]);
  const [used, setUsed] = useState<number[]>([]);
  return (
    <>
      {task.from_ru && <p className="eng-say">{task.from_ru}</p>}
      <p className="eng-built" lang="en" aria-live="polite">
        {used.map((i) => all[i]).join(' ') || '…'}
      </p>
      <div className="eng-options" role="group" aria-label="Плитки">
        {all.map((w, i) => (
          <Button
            key={`${w}-${i}`}
            size="sm"
            dot={false}
            disabled={locked || used.includes(i)}
            onClick={() => setUsed([...used, i])}
          >
            <span lang="en">{w}</span>
          </Button>
        ))}
      </div>
      <div className="eng-row">
        <Button
          size="sm"
          dot={false}
          disabled={locked || !used.length}
          onClick={() => setUsed(used.slice(0, -1))}
        >
          Убрать
        </Button>
        <Button
          variant="fill"
          disabled={locked || !used.length}
          onClick={() => onReply({ value: used.map((i) => all[i]).join(' ') })}
        >
          Проверить
        </Button>
      </div>
    </>
  );
}

function Fill({
  task,
  locked,
  onReply,
}: {
  task: Task;
  locked: boolean;
  onReply: (r: Reply) => void;
}) {
  const parts = gaps(task.text ?? '');
  const n = parts.length - 1;
  const [vals, setVals] = useState<string[]>(() => Array.from({ length: n }, () => ''));
  const [at, setAt] = useState(0);
  return (
    <>
      <p className="eng-say" lang="en">
        {parts.map((p, i) => (
          <span key={i}>
            {p}
            {i < n && <span className="eng-gap">{vals[i] || '___'}</span>}
          </span>
        ))}
      </p>
      {task.translation_ru && <p className="eng-hint">{task.translation_ru}</p>}
      {task.options ? (
        <div className="eng-options" role="group" aria-label="Слова">
          {task.options.map((o) => (
            <Button
              key={o}
              size="sm"
              dot={false}
              disabled={locked}
              onClick={() => {
                const next = [...vals];
                next[at] = o;
                setVals(next);
                if (at + 1 < n) setAt(at + 1);
                else onReply({ value: next });
              }}
            >
              <span lang="en">{o}</span>
            </Button>
          ))}
        </div>
      ) : (
        <TextAnswer
          label="Пропущенное слово"
          locked={locked}
          onReply={(r) => onReply('value' in r ? { value: [r.value] } : r)}
        />
      )}
    </>
  );
}

function TextAnswer({
  label,
  locked,
  onReply,
}: {
  label: string;
  locked: boolean;
  onReply: (r: Reply) => void;
}) {
  const [text, setText] = useState('');
  return (
    <form
      className="talk-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onReply({ value: text.trim() });
      }}
    >
      <Field
        label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={1000}
      />
      <Button size="sm" type="submit" disabled={locked || !text.trim()}>
        Проверить
      </Button>
    </form>
  );
}

/** Сказать вслух, описать картинку, роль: микрофон; нет его — текстом. */
function SpeakTask({
  task,
  locked,
  canMic,
  onReply,
}: {
  task: Task;
  locked: boolean;
  canMic: boolean;
  onReply: (r: Reply) => void;
}) {
  const rec = useRef<Recording | null>(null);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [typing, setTyping] = useState(!canMic);
  useEffect(() => () => rec.current?.cancel(), []);
  const toggle = async () => {
    setErr(null);
    if (rec.current) {
      const r = rec.current;
      rec.current = null;
      setOn(false);
      const { audio, ms } = await r.stop();
      if (ms < 400 || audio.size === 0) {
        setErr('Слишком коротко — нажми «Говорить», скажи и нажми «Готово».');
        return;
      }
      onReply({ audio, ms });
      return;
    }
    try {
      rec.current = await record(() => void toggle());
      setOn(true);
    } catch {
      setErr('Микрофон недоступен — разреши его браузеру или ответь текстом.');
      setTyping(true);
    }
  };
  const say = task.say ?? task.opening;
  return (
    <>
      {task.type === 'describe_image' && task.image && (
        <figure className="eng-picture">
          <div className="eng-picture-frame" aria-hidden="true">
            <Companion kind="neit" pitch={4} />
          </div>
          <figcaption>{task.image.alt_ru}</figcaption>
        </figure>
      )}
      {task.type === 'roleplay' && (
        <p className="eng-hint">
          {task.scenario_ru} Нейт — {task.tutor_role}. Цели: {task.goals_ru?.join(', ')}.
        </p>
      )}
      {say && (
        <div className="eng-row">
          <p className="eng-say" lang="en">
            {task.type === 'roleplay' ? `Нейт: ${say}` : say}
          </p>
          <Speak text={say} />
        </div>
      )}
      {task.focus_ru && <p className="eng-hint">{task.focus_ru}</p>}
      {task.must_use && task.must_use.length > 0 && (
        <p className="eng-hint">
          Используй: <span lang="en">{task.must_use.join(', ')}</span>
        </p>
      )}
      {canMic && (
        <div className="eng-row">
          <Button
            variant="fill"
            disabled={locked && !on}
            aria-pressed={on}
            onClick={() => void toggle()}
          >
            {on ? 'Готово' : 'Говорить'}
          </Button>
          {!typing && (
            <Button size="sm" dot={false} onClick={() => setTyping(true)}>
              Ответить текстом
            </Button>
          )}
        </div>
      )}
      {typing && <TextAnswer label="Ответ по-английски" locked={locked} onReply={onReply} />}
      {err && <p className="eng-hint">{err}</p>}
      {spoken(task) && !canMic && <p className="eng-hint">Микрофона нет — отвечай текстом.</p>}
    </>
  );
}

// ---------------------------------------------------------------- игра

function GameView() {
  const q = useEnglishHome();
  const change = useChangeSettings();
  if (q.isError) return <Denied error={q.error} />;
  const home = q.data;
  if (!home) return <p className="later">Загружаю…</p>;
  const g = home.game;
  return (
    <>
      <Today home={home} />
      <section className="eng-card" aria-label="Частицы">
        <h3 className="eng-h">Частицы — помощники Нейта</h3>
        <p className="eng-hint">Открываются учёбой, ничего не покупается и ничего не запирает.</p>
        <ul className="eng-grid">
          {g.particles.map((p) => (
            <li key={p.id} data-open={p.open ? '' : undefined}>
              <b>{p.title}</b>
              <span className="eng-hint">{p.open ? p.gives : `Как открыть: ${p.how}`}</span>
              {p.open && (
                <Button
                  size="sm"
                  dot={false}
                  aria-pressed={home.learner.companion === p.id}
                  onClick={() =>
                    change.mutate({ companion: home.learner.companion === p.id ? '' : p.id })
                  }
                >
                  {home.learner.companion === p.id ? 'Спутник' : 'Сделать спутником'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="eng-card" aria-label="Достижения">
        <h3 className="eng-h">Достижения</h3>
        <ul className="eng-grid">
          {g.badges.map((b) => (
            <li key={b.id} data-open={b.open ? '' : undefined}>
              <b>{b.title}</b>
              <span className="eng-hint">{b.how}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- настройки

const GOALS = ['5', '10', '15', '20', '30'] as const;

function SettingsView() {
  const q = useEnglishSettings();
  const home = useEnglishHome();
  const change = useChangeSettings();
  const adapt = useAdapt();
  const [err, setErr] = useState<{ text: string; code: string | null } | null>(null);
  const [adapted, setAdapted] = useState<string | null>(null);
  if (q.isError) return <Denied error={q.error} />;
  const body = q.data;
  if (!body) return <p className="later">Загружаю…</p>;
  const s = body.settings;
  const set = (c: Record<string, unknown>) =>
    change.mutate(c, {
      onError: (e) => setErr({ text: say(e), code: e instanceof Fail ? e.code : null }),
    });
  const current = s.voice ?? body.voices[0]?.id;
  return (
    <section className="eng-card eng-settings" aria-label="Настройки английского">
      <VoiceEngine body={body} set={set} />
      <h3 className="eng-h">
        Голос Нейта — ElevenLabs{body.engine?.engine === 'chatgpt' && ' (запасной)'}
      </h3>
      <ul className="eng-voices">
        {body.voices.map((v) => (
          <li key={v.id} data-on={v.id === current ? '' : undefined}>
            <span>
              <b>{v.name}</b> <span className="eng-hint">— {v.about}</span>
            </span>
            <span className="eng-row">
              <Button
                size="sm"
                dot={false}
                onClick={() =>
                  playPhrase(body.sample, v.id).catch((e) => setErr({ text: say(e), code: null }))
                }
              >
                Послушать
              </Button>
              <Button
                size="sm"
                dot={false}
                aria-pressed={v.id === current}
                onClick={() => set({ voice: v.id })}
              >
                {v.id === current ? 'Выбран' : 'Выбрать'}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <h3 className="eng-h">Строгость</h3>
      <Segmented
        label="Строгость"
        value={String(s.strictness) as '1' | '2' | '3'}
        onChange={(v) => set({ strictness: Number(v) })}
        options={[
          { value: '1', label: 'Мягче' },
          { value: '2', label: 'Обычно' },
          { value: '3', label: 'Строже' },
        ]}
      />
      <h3 className="eng-h">Цель в день</h3>
      <Segmented
        label="Цель минут в день"
        value={String(s.goal_minutes) as (typeof GOALS)[number]}
        onChange={(v) => set({ goal_minutes: Number(v) })}
        options={GOALS.map((g) => ({ value: g, label: `${g} мин` }))}
      />
      <h3 className="eng-h">Напоминания</h3>
      <Switch
        checked={s.remind}
        onChange={(v) => set({ remind: v })}
        label="Нейт напоминает раз в день (колокольчик и Telegram, не ночью и не на уроке)"
      />
      <label className="eng-inline">
        Во сколько
        <input
          type="time"
          value={s.remind_at}
          onChange={(e) => e.target.value && set({ remind_at: e.target.value })}
        />
      </label>
      <label className="eng-inline">
        День отдыха (огонёк не гаснет)
        <select
          value={s.rest_weekday ?? 0}
          onChange={(e) => set({ rest_weekday: Number(e.target.value) })}
        >
          <option value={0}>нет</option>
          {['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'].map(
            (d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ),
          )}
        </select>
      </label>
      <label className="eng-inline">
        Пауза (болезнь, поездка)
        <select
          value={s.paused_until ? 'on' : 0}
          onChange={(e) =>
            set({ pause_days: e.target.value === 'on' ? 14 : Number(e.target.value) })
          }
        >
          <option value={0}>{s.paused_until ? 'снять паузу' : 'без паузы'}</option>
          {s.paused_until && <option value="on">до {s.paused_until}</option>}
          {[3, 7, 14].map((d) => (
            <option key={d} value={d}>
              {days(d)}
            </option>
          ))}
        </select>
      </label>
      <h3 className="eng-h">Уровень</h3>
      <Segmented
        label="Уровень языка"
        variant="chips"
        value={s.level}
        onChange={(v) => set({ level: v })}
        options={(home.data?.levels ?? []).map((l) => ({ value: l.id, label: l.id.toUpperCase() }))}
      />
      <h3 className="eng-h">Программа под тебя</h3>
      <p className="eng-hint">
        Нейт сам правит программу после уроков с ошибками. Можно попросить сейчас — правки будут в
        «Ленте» агента, любую можно откатить.
      </p>
      <Button
        onClick={() =>
          adapt.mutate(undefined, {
            onSuccess: (r) =>
              setAdapted(r.summary_ru ?? (r.actions.length ? 'Готово.' : 'Править пока нечего.')),
            onError: (e) => setErr({ text: say(e), code: e instanceof Fail ? e.code : null }),
          })
        }
        disabled={adapt.isPending}
      >
        Подстроить программу
      </Button>
      {adapted && <Note tone="ok">{adapted}</Note>}
      {err && (
        <p className="act-error" role="alert">
          {err.text} <LimitLink code={err.code} />
        </p>
      )}
    </section>
  );
}

/**
 * Голос разговора (ENG-005): живой через свою подписку ChatGPT или ElevenLabs. По умолчанию —
 * ChatGPT, если подписка подключена. У ChatGPT — модель и голос, и сколько потрачено сегодня.
 */
function VoiceEngine({
  body,
  set,
}: {
  body: SettingsBody;
  set: (c: Record<string, unknown>) => void;
}) {
  const e = body.engine;
  if (!e) return null;
  const engine = (e.chosen ?? e.engine) === 'chatgpt' ? 'chatgpt' : 'elevenlabs';
  const s = body.settings;
  const model = s.realtime_model ?? e.model;
  const voice = s.realtime_voice ?? e.voice;
  return (
    <>
      <h3 className="eng-h">Голос разговора</h3>
      <Segmented<'chatgpt' | 'elevenlabs'>
        label="Голос разговора"
        value={engine}
        onChange={(v) => set({ voice_engine: v })}
        options={[
          { value: 'chatgpt', label: 'ChatGPT — живой' },
          { value: 'elevenlabs', label: 'ElevenLabs' },
        ]}
      />
      <p className="eng-hint">
        {engine === 'chatgpt'
          ? 'Говоришь с Нейтом вживую, как по телефону: он слышит сразу, отвечает голосом, можно перебивать. Работает по твоей подписке ChatGPT — денег с Qubite не тратит.'
          : 'Ты договорил — Нейт распознаёт фразу, отвечает с разбором ошибок и озвучивает ответ голосом ElevenLabs.'}
        {e.chosen === null && ' Выбрано само: ChatGPT, если подписка подключена.'}
      </p>
      {engine === 'chatgpt' && !e.chatgpt_connected && (
        <Note>
          Подписка ChatGPT не подключена — <Link to="/settings/ai">войди через ChatGPT</Link>, иначе
          разговор будет через ElevenLabs.
        </Note>
      )}
      {engine === 'chatgpt' && (
        <>
          <h3 className="eng-h">Модель живого голоса</h3>
          <Segmented
            label="Модель живого голоса"
            value={model}
            onChange={(v) => set({ realtime_model: v })}
            options={(body.realtime_models ?? []).map((m) => ({
              value: m.id,
              label: m.name.replace(/^GPT /, ''),
            }))}
          />
          <p className="eng-hint">
            {(body.realtime_models ?? []).find((m) => m.id === model)?.about}
          </p>
          <h3 className="eng-h">Голос ChatGPT</h3>
          <Segmented
            label="Голос ChatGPT"
            variant="chips"
            value={voice}
            onChange={(v) => set({ realtime_voice: v })}
            options={(body.realtime_voices ?? []).map((v) => ({ value: v.id, label: v.id }))}
          />
          <p className="eng-hint">
            {(body.realtime_voices ?? []).find((v) => v.id === voice)?.about}. Голос слышно с первой
            фразы разговора.
          </p>
          <p className="eng-hint">
            Сегодня: разговоров {e.sessions_today} из {e.day_sessions || '∞'}, минут{' '}
            {Math.ceil(e.seconds_today / 60)} из {e.day_secs ? e.day_secs / 60 : '∞'}; один разговор
            — до {e.max_session_secs / 60} мин.
          </p>
        </>
      )}
    </>
  );
}
