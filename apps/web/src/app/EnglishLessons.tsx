/**
 * «Английский» как модуль (ENG-002, D-480): уроки по программе ENG-000, разговор с Нейтом
 * (ENG-001), игра и настройки. Урок: теория, которую Нейт объясняет на языке уровня, → задания как
 * в Duolingo (выбрать, соединить, собрать, вставить, перевести, на слух без текста, сказать вслух,
 * описать картинку, роль) → итог: огонёк, опыт, домашка делом в Planner, разбор ошибок. Спросить
 * Нейта можно в любой момент — и по-русски (D-491). Сверку, опыт и огонёк считает сервер.
 */
import { loop } from '@qubite/motion';
import {
  Button,
  Companion,
  DotIcon,
  Field,
  Note,
  Presence,
  Segmented,
  Sheet,
  Swap,
  Switch,
  useMedia,
  useSpring,
  WIDE,
  type CompanionHandle,
} from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { createPortal } from 'react-dom';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Fail, say } from '../auth/client';
import { AgentEnglish } from './AgentEnglish';
import { canRecord, record, type Recording } from './english';
import {
  askNate,
  ENGLISH_HOME,
  fetchPhrase,
  finishRun,
  replaceVoiceTask,
  sendAnswer,
  startRun,
  useAdapt,
  useChangeSettings,
  useEnglishHome,
  useEnglishSettings,
  markTask,
  useLesson,
  usePlace,
  usePlacementTest,
  type Answered,
  type Delta,
  type Finished,
  type Game,
  type AnswerBy,
  type Home,
  type Mark,
  type PlacementAnswers,
  type Reply,
  type Run,
  type SettingsBody,
  type Task,
} from './english-lessons';
import {
  answerBy,
  answerBar,
  consecutiveEasy,
  harderFirst,
  microphoneFallback,
  byModule,
  days,
  explainAsk,
  gaps,
  kindLabel,
  matchRight,
  matchReply,
  optionState,
  PAIR_TONES,
  pairOk,
  pairsOk,
  resumeAt,
  fixHint,
  type Pair,
  ring,
  runTasks,
  spoken,
  theory,
  tiles,
  WEEKDAYS,
  WHY_TEXT,
} from './english-lessons-view';
import { useDictation } from './english-dictation';
import { playCue, readFeedback, writeFeedback, type FeedbackSettings } from './english-feedback';
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
            <LessonScreen onClose={() => setOpen(null)}>
              <LessonPlayer key={open.lesson + open.kind} {...open} onClose={() => setOpen(null)} />
            </LessonScreen>
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

export function Placement({ onDone }: { onDone: () => void }) {
  const [going, setGoing] = useState(false);
  const test = usePlacementTest(going);
  const place = usePlace();
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<PlacementAnswers>({});
  const [err, setErr] = useState<string | null>(null);
  const items = useMemo(() => test.data?.stages.flatMap((s) => s.items) ?? [], [test.data]);

  const answer = (value: unknown) => {
    const item = items[at];
    if (!item) return;
    setAnswers((a) => ({ ...a, [item.id]: value }));
    setAt((i) => i + 1);
  };

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
        <>
          <TaskBody
            key={item.id}
            task={item}
            busy={false}
            result={null}
            canMic={false}
            onReply={(r) => answer('value' in r ? r.value : '')}
          />
          <div className="eng-row">
            <Button onClick={() => answer(null)}>Не знаю</Button>
          </div>
        </>
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
    <div className="eng-stack">
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
    </div>
  );
}

function Path({ home, onOpen }: { home: Home; onOpen: (l: string, k: Run['kind']) => void }) {
  const [level, setLevel] = useState(home.learner.level);
  // отметки ученика у заданий — не правки Нейта, их показываем отдельно (ENG-006)
  const ops = home.ops.filter((o) => o.op !== 'feedback');
  const marks = home.ops.length - ops.length;
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
      {marks > 0 && (
        <p className="eng-hint">
          Твоих отметок у заданий: {marks}. Нейт учтёт их, когда подстроит программу.
        </p>
      )}
      {ops.length > 0 && (
        <div className="eng-ops">
          <p className="eng-hint">
            Нейт подстроил программу под тебя (откатить — в «Ленте» агента):
          </p>
          <ul>
            {ops.map((o) => (
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

/** Отдельный слой в body: transform оболочки не ограничивает полный экран. */
function LessonScreen({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const screen = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useLayoutEffect(() => {
    const root = document.getElementById('root');
    const wasInert = root?.inert ?? false;
    const overflow = document.body.style.overflow;
    const back = document.activeElement as HTMLElement | null;
    if (root) root.inert = true;
    document.body.style.overflow = 'hidden';
    screen.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      // Sheet перехватывает Escape раньше, в фазе capture.
      if (e.key === 'Escape') close.current();
      if (e.key !== 'Tab' || !screen.current?.contains(document.activeElement)) return;
      const controls = [
        ...screen.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === screen.current)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      if (root) root.inert = wasInert;
      document.body.style.overflow = overflow;
      back?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div
      ref={screen}
      className="eng-lesson-screen"
      role="dialog"
      aria-modal="true"
      aria-label="Урок английского"
      tabIndex={-1}
    >
      <Presence show className="eng-lesson-presence">
        {children}
      </Presence>
    </div>,
    document.body,
  );
}

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
  const [draft, setDraft] = useState<Reply | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [keep, setKeep] = useState<Pair[]>([]);
  const [fix, setFix] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [err, setErr] = useState<{ text: string; code: string | null } | null>(null);
  const [done, setDone] = useState<Finished | null>(null);
  const [toast, setToast] = useState<Delta | null>(null);
  const [micNotice, setMicNotice] = useState(false);
  const [replaceFailed, setReplaceFailed] = useState(false);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [offer, setOffer] = useState(false);
  const [offered, setOffered] = useState(false);
  const [harderAccepted, setHarderAccepted] = useState(false);
  const [taskOrder, setTaskOrder] = useState<string[] | null>(null);
  const lesson = view.data?.lesson ?? null;
  const list = useMemo(() => {
    const tasks = run ? runTasks(lesson, run) : [];
    if (!taskOrder) return tasks;
    const position = (item: (typeof tasks)[number]) =>
      taskOrder.indexOf(`${item.lesson ?? id}:${item.task.id}`);
    return tasks.sort((a, b) => position(a) - position(b));
  }, [lesson, run, taskOrder, id]);
  const item = list[at];
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (content.current) content.current.scrollTop = 0;
  }, [phase, at]);

  const fail = (e: unknown) => setErr({ text: say(e), code: e instanceof Fail ? e.code : null });
  const begin = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setErr(null);
    try {
      const r = await startRun(kind === 'review' ? 'review' : id, kind);
      setRun(r);
      setAt(resumeAt(r, runTasks(lesson, r)));
      setPhase('tasks');
    } catch (e) {
      fail(e);
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const reply = async (r: Reply) => {
    if (!run || !item || working.current || result) return;
    working.current = true;
    setBusy(true);
    setErr(null);
    nate.current?.setMood('think');
    try {
      const a = await sendAnswer(run.id, item.task.id, r, item.lesson);
      if (item.task.type !== 'match') playCue(a.correct ? 'ok' : 'bad');
      if (item.task.type === 'match' && 'value' in r) {
        const made = r.value as Pair[];
        const ok = pairsOk(item.task, made);
        setKeep(made.filter((_, i) => ok[i]));
      }
      setResult(a);
      setToast(a.game);
      nate.current?.setMood(a.correct ? 'happy' : 'angry');
      if (a.correct) nate.current?.jump();
    } catch (e) {
      nate.current?.setMood('idle');
      fail(e);
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const replace = useCallback(async () => {
    if (!run || !item || working.current) return;
    working.current = true;
    setMicNotice(true);
    setReplaceFailed(false);
    setBusy(true);
    setDraft(null);
    setErr(null);
    try {
      const fresh = await replaceVoiceTask(run.id, item.task.id, item.lesson);
      // список повторения сервер собирает заново без уже решённых заданий — позиция сбилась бы
      setRun({ ...run, replacements: fresh.replacements ?? run.replacements ?? [] });
      setAttempt((n) => n + 1);
    } catch (e) {
      setReplaceFailed(true);
      setErr({ text: say(e), code: e instanceof Fail ? e.code : null });
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, [run, item]);

  const next = async () => {
    if (working.current) return;
    if (at + 1 < list.length) {
      setResult(null);
      setDraft(null);
      setKeep([]);
      setFix([]);
      setMicNotice(false);
      setReplaceFailed(false);
      setErr(null);
      nate.current?.setMood('idle');
      setAt(at + 1);
      return;
    }
    if (!run) return;
    working.current = true;
    setBusy(true);
    setErr(null);
    try {
      const f = await finishRun(run.id);
      setDone(f);
      setOffer(false);
      setPhase('result');
      if (f.passed) nate.current?.jump();
      void qc.invalidateQueries({ queryKey: ENGLISH_HOME });
    } catch (e) {
      fail(e);
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const marked = (mark: Mark) => {
    if (!item) return;
    const key = (i: (typeof list)[number]) => `${i.lesson ?? id}:${i.task.id}`;
    const updated = { ...marks, [key(item)]: mark };
    setMarks(updated);
    if (
      !offered &&
      consecutiveEasy(list.slice(0, at + 1).map((i) => updated[key(i)] ?? null)) >= 2
    ) {
      setOffered(true);
      setOffer(true);
    }
  };
  const acceptHarder = async () => {
    if (!run || !item || working.current) return;
    working.current = true;
    setBusy(true);
    setErr(null);
    try {
      await markTask(
        run.id,
        item.task.id,
        'easy',
        item.lesson,
        'После двух «легко» подряд ученик согласился перейти к трудным заданиям.',
      );
      setTaskOrder(harderFirst(list, at + 1).map((i) => `${i.lesson ?? id}:${i.task.id}`));
      setHarderAccepted(true);
      setOffer(false);
    } catch (e) {
      fail(e);
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const title =
    kind === 'review'
      ? 'Повторение ошибок'
      : `${kind === 'homework' ? 'Домашка: ' : ''}${lesson?.title.ru ?? 'Урок'}`;
  const bar = item ? answerBar(item.task, !!result, !!draft, busy) : null;

  return (
    <div className="eng-lesson">
      <header className="eng-stage">
        <Companion ref={nate} kind="neit" pitch={wide ? 6 : 4} label="Нейт — репетитор" />
        <div className="eng-who">
          <b>{title}</b>
          <span className="eng-phase">
            {phase === 'theory' && 'Нейт объясняет'}
            {phase === 'tasks' && item && `Задание ${at + 1} из ${list.length}`}
            {phase === 'result' && 'Итог'}
          </span>
          {phase === 'tasks' && list.length > 0 && (
            <Progress total={list.length} done={at + (result ? 1 : 0)} now={result ? null : at} />
          )}
        </div>
        <Button size="sm" dot={false} onClick={onClose} className="eng-close">
          Закрыть
        </Button>
      </header>
      <section className="eng-lesson-work" aria-label={phase === 'tasks' ? 'Задание' : undefined}>
        <div className="eng-lesson-content" ref={content}>
          <div className="eng-lesson-column">
            {view.isError ? (
              <Denied error={view.error} />
            ) : kind !== 'review' && !view.data ? (
              <p className="later">Загружаю урок…</p>
            ) : (
              <>
                {phase === 'intro' && (
                  <section className="eng-card eng-start" aria-label="Начать">
                    <p>
                      {kind === 'review'
                        ? 'Нейт собрал задания, на которых ты ошибся. Исправишь — уйдут дальше в повторение.'
                        : (lesson?.homework?.about_ru ?? 'Домашка от Нейта.')}
                    </p>
                    <Button variant="fill" disabled={busy} onClick={() => void begin()}>
                      Начать
                    </Button>
                  </section>
                )}
                {phase === 'theory' && view.data && (
                  <Theory view={view.data} onGo={() => void begin()} />
                )}
                {phase === 'tasks' && item && (
                  <section className="eng-card eng-task">
                    <div className="eng-task-head">
                      <p className="eng-kind">{kindLabel(item.task)}</p>
                      {run && (
                        <TaskFeedback
                          key={`${item.lesson ?? ''}:${item.task.id}`}
                          run={run.id}
                          lesson={item.lesson ?? id}
                          taskLesson={item.lesson}
                          task={item.task}
                          result={result}
                          onMarked={marked}
                        />
                      )}
                    </div>
                    <Presence show={micNotice}>
                      <Note>
                        Микрофон недоступен. Вместо голосового задания — письменное из этого урока,
                        без штрафа.
                      </Note>
                    </Presence>
                    {replaceFailed && (
                      <Button disabled={busy} onClick={() => void replace()}>
                        Повторить замену
                      </Button>
                    )}
                    <TaskBody
                      key={`${item.lesson ?? ''}:${item.task.id}:${attempt}`}
                      task={item.task}
                      busy={busy}
                      result={result}
                      canMic={canRecord()}
                      keep={keep}
                      fix={fix}
                      onReply={(r) => void reply(r)}
                      onDraft={setDraft}
                      onMicUnavailable={replace}
                    />
                    {result && <Verdict a={result} />}
                  </section>
                )}
                {phase === 'tasks' && run && !item && (
                  <div className="eng-start">
                    <p className="later">
                      {list.length ? 'Все задания уже сделаны.' : 'Повторять пока нечего.'}
                    </p>
                    {list.length > 0 && (
                      <Button variant="fill" disabled={busy} onClick={() => void next()}>
                        Закончить
                      </Button>
                    )}
                  </div>
                )}
                {phase === 'result' && done && (
                  <Result
                    f={done}
                    kind={kind}
                    onClose={onClose}
                    onAgain={() => {
                      setDone(null);
                      setRun(null);
                      setResult(null);
                      setDraft(null);
                      setKeep([]);
                      setFix([]);
                      setMarks({});
                      setOffered(false);
                      setHarderAccepted(false);
                      setOffer(false);
                      setTaskOrder(null);
                      setMicNotice(false);
                      setReplaceFailed(false);
                      void begin();
                    }}
                  />
                )}
              </>
            )}
            <Presence show={!!toast && (toast.xp > 0 || toast.unlocked.length > 0)}>
              {toast && <Gain d={toast} announce={false} />}
            </Presence>
            {err && (
              <Note tone="bad">
                {err.text} <LimitLink code={err.code} />
              </Note>
            )}
          </div>
        </div>
        <footer className="eng-lesson-bottom">
          <div className="eng-lesson-column">
            {kind !== 'review' && phase !== 'result' && <Ask lesson={id} />}
            {kind === 'review' && item && phase === 'tasks' && (
              <Ask key={item.lesson ?? id} lesson={item.lesson ?? id} />
            )}
            <Presence show={harderAccepted && phase !== 'result'}>
              <Note>Нейт учтёт пожелание после урока.</Note>
            </Presence>
            <Presence show={offer}>
              <div className="eng-start">
                <Note>Два задания подряд — легко. Перейти к трудным заданиям?</Note>
                <div className="eng-row">
                  <Button disabled={busy} onClick={() => void acceptHarder()}>
                    Давай
                  </Button>
                  <Button disabled={busy} onClick={() => setOffer(false)}>
                    Не сейчас
                  </Button>
                </div>
              </div>
            </Presence>
            {phase === 'tasks' && item && bar && (
              <div
                className="eng-answer-bar"
                data-ok={result?.correct ? '' : undefined}
                data-wrong={result && !result.correct ? '' : undefined}
              >
                <Swap
                  className="eng-answer-bar-content"
                  view={result ? 'answered' : bar.action}
                  order={['check', 'wait', 'answered']}
                >
                  {result ? (
                    <>
                      <p>
                        {result.correct
                          ? 'Верно!'
                          : `Правильный ответ: ${result.right || 'смотри разбор Нейта'}`}
                      </p>
                      <div className="eng-row">
                        {!result.correct && (
                          <Button
                            disabled={busy}
                            onClick={() => {
                              setFix(fixHint(result));
                              setResult(null);
                              setDraft(null);
                              setAttempt(attempt + 1);
                              nate.current?.setMood('idle');
                            }}
                          >
                            Ещё раз
                          </Button>
                        )}
                        <Button
                          variant="fill"
                          autoFocus
                          onClick={() => void next()}
                          disabled={bar.disabled}
                        >
                          {at + 1 < list.length ? 'Дальше' : 'Закончить'}
                        </Button>
                      </div>
                    </>
                  ) : bar.action === 'check' ? (
                    <Button
                      variant="fill"
                      disabled={bar.disabled}
                      onClick={() => draft && void reply(draft)}
                    >
                      {busy ? 'Проверяю…' : 'Проверить'}
                    </Button>
                  ) : (
                    <p className="eng-hint">
                      {busy
                        ? 'Проверяю…'
                        : item.task.type === 'match'
                          ? 'Соедини все пары'
                          : 'Выбери ответ'}
                    </p>
                  )}
                </Swap>
              </div>
            )}
          </div>
        </footer>
      </section>
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
  const [open, setOpen] = useState(false);
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
    <div className="eng-ask">
      <Button size="sm" dot={false} aria-expanded={open} onClick={() => setOpen(true)}>
        <DotIcon name="agent" /> Спросить Нейта
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Спросить Нейта">
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
      </Sheet>
    </div>
  );
}

/** Полоска хода урока точками: пройдено, текущее, впереди. */
function Progress({ total, done, now }: { total: number; done: number; now: number | null }) {
  return (
    <div
      className="eng-progress"
      role="progressbar"
      aria-label="Ход урока"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
    >
      {Array.from({ length: total }, (_, i) => (
        <span key={i} data-on={i < done ? '' : undefined} data-now={i === now ? '' : undefined} />
      ))}
    </div>
  );
}

const MARKS: { kind: Mark; label: string; about: string }[] = [
  { kind: 'easy', label: 'Слишком легко', about: 'после урока Нейт решит, как ускорить темп' },
  { kind: 'hard', label: 'Слишком трудно', about: 'вернётся завтра, Нейт сбавит темп' },
  { kind: 'broken', label: 'Ошибка в задании', about: 'запишем, чтобы исправить' },
];

/**
 * «Что-то не так?» у задания (ENG-006): слишком легко / трудно → отметка, по ней Нейт после
 * урока подстраивает темп программы; ошибка в задании → запись для исправления (задание не
 * мучает в повторении); «Объясни» → Нейт объясняет это задание по-русски. Отметки — в «Ленте»
 * агента, любую можно откатить.
 */
function TaskFeedback({
  run,
  lesson,
  taskLesson,
  task,
  result,
  onMarked,
}: {
  run: string;
  lesson: string;
  taskLesson: string | null;
  task: Task;
  result: Answered | null;
  onMarked: (mark: Mark) => void;
}) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ kind: Mark | 'explain'; text: string } | null>(null);
  // отметка остаётся видна на кнопке и после «Объясни»
  const [marked, setMarked] = useState<(typeof MARKS)[number] | null>(null);
  const [err, setErr] = useState<{ text: string; code: string | null } | null>(null);
  const fail = (e: unknown) => setErr({ text: say(e), code: e instanceof Fail ? e.code : null });
  const mark = async (kind: Mark) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await markTask(run, task.id, kind, taskLesson, kind === 'broken' ? note : '');
      setDone({ kind, text: r.summary_ru });
      setMarked(MARKS.find((m) => m.kind === kind) ?? null);
      setBroken(false);
      onMarked(kind);
      if (kind === 'easy') setOpen(false);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const explain = async () => {
    setBusy(true);
    setErr(null);
    try {
      setDone({ kind: 'explain', text: await askNate(lesson, explainAsk(task, result)) });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size="sm" dot={false} className="eng-mark" onClick={() => setOpen(true)}>
        {marked ? `Отмечено: ${marked.label.toLowerCase()}` : 'Что-то не так?'}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Что с заданием?">
        <div className="eng-marks">
          <p className="eng-hint">
            Нейт подстроит программу под тебя. Отметки видны в «Ленте» агента — любую можно
            откатить.
          </p>
          {MARKS.map((m) => (
            <Button
              key={m.kind}
              dot={false}
              className="eng-opt"
              data-state={marked?.kind === m.kind ? 'picked' : undefined}
              disabled={busy || marked?.kind === m.kind}
              onClick={() => (m.kind === 'broken' ? setBroken(true) : void mark(m.kind))}
            >
              <span className="eng-opt-text">
                <b>{m.label}</b>
                <span className="eng-hint">{m.about}</span>
              </span>
            </Button>
          ))}
          <Presence show={broken}>
            <form
              className="talk-form"
              onSubmit={(e) => {
                e.preventDefault();
                void mark('broken');
              }}
            >
              <Field
                label="Что не так? (можно пропустить)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Подходят два ответа"
                maxLength={500}
              />
              <Button size="sm" type="submit" disabled={busy}>
                Отправить
              </Button>
            </form>
          </Presence>
          <Button
            dot={false}
            className="eng-opt"
            data-state={done?.kind === 'explain' ? 'picked' : undefined}
            disabled={busy}
            onClick={() => void explain()}
          >
            <span className="eng-opt-text">
              <b>Объясни</b>
              <span className="eng-hint">Нейт объяснит это задание по-русски</span>
            </span>
          </Button>
          {busy && <p className="eng-hint">Нейт думает…</p>}
          {done && (
            <Note tone="ok">{done.kind === 'explain' ? <>Нейт: {done.text}</> : done.text}</Note>
          )}
          {err && (
            <p className="act-error" role="alert">
              {err.text} <LimitLink code={err.code} />
            </p>
          )}
        </div>
      </Sheet>
    </>
  );
}

function Verdict({ a }: { a: Answered }) {
  return (
    <div className="eng-verdict" data-ok={a.correct ? '' : undefined} role="status">
      <b>{a.correct ? 'Верно!' : 'Неверно'}</b>
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

function Gain({ d, announce = true }: { d: Delta; announce?: boolean }) {
  return (
    <p className="eng-gain" role={announce ? 'status' : undefined}>
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

function Result({
  f,
  kind,
  onClose,
  onAgain,
}: {
  f: Finished;
  kind: Run['kind'];
  onClose: () => void;
  onAgain: () => void;
}) {
  return (
    <section className="eng-card eng-result" aria-label="Итог">
      <h3 className="eng-h">
        {kind === 'review' ? 'Повторение закончено' : f.passed ? 'Урок пройден' : 'Пока не пройден'}
      </h3>
      {kind !== 'review' && (
        <p>
          Верно {Math.round(f.accuracy * 100)}% (нужно {Math.round(f.need_accuracy * 100)}%)
          {f.need_speak > 0 && (
            <>
              , вслух {f.spoken} (нужно {f.need_speak})
            </>
          )}
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
      <div className="eng-row">
        {kind !== 'review' && !f.passed && (
          <Button variant="fill" onClick={onAgain}>
            Пройти ещё раз
          </Button>
        )}
        <Button variant={kind === 'review' || f.passed ? 'fill' : 'outline'} onClick={onClose}>
          К урокам
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- задания

function TaskBody({
  task,
  busy,
  result,
  canMic,
  keep = [],
  fix = [],
  onReply,
  onDraft,
  onMicUnavailable,
}: {
  task: Task;
  busy: boolean;
  result: Answered | null;
  canMic: boolean;
  /** «Соедини» после «Ещё раз»: верные пары остаются. */
  keep?: Pair[];
  /** «Исправь свою фразу»: что было не так в прошлый раз (без готового ответа). */
  fix?: string[];
  onReply: (r: Reply) => void;
  onDraft?: ((r: Reply | null) => void) | undefined;
  onMicUnavailable?: (() => Promise<void>) | undefined;
}) {
  const locked = busy || !!result;
  let body: ReactNode;
  if (answerBy(task) === 'voice') {
    body = (
      <SpeakTask
        task={task}
        locked={locked}
        canMic={canMic}
        onReply={onReply}
        onDraft={onDraft}
        onMicUnavailable={onMicUnavailable}
      />
    );
  } else {
    switch (task.type) {
      case 'choose':
      case 'listen':
        body = (
          <Choose
            task={task}
            locked={locked}
            result={result}
            voice={canMic}
            onReply={onReply}
            onDraft={onDraft}
          />
        );
        break;
      case 'match':
        body = <Match task={task} locked={locked} keep={keep} onReply={onReply} />;
        break;
      case 'build':
        body = <Build task={task} locked={locked} onReply={onReply} onDraft={onDraft} />;
        break;
      case 'fill':
        body = (
          <Fill task={task} locked={locked} result={result} onReply={onReply} onDraft={onDraft} />
        );
        break;
      case 'translate':
        body = (
          <>
            <p className="eng-say" lang={task.from === 'en' ? 'en' : 'ru'}>
              {task.text}
            </p>
            <TextAnswer
              label="Перевод"
              locked={locked}
              by={answerBy(task)}
              voice={canMic}
              lang={task.from === 'en' ? 'ru' : 'en'}
              onReply={onReply}
              onDraft={onDraft}
            />
          </>
        );
        break;
      default:
        body = (
          <SpeakTask
            task={task}
            locked={locked}
            canMic={canMic}
            onReply={onReply}
            onDraft={onDraft}
            onMicUnavailable={onMicUnavailable}
          />
        );
    }
  }
  return (
    <div className="eng-body">
      <p className="eng-ask-text">{task.ask_ru}</p>
      {task.hint_ru && <p className="eng-hint">Подсказка: {task.hint_ru}</p>}
      {fix.length > 0 && !result && (
        <Note>
          <b>Исправь свою фразу.</b> Нейт заметил: {fix.join('; ')}
        </Note>
      )}
      {body}
    </div>
  );
}

const STATE_WORD = { ok: ' — верно', bad: ' — неверно', picked: ' — выбрано' } as const;

function Choose({
  task,
  locked,
  result,
  voice,
  onReply,
  onDraft,
}: {
  task: Task;
  locked: boolean;
  result: Answered | null;
  voice: boolean;
  onReply: (r: Reply) => void;
  onDraft?: ((r: Reply | null) => void) | undefined;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const listen = task.type === 'listen';
  return (
    <>
      {listen && task.audio && (
        <div className="eng-row">
          <Speak text={task.audio} label="Послушать" />
          {/* текст речи спрятан до ответа (D-491) */}
          {result && task.show_text !== false && (
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
        <div className="eng-options eng-choices" role="group" aria-label="Варианты">
          {task.options.map((o) => {
            const state = optionState(o, picked, result);
            return (
              <Button
                key={o}
                dot={false}
                className="eng-opt"
                data-state={state}
                disabled={locked && !state}
                aria-disabled={locked || undefined}
                aria-pressed={o === picked}
                onClick={() => {
                  if (locked) return;
                  setPicked(o);
                  onReply({ value: o });
                }}
              >
                <span lang="en">{o}</span>
                {state && <span className="q-sr">{STATE_WORD[state]}</span>}
              </Button>
            );
          })}
        </div>
      ) : (
        <TextAnswer
          label="Ответ"
          locked={locked}
          by={answerBy(task)}
          voice={voice}
          onReply={onReply}
          onDraft={onDraft}
        />
      )}
    </>
  );
}

/** Тряска на общей пружине, отдельно от transform самой Button. */
function MatchWord({ bad, children }: { bad: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const shake = useSpring(0, 0.35, (x) => {
    if (box.current) box.current.style.transform = x === 0 ? '' : `translateX(${x.toFixed(2)}px)`;
  });
  useEffect(() => {
    if (bad) loop().kick(shake, 260);
  }, [bad, shake]);
  return (
    <div className="eng-match-word" ref={box}>
      {children}
    </div>
  );
}

/** «Соедини»: пара проверяется сразу; ответ уходит после последней верной пары. */
function Match({
  task,
  locked,
  keep,
  onReply,
}: {
  task: Task;
  locked: boolean;
  keep: Pair[];
  onReply: (r: Reply) => void;
}) {
  const pairs = useMemo(() => task.pairs ?? [], [task.pairs]);
  const left = pairs.map((p) => p.en);
  const right = useMemo(() => matchRight(task), [task]);
  const [pick, setPick] = useState<{ side: 0 | 1; w: string } | null>(null);
  const [made, setMade] = useState<Pair[]>(keep);
  const [bad, setBad] = useState<Pair | null>(null);
  const [errors, setErrors] = useState(0);
  const mistake = useRef<Pair | null>(null);
  const full = made.length === pairs.length && pairs.length > 0;

  useEffect(() => {
    if (!bad) return;
    const timer = setTimeout(() => setBad(null), 600);
    return () => clearTimeout(timer);
  }, [bad]);

  const tap = (side: 0 | 1, w: string) => {
    if (locked || bad || full || made.some((pair) => pair[side] === w)) return;
    if (!pick || pick.side === side) {
      setPick(pick?.w === w && pick.side === side ? null : { side, w });
      return;
    }
    const pair: Pair = side === 1 ? [pick.w, w] : [w, pick.w];
    setPick(null);
    const correct = pairOk(task, pair);
    playCue(correct ? 'ok' : 'bad');
    if (!correct) {
      mistake.current ??= pair;
      setErrors((n) => n + 1);
      setBad(pair);
      return;
    }
    const next = [...made, pair];
    setMade(next);
    if (next.length === pairs.length) onReply({ value: matchReply(next, mistake.current) });
  };
  const tile = (side: 0 | 1, w: string) => {
    const at = made.findIndex((m) => m[side] === w);
    const picked = pick?.side === side && pick.w === w;
    const wrong = bad?.[side] === w;
    const state = at >= 0 ? 'ok' : wrong ? 'bad' : picked ? 'picked' : undefined;
    const name = at >= 0 ? `пара ${at + 1}${STATE_WORD.ok}` : wrong ? 'неверная пара' : null;
    return (
      <MatchWord key={w} bad={wrong}>
        <Button
          dot={false}
          className="eng-opt eng-pair"
          data-pair={at >= 0 ? (at % PAIR_TONES) + 1 : undefined}
          data-state={state}
          aria-pressed={picked}
          disabled={locked || at >= 0 || wrong || full}
          aria-label={name ? `${w}, ${name}` : w}
          onClick={() => tap(side, w)}
        >
          <span className="eng-pair-n" aria-hidden="true">
            {at >= 0 ? at + 1 : ''}
          </span>
          <span lang={side === 0 ? 'en' : 'ru'}>{w}</span>
        </Button>
      </MatchWord>
    );
  };
  return (
    <>
      <p className="eng-hint" role="status">
        {bad
          ? `Неверная пара: «${bad[0]}» и «${bad[1]}». Попробуй ещё раз.`
          : full
            ? `Все пары соединены.${errors ? ' Были ошибки при подборе.' : ''}`
            : pick
              ? `Выбрано «${pick.w}» — теперь нажми ${pick.side === 0 ? 'перевод' : 'английское слово'}`
              : `Верных пар: ${made.length} из ${pairs.length}. Выбери слово и перевод.`}
      </p>
      <div className="eng-match" aria-busy={!!bad}>
        <div role="group" aria-label="Английские слова">
          {left.map((w) => tile(0, w))}
        </div>
        <div role="group" aria-label="Перевод">
          {right.map((w) => tile(1, w))}
        </div>
      </div>
      {full && !locked && (
        <Button onClick={() => onReply({ value: matchReply(made, mistake.current) })}>
          Отправить ответ ещё раз
        </Button>
      )}
    </>
  );
}

function Build({
  task,
  locked,
  onReply,
  onDraft,
}: {
  task: Task;
  locked: boolean;
  onReply: (r: Reply) => void;
  onDraft?: ((r: Reply | null) => void) | undefined;
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
            dot={false}
            className="eng-opt eng-tile"
            disabled={locked || used.includes(i)}
            onClick={() => {
              const next = [...used, i];
              setUsed(next);
              onDraft?.({ value: next.map((n) => all[n]).join(' ') });
            }}
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
          onClick={() => {
            const next = used.slice(0, -1);
            setUsed(next);
            onDraft?.(next.length ? { value: next.map((n) => all[n]).join(' ') } : null);
          }}
        >
          Убрать
        </Button>
        {!onDraft && (
          <Button
            variant="fill"
            disabled={locked || !used.length}
            onClick={() => onReply({ value: used.map((i) => all[i]).join(' ') })}
          >
            Проверить
          </Button>
        )}
      </div>
    </>
  );
}

function Fill({
  task,
  locked,
  result,
  onReply,
  onDraft,
}: {
  task: Task;
  locked: boolean;
  result: Answered | null;
  onReply: (r: Reply) => void;
  onDraft?: ((r: Reply | null) => void) | undefined;
}) {
  const parts = gaps(task.text ?? '');
  const n = parts.length - 1;
  const [vals, setVals] = useState<string[]>(() => Array.from({ length: n }, () => ''));
  const [at, setAt] = useState(0);
  const draft = (r: Reply | null) => onDraft?.(r && 'value' in r ? { value: [r.value] } : r);
  return (
    <>
      <p className="eng-say" lang="en">
        {parts.map((p, i) => (
          <span key={i}>
            {p}
            {i < n && (
              <span
                className="eng-gap"
                data-state={result ? (result.correct ? 'ok' : 'bad') : undefined}
              >
                {vals[i] || '___'}
              </span>
            )}
          </span>
        ))}
      </p>
      {task.translation_ru && <p className="eng-hint">{task.translation_ru}</p>}
      {task.options ? (
        <div className="eng-options" role="group" aria-label="Слова">
          {task.options.map((o) => (
            <Button
              key={o}
              dot={false}
              className="eng-opt eng-tile"
              data-state={vals.includes(o) ? 'picked' : undefined}
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
          by={answerBy(task)}
          onReply={(r) => onReply('value' in r ? { value: [r.value] } : r)}
          onDraft={onDraft ? draft : undefined}
        />
      )}
    </>
  );
}

/**
 * Поле ответа (ENG-006): где «голос или текст» — рядом «Сказать» (диктовка ENG-005: ChatGPT,
 * запасной — ElevenLabs), сказанное видно в поле и уходит на сверку как сказанное (мягче к
 * написанию). Где «только текст» — подсказка, почему текстом.
 */
function TextAnswer({
  label,
  locked,
  by = 'text',
  voice = false,
  lang = 'en',
  why = true,
  onReply,
  onDraft,
}: {
  label: string;
  locked: boolean;
  by?: AnswerBy;
  /** Микрофон есть (и это урок, не входной тест). */
  voice?: boolean;
  /** На каком языке ответ — для распознавания. */
  lang?: 'en' | 'ru';
  /** Показывать «здесь — текстом». */
  why?: boolean;
  onReply: (r: Reply) => void;
  onDraft?: ((r: Reply | null) => void) | undefined;
}) {
  const [text, setText] = useState('');
  const [dictated, setDictated] = useState(false);
  const dict = useDictation(lang);
  const mic = voice && by !== 'text';
  const listening = dict.state === 'listening';
  const talk = async () => {
    if (!listening) {
      onDraft?.(null);
      await dict.start();
      return;
    }
    const said = (await dict.stop()).trim();
    if (!said) return;
    setText(said);
    setDictated(true);
    onDraft?.({ dictated: said });
    onReply({ dictated: said });
  };
  return (
    <form
      className="talk-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!locked && !listening && text.trim())
          onReply(dictated ? { dictated: text.trim() } : { value: text.trim() });
      }}
    >
      <Field
        label={label}
        value={listening ? dict.partial : text}
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          setDictated(false);
          onDraft?.(value.trim() ? { value: value.trim() } : null);
        }}
        disabled={locked}
        readOnly={listening}
        placeholder={listening ? 'Говори — Нейт слушает…' : undefined}
        maxLength={1000}
      />
      <div className="eng-row">
        {!onDraft && (
          <Button size="sm" type="submit" disabled={locked || listening || !text.trim()}>
            Проверить
          </Button>
        )}
        {mic && (
          <Button
            size="sm"
            dot={false}
            className="eng-mic"
            aria-pressed={listening}
            disabled={(locked && !listening) || dict.state === 'working'}
            onClick={() => void talk()}
          >
            {listening ? 'Готово' : dict.state === 'working' ? 'Слушаю…' : 'Сказать'}
          </Button>
        )}
      </div>
      {mic && !listening && (
        <p className="eng-hint">Можно голосом — за написание не снимаем, за слова и время — да.</p>
      )}
      {!mic && by === 'text' && why && <p className="eng-hint">{WHY_TEXT}</p>}
      {dict.error && (
        <p className="eng-hint" role="status">
          {dict.error}
        </p>
      )}
    </form>
  );
}

/** Голосовое задание: voice_or_text — текстовый запасной путь; voice — замена с сервера. */
function SpeakTask({
  task,
  locked,
  canMic,
  onReply,
  onDraft,
  onMicUnavailable,
}: {
  task: Task;
  locked: boolean;
  canMic: boolean;
  onReply: (r: Reply) => void;
  onDraft?: ((r: Reply | null) => void) | undefined;
  onMicUnavailable?: (() => Promise<void>) | undefined;
}) {
  const rec = useRef<Recording | null>(null);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const by = answerBy(task);
  const [typing, setTyping] = useState(!canMic || by === 'text');
  const [starting, setStarting] = useState(false);
  const alive = useRef(false);
  const notified = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      rec.current?.cancel();
    };
  }, []);
  useEffect(() => {
    if (!canMic && microphoneFallback(task) === 'replace' && !notified.current) {
      notified.current = true;
      void onMicUnavailable?.();
    }
  }, [canMic, task, onMicUnavailable]);
  const toggle = async () => {
    if (starting) return;
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
      if (!alive.current) return;
      onDraft?.({ audio, ms });
      onReply({ audio, ms });
      return;
    }
    setStarting(true);
    onDraft?.(null);
    try {
      const recording = await record(() => void toggle());
      if (!alive.current) {
        recording.cancel();
        return;
      }
      rec.current = recording;
      setOn(true);
    } catch {
      if (!alive.current) return;
      if (microphoneFallback(task) === 'replace') {
        setErr('Микрофон недоступен. Заменяем задание — без штрафа.');
        notified.current = true;
        await onMicUnavailable?.();
      } else {
        setErr('Микрофон недоступен — отвечай текстом.');
        setTyping(true);
      }
    } finally {
      if (alive.current) setStarting(false);
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
            {task.type === 'roleplay'
              ? `Нейт: ${say}`
              : task.mode === 'transform'
                ? `Было: ${say}`
                : say}
          </p>
          <Speak text={say} />
        </div>
      )}
      {task.focus_ru && <p className="eng-hint">{task.focus_ru}</p>}
      {/* у «Переделай фразу» слова — это и есть ответ: не подсказываем */}
      {task.must_use && task.must_use.length > 0 && task.mode !== 'transform' && (
        <p className="eng-hint">
          Используй: <span lang="en">{task.must_use.join(', ')}</span>
        </p>
      )}
      {canMic && by !== 'text' && (
        <div className="eng-row">
          <Button
            disabled={(locked && !on) || starting}
            aria-pressed={on}
            onClick={() => void toggle()}
          >
            {starting ? 'Подключаю микрофон…' : on ? 'Готово' : 'Говорить'}
          </Button>
          {!typing && by === 'voice_or_text' && (
            <Button size="sm" dot={false} onClick={() => setTyping(true)}>
              Ответить текстом
            </Button>
          )}
        </div>
      )}
      {typing && by !== 'voice' && (
        <TextAnswer
          label="Ответ по-английски"
          locked={locked || on || starting}
          why={false}
          onReply={onReply}
          onDraft={onDraft}
        />
      )}
      {err && <p className="eng-hint">{err}</p>}
      {spoken(task) && !canMic && (
        <p className="eng-hint" role="status">
          {by === 'voice'
            ? 'Микрофон недоступен. Заменяем задание — без штрафа.'
            : 'Микрофон недоступен — отвечай текстом.'}
        </p>
      )}
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
    <div className="eng-stack">
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
    </div>
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
  const [feedback, setFeedback] = useState(readFeedback);
  const setCue = (key: keyof FeedbackSettings, value: boolean) => {
    const next = { ...feedback, [key]: value };
    setFeedback(next);
    writeFeedback(next);
  };
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
      <h3 className="eng-h">Сигналы ответа</h3>
      <div className="eng-switch">
        <span>Звук</span>
        <Switch checked={feedback.sound} onChange={(v) => setCue('sound', v)} label="Звук" />
      </div>
      <div className="eng-switch">
        <span>Вибрация</span>
        <Switch
          checked={feedback.haptics}
          onChange={(v) => setCue('haptics', v)}
          label="Вибрация"
        />
      </div>
      <p className="eng-hint">
        Тихие сигналы на верный и неверный ответ. Только на этом устройстве.
      </p>
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
        wrap
        value={String(s.goal_minutes) as (typeof GOALS)[number]}
        onChange={(v) => set({ goal_minutes: Number(v) })}
        options={GOALS.map((g) => ({ value: g, label: `${g} мин` }))}
      />
      <h3 className="eng-h">Напоминания</h3>
      <div className="eng-switch">
        <span>Нейт напоминает раз в день (колокольчик и Telegram, не ночью и не на уроке)</span>
        <Switch
          checked={s.remind}
          onChange={(v) => set({ remind: v })}
          label="Нейт напоминает раз в день"
        />
      </div>
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
