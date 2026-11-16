/**
 * Игры с неправильными глаголами, где на экране сразу несколько глаголов (ENG-008, D-899):
 * «Соедини» — первая форма и её пара; «На время» — минута на «верно / неверно»; «Поиск слов» —
 * формы спрятаны в таблице букв. Игра решает, верно ли; в конце раунда итог по каждому глаголу
 * уходит на сервер той же дорогой, что и занятие: ошибка в игре — «не знал».
 */
import { Button, Note, type CompanionHandle } from '@qubite/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { say } from '../auth/client';
import { playCue } from './english-feedback';
import { ResultBar, SessionResult, TrainerShell, type Session } from './EnglishVerbParts';
import { answerVerb, useRefreshIfClosed, type Verb, type VerbsOverview } from './english-verbs';
import {
  askForm,
  foundWord,
  GRID,
  matchOk,
  matchRight,
  plain,
  SPRINT_SECONDS,
  sprintCard,
  wordGrid,
  type Cell,
} from './english-verbs-games';
import { EMPTY_TALLY, line, tally } from './english-verbs-view';

/** Итог раунда: глагол → всё ли с ним было верно. */
type Results = ReadonlyMap<string, boolean>;

interface GameProps {
  verbs: Verb[];
  all: readonly Verb[];
  seed: string;
  /** Раунд сыгран. */
  onDone: (results: Results) => void;
  /** Подпись под названием: «Пар: 2 из 6», «0:42». */
  onPhase: (text: string) => void;
}

export function VerbRound({
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
  const byId = useMemo(() => new Map(o.verbs.map((v) => [v.id, v])), [o.verbs]);
  const verbs = useMemo(() => session.ids.flatMap((id) => byId.get(id) ?? []), [session.ids, byId]);
  const [phase, setPhase] = useState('');
  const [left, setLeft] = useState<[string, boolean][] | null>(null);
  const [score, setScore] = useState(EMPTY_TALLY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const settled = useRefreshIfClosed();
  const finished = left !== null && left.length === 0 && !saving;

  // Итог по каждому глаголу — на сервер по очереди; оборвалось — можно повторить с того же места.
  const save = async (rest: [string, boolean][]) => {
    setSaving(true);
    setErr(null);
    setLeft(rest);
    let todo = rest;
    try {
      while (todo.length > 0) {
        const [verb, correct] = todo[0]!;
        const a = await answerVerb(verb, session.mode, { correct });
        setScore((s) => tally(s, verb, a.correct, a.game.xp));
        todo = todo.slice(1);
        setLeft(todo);
      }
      nate.current?.setMood('happy');
    } catch (e) {
      setLeft(todo);
      setErr(say(e));
    } finally {
      setSaving(false);
      settled();
    }
  };
  const done = (results: Results) => void save([...results]);

  const game = { verbs, all: o.verbs, seed: String(session.key), onDone: done, onPhase: setPhase };
  const short = verbs.length < 2;
  return (
    <TrainerShell
      nate={nate}
      title={session.title}
      phase={finished ? 'Итог' : left ? 'Записываю…' : phase}
      onClose={onClose}
      view={finished ? 'result' : 'play'}
      bar={
        finished ? (
          <ResultBar onClose={onClose} onMore={onMore} />
        ) : err && left ? (
          <Button variant="fill" disabled={saving} onClick={() => void save(left)}>
            Записать ещё раз
          </Button>
        ) : (
          <p className="eng-hint">
            {left ? 'Записываю результат…' : 'Ошибка в игре — глагол вернётся в повторение.'}
          </p>
        )
      }
    >
      {finished ? (
        <SessionResult score={score} verbs={byId} />
      ) : left ? null : short ? (
        <Note>Для игры нужно хотя бы два глагола — сначала позанимайся.</Note>
      ) : session.mode === 'match' ? (
        <MatchGame {...game} />
      ) : session.mode === 'sprint' ? (
        <SprintGame {...game} />
      ) : (
        <SearchGame {...game} />
      )}
      {err && <Note tone="bad">{err}</Note>}
    </TrainerShell>
  );
}

/** «Соедини»: слева первая форма, справа — вторая и третья. Пара проверяется сразу. */
function MatchGame({ verbs, seed, onDone, onPhase }: GameProps) {
  const right = useMemo(() => matchRight(verbs, seed), [verbs, seed]);
  const [pick, setPick] = useState<{ side: 0 | 1; id: string } | null>(null);
  const [made, setMade] = useState<[string, string][]>([]);
  const [bad, setBad] = useState<[string, string] | null>(null);
  const wrong = useRef(new Set<string>());

  useEffect(() => {
    onPhase(`Пар: ${made.length} из ${verbs.length}`);
  }, [made.length, verbs.length, onPhase]);
  useEffect(() => {
    if (!bad) return;
    const timer = setTimeout(() => setBad(null), 600);
    return () => clearTimeout(timer);
  }, [bad]);

  const tap = (side: 0 | 1, id: string) => {
    if (bad || made.some((pair) => pair[side] === id)) return;
    if (!pick || pick.side === side) {
      setPick(pick?.id === id && pick.side === side ? null : { side, id });
      return;
    }
    const pair: [string, string] = side === 1 ? [pick.id, id] : [id, pick.id];
    setPick(null);
    const ok = matchOk(verbs, pair[0], pair[1]);
    playCue(ok ? 'ok' : 'bad');
    if (!ok) {
      // Перепутал — значит, не уверен в обоих.
      pair.forEach((v) => wrong.current.add(v));
      setBad(pair);
      return;
    }
    const next = [...made, pair];
    setMade(next);
    if (next.length === verbs.length) {
      onDone(new Map(verbs.map((v) => [v.id, !wrong.current.has(v.id)])));
    }
  };
  const tile = (side: 0 | 1, id: string, text: string) => {
    const at = made.findIndex((pair) => pair[side] === id);
    const picked = pick?.side === side && pick.id === id;
    const miss = bad?.[side] === id;
    return (
      <div className="eng-match-word" key={id}>
        <Button
          dot={false}
          className="eng-opt eng-pair"
          data-pair={at >= 0 ? (at % 4) + 1 : undefined}
          data-state={at >= 0 ? 'ok' : miss ? 'bad' : picked ? 'picked' : undefined}
          aria-pressed={picked}
          disabled={at >= 0 || miss}
          aria-label={at >= 0 ? `${text}, пара ${at + 1}` : miss ? `${text}, неверная пара` : text}
          onClick={() => tap(side, id)}
        >
          <span className="eng-pair-n" aria-hidden="true">
            {at >= 0 ? at + 1 : ''}
          </span>
          <span lang="en">{text}</span>
        </Button>
      </div>
    );
  };
  return (
    <section className="eng-card eng-task" aria-label="Соедини">
      <p className="eng-kind">Соедини первую форму с её парой</p>
      <p className="eng-hint" role="status">
        {bad
          ? 'Это не пара. Попробуй ещё раз.'
          : pick
            ? 'Теперь нажми пару в другой колонке'
            : 'Нажми глагол, потом его вторую и третью форму'}
      </p>
      <div className="eng-match" aria-busy={!!bad}>
        <div role="group" aria-label="Первая форма">
          {verbs.map((v) => tile(0, v.id, v.v1))}
        </div>
        <div role="group" aria-label="Вторая и третья форма">
          {right.map((r) => tile(1, r.verb, r.text))}
        </div>
      </div>
    </section>
  );
}

const clock = (seconds: number) => `0:${String(Math.max(seconds, 0)).padStart(2, '0')}`;

/** «На время»: минута, на карточке три формы — верные или с подменой. */
function SprintGame({ verbs, all, seed, onDone, onPhase }: GameProps) {
  const [going, setGoing] = useState(false);
  const [seconds, setSeconds] = useState(SPRINT_SECONDS);
  const [at, setAt] = useState(0);
  const [right, setRight] = useState(0);
  const [last, setLast] = useState<{ ok: boolean; verb: Verb } | null>(null);
  const results = useRef(new Map<string, boolean>());
  const over = useRef(false);
  // Глаголы идут по кругу: за минуту один может встретиться дважды.
  const verb = verbs[at % verbs.length];
  const card = useMemo(
    () => (verb ? sprintCard(verb, all, `${seed}:${at}`) : null),
    [verb, all, seed, at],
  );

  useEffect(() => {
    onPhase(going ? `${clock(seconds)} · верно: ${right}` : 'Минута на всё');
  }, [going, seconds, right, onPhase]);
  useEffect(() => {
    if (!going) return;
    const timer = setInterval(() => setSeconds((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [going]);
  useEffect(() => {
    if (!going || seconds > 0 || over.current) return;
    over.current = true;
    onDone(results.current);
  }, [going, seconds, onDone]);

  const reply = (says: boolean) => {
    if (!card || !verb || seconds <= 0) return;
    const ok = says === card.right;
    playCue(ok ? 'ok' : 'bad');
    results.current.set(verb.id, ok && (results.current.get(verb.id) ?? true));
    if (ok) setRight((n) => n + 1);
    setLast({ ok, verb });
    setAt((n) => n + 1);
  };

  if (!going) {
    return (
      <section className="eng-card eng-start" aria-label="На время">
        <p className="eng-kind">На время</p>
        <p>
          Минута. На карточке три формы глагола — реши, верные они или нет. Чем больше успеешь, тем
          лучше.
        </p>
        <Button variant="fill" autoFocus onClick={() => setGoing(true)}>
          Начать
        </Button>
      </section>
    );
  }
  return (
    <section className="eng-card eng-task" aria-label="На время">
      <div className="vb-timer" role="timer" aria-label={`Осталось ${Math.max(seconds, 0)} секунд`}>
        <span style={{ transform: `scaleX(${Math.max(seconds, 0) / SPRINT_SECONDS})` }} />
      </div>
      <p className="eng-kind">Формы верные?</p>
      {card && (
        <p className="vb-word" lang="en">
          {line(card)}
        </p>
      )}
      <p className="eng-hint">{verb?.ru}</p>
      <div className="eng-row">
        <Button onClick={() => reply(false)}>Неверно</Button>
        <Button onClick={() => reply(true)}>Верно</Button>
      </div>
      <p className="eng-hint" role="status">
        {last
          ? last.ok
            ? 'Прошлый ответ — верно.'
            : `Прошлый ответ — нет. Правильно: ${line(last.verb)}`
          : 'Смотри на вторую и третью форму.'}
      </p>
    </section>
  );
}

const same = (a: Cell | null, b: Cell) => !!a && a[0] === b[0] && a[1] === b[1];

/** «Поиск слов»: нажми первую и последнюю букву спрятанной формы. */
function SearchGame({ verbs, seed, onDone, onPhase }: GameProps) {
  const targets = useMemo(
    () =>
      verbs
        .map((v) => ({ verb: v, word: plain(v[askForm(v, `${seed}:${v.id}`)]) }))
        .filter((t) => /^[a-z]+$/.test(t.word) && t.word.length >= 2 && t.word.length <= GRID),
    [verbs, seed],
  );
  const grid = useMemo(
    () =>
      wordGrid(
        targets.map((t) => ({ verb: t.verb.id, word: t.word })),
        seed,
      ),
    [targets, seed],
  );
  const hidden = grid.placed;
  const [from, setFrom] = useState<Cell | null>(null);
  const [found, setFound] = useState<string[]>([]);
  const [miss, setMiss] = useState(false);

  useEffect(() => {
    onPhase(`Найдено: ${found.length} из ${hidden.length}`);
  }, [found.length, hidden.length, onPhase]);

  const finish = (got: string[]) =>
    onDone(new Map(hidden.map((p) => [p.verb, got.includes(p.verb)])));
  const tap = (cell: Cell) => {
    setMiss(false);
    if (!from) {
      setFrom(cell);
      return;
    }
    if (same(from, cell)) {
      setFrom(null);
      return;
    }
    const word = foundWord(grid, from, cell);
    setFrom(null);
    if (!word || found.includes(word.verb)) {
      playCue('bad');
      setMiss(true);
      return;
    }
    playCue('ok');
    const next = [...found, word.verb];
    setFound(next);
    if (next.length === hidden.length) finish(next);
  };
  const lit = (cell: Cell) =>
    hidden.some((p) => found.includes(p.verb) && p.cells.some((c) => same(c, cell)));

  if (hidden.length === 0) {
    return <Note>Эти глаголы не поместились в таблицу — выбери другую игру.</Note>;
  }
  return (
    <section className="eng-card eng-task" aria-label="Поиск слов">
      <p className="eng-kind">Найди спрятанные формы</p>
      <ul className="vb-find">
        {hidden.map((p) => {
          const target = targets.find((t) => t.verb.id === p.verb);
          const got = found.includes(p.verb);
          return (
            <li key={p.verb} data-found={got ? '' : undefined}>
              <span lang="en">{target?.verb.v1}</span> →{' '}
              <b lang="en">{got ? p.word : `${p.word.length} букв`}</b>
            </li>
          );
        })}
      </ul>
      <p className="eng-hint" role="status">
        {miss
          ? 'Здесь формы нет. Слова идут слева направо или сверху вниз.'
          : from
            ? 'Теперь нажми последнюю букву слова'
            : 'Нажми первую букву слова, потом последнюю'}
      </p>
      <div
        className="vb-grid"
        role="grid"
        aria-label="Таблица букв"
        style={{ gridTemplateColumns: `repeat(${GRID}, minmax(0, 1fr))` }}
      >
        {grid.rows.flatMap((row, r) =>
          row.map((letter, c) => {
            const cell: Cell = [r, c];
            return (
              <button
                key={`${r}:${c}`}
                type="button"
                role="gridcell"
                className="vb-cell"
                data-from={same(from, cell) ? '' : undefined}
                data-found={lit(cell) ? '' : undefined}
                aria-label={`${letter}, строка ${r + 1}, столбец ${c + 1}`}
                aria-pressed={same(from, cell)}
                onClick={() => tap(cell)}
              >
                {letter}
              </button>
            );
          }),
        )}
      </div>
      <div className="eng-row">
        <Button dot={false} onClick={() => finish(found)}>
          Сдаюсь
        </Button>
      </div>
    </section>
  );
}
