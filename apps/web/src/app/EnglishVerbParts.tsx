/**
 * Общие части тренажёра глаголов (ENG-008): рамка занятия на весь экран, список глаголов, итог.
 * Ими пользуются и занятие по одному глаголу (`EnglishVerbs`), и игры (`EnglishVerbGames`).
 */
import { Button, Companion, Swap, useMedia, WIDE, type CompanionHandle } from '@qubite/ui';
import type { ReactNode, RefObject } from 'react';
import type { Verb, VerbMode } from './english-verbs';
import {
  line,
  stateLabel,
  tone,
  whenLabel,
  type Scope,
  type Tally,
  type Tone,
} from './english-verbs-view';

/** Занятие или игра: что учим и чем. */
export interface Session {
  /** Меняется с каждым новым занятием: экран начинает с чистого листа. */
  key: number;
  title: string;
  scope: Scope;
  mode: VerbMode;
  ids: string[];
  /** Повторять нечего — занятие «впрок»: срок оно не двигает. */
  ahead: boolean;
}

/** Глаголы списком: три формы, перевод, что с глаголом и когда повторять. */
export function VerbRows({
  verbs,
  today,
  as,
}: {
  verbs: readonly Verb[];
  /** С датой — показываем состояние и срок; без неё — просто список. */
  today?: string;
  /** Одна точка на всех (итог, новые) вместо состояния каждого. */
  as?: Tone;
}) {
  return (
    <ul className="vb-rows">
      {verbs.map((v) => (
        <li key={v.id}>
          <span className="vb-dot" data-tone={as ?? tone(v.progress)} aria-hidden="true" />
          <span className="vb-row-t">
            <b lang="en">{line(v)}</b>
            <em>
              {v.ru}
              {today && !v.progress.new && ` · ${stateLabel(v.progress)}`}
            </em>
          </span>
          {today && <span className="vb-row-when">{whenLabel(v.progress, today)}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Какая часть нижней полосы показана — для плавной смены. */
const BAR = ['intro', 'check', 'wait', 'grade', 'answered', 'play', 'result'] as const;
export type BarView = (typeof BAR)[number];

/** Экран занятия: Нейт, название, ход, «Закрыть»; содержимое и нижняя полоса — от занятия. */
export function TrainerShell({
  nate,
  title,
  phase,
  progress,
  onClose,
  children,
  bar,
  view,
  verdict = null,
}: {
  nate: RefObject<CompanionHandle | null>;
  title: string;
  phase: string;
  progress?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  bar: ReactNode;
  view: BarView;
  verdict?: 'ok' | 'wrong' | null;
}) {
  const wide = useMedia(WIDE);
  return (
    <div className="eng-lesson">
      <header className="eng-stage">
        <Companion ref={nate} kind="neit" pitch={wide ? 6 : 4} label="Нейт — репетитор" />
        <div className="eng-who">
          <b>{title}</b>
          <span className="eng-phase">{phase}</span>
          {progress}
        </div>
        <Button size="sm" dot={false} onClick={onClose} className="eng-close">
          Закрыть
        </Button>
      </header>
      <section className="eng-lesson-work">
        <div className="eng-lesson-content">
          <div className="eng-lesson-column">{children}</div>
        </div>
        <footer className="eng-lesson-bottom">
          <div className="eng-lesson-column">
            <div
              className="eng-answer-bar"
              data-ok={verdict === 'ok' ? '' : undefined}
              data-wrong={verdict === 'wrong' ? '' : undefined}
            >
              <Swap className="eng-answer-bar-content" view={view} order={BAR}>
                {bar}
              </Swap>
            </div>
          </div>
        </footer>
      </section>
    </div>
  );
}

/** Итог занятия или игры: сколько с первого раза, какие глаголы вернутся, опыт. */
export function SessionResult({
  score,
  verbs,
  ahead = false,
}: {
  score: Tally;
  verbs: ReadonlyMap<string, Verb>;
  ahead?: boolean;
}) {
  return (
    <section className="eng-card" aria-label="Итог занятия">
      <h3 className="eng-h">Занятие закончено</h3>
      <p>
        С первого раза: {score.clean.length} из {score.clean.length + score.missed.length}
      </p>
      {score.missed.length > 0 && (
        <>
          <p className="eng-hint">Эти вернутся раньше остальных:</p>
          <VerbRows verbs={score.missed.flatMap((id) => verbs.get(id) ?? [])} as="hard" />
        </>
      )}
      {score.xp > 0 && <p className="eng-gain">+{score.xp} XP</p>}
      {ahead && (
        <p className="eng-hint">
          Это было занятие впрок: срок повторения оно не сдвигает, ошибки — учитывает.
        </p>
      )}
    </section>
  );
}

/** Кнопки итога: «Готово» и «Ещё». */
export function ResultBar({ onClose, onMore }: { onClose: () => void; onMore: () => void }) {
  return (
    <div className="eng-row">
      <Button onClick={onClose}>Готово</Button>
      <Button variant="fill" autoFocus onClick={onMore}>
        Ещё глаголы
      </Button>
    </div>
  );
}
