import { Button, Note, Sheet } from '@qubite/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CommandKind } from './command-dispatch';
import { commandChatMode, type CommandTurn } from './use-command-chat';
import './command-chat.css';

function cost(value: number) {
  return `$${value.toLocaleString('ru', { maximumFractionDigits: 6 })}`;
}

export function CommandChat({
  turns,
  wide,
  open,
  busy,
  error,
  footer,
  onClose,
  onConfirm,
  onCorrect,
}: {
  turns: readonly CommandTurn[];
  wide: boolean;
  open: boolean;
  busy: boolean;
  error: string | null;
  footer: ReactNode;
  onClose: () => void;
  onConfirm: (turn: CommandTurn) => void;
  onCorrect: (turn: CommandTurn, kind: CommandKind) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open, turns]);
  const mode = commandChatMode(wide, turns, expanded);
  return (
    <Sheet
      open={open}
      title="Command"
      className={`command-chat command-chat-${mode}`}
      onClose={onClose}
      footer={footer}
    >
      {wide && mode === 'popover' && (
        <div className="command-expand">
          <Button variant="quiet" onClick={() => setExpanded(true)}>
            Развернуть
          </Button>
        </div>
      )}
      <div className="command-turns" role="log" aria-label="Разговор Command">
        {turns.map((turn) => {
          const { request, result } = turn;
          return (
            <div className="command-turn" key={result.id}>
              <p className="command-bubble command-user">{request.text}</p>
              <div>
                <p className="command-byline">
                  <span>
                    <i className="q-dot" /> Диспетчер
                  </span>
                  {result.model && ` · ${result.model} · ${cost(result.cost_usd / 1_000_000)}`}
                </p>
                <p className="command-bubble command-agent">{result.message}</p>
              </div>
              {result.status === 'needs_confirm' && (
                <div className="command-actions">
                  <span>
                    Оценка{' '}
                    {result.estimate_percent == null
                      ? 'доли пока недоступна'
                      : `≈ ${result.estimate_percent.toLocaleString('ru', { maximumFractionDigits: 1 })}% недели`}
                    {result.estimate_usd != null && ` · ≈ ${cost(result.estimate_usd)}`}
                  </span>
                  <Button
                    variant={turn === turns.at(-1) ? 'fill' : 'outline'}
                    disabled={busy}
                    onClick={() => onConfirm(turn)}
                  >
                    Да, запустить
                  </Button>
                </div>
              )}
              <div className="command-actions">
                {result.kind !== 'question' && (
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() => onCorrect(turn, 'question')}
                  >
                    Это вопрос
                  </Button>
                )}
                <Button variant="quiet" disabled={busy} onClick={() => onCorrect(turn, 'thought')}>
                  Это мысль
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {busy && <Note>Диспетчер думает…</Note>}
      {error && <Note tone="bad">{error}</Note>}
      <div ref={end} />
    </Sheet>
  );
}
