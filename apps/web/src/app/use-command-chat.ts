import { uuidv7 } from '@qubite/sync-client';
import { useToast } from '@qubite/ui';
import { useEffect, useRef, useState } from 'react';
import { say } from '../auth/client';
import {
  dispatchCommand,
  reclassifyCommand,
  type CommandKind,
  type DispatchRequest,
  type DispatchResult,
} from './command-dispatch';

export interface CommandTurn {
  request: DispatchRequest;
  result: DispatchResult;
}

const LONG_CHAT = 1200;

export function commandChatMode(wide: boolean, turns: readonly CommandTurn[], expanded: boolean) {
  if (!wide) return turns.length >= 2 ? 'full' : 'overlay';
  const length = turns.reduce(
    (n, { request, result }) => n + request.text.length + result.message.length,
    0,
  );
  return expanded || turns.length >= 4 || length >= LONG_CHAT ? 'expanded' : 'popover';
}

export function useCommandChat(account: string | undefined, onChange: () => void) {
  const toast = useToast();
  const [turns, setTurns] = useState<CommandTurn[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const current = useRef(account);
  const last = useRef<DispatchRequest | null>(null);

  const [scope, setScope] = useState(account);
  if (scope !== account) {
    setScope(account);
    setTurns([]);
    setOpen(false);
    setError(null);
  }
  useEffect(() => {
    current.current = account;
    last.current = null;
  }, [account]);

  async function run(request: DispatchRequest, kind?: CommandKind) {
    if (!account || account !== current.current || pending.current) return false;
    const id = request.id ?? uuidv7();
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = kind
        ? await reclassifyCommand(id, kind)
        : await dispatchCommand({ ...request, id });
      if (account !== current.current) return false;
      if (result.kind === 'thought') {
        if (kind) setTurns((list) => list.filter((turn) => turn.result.id !== result.id));
        toast.show(result.message, {
          undoLabel: 'Это вопрос',
          undo: () => void run({ ...request, id: result.id }, 'question'),
        });
      } else {
        setTurns((list) => {
          const turn = { request: { ...request, id: result.id }, result };
          return list.some((previous) => previous.result.id === result.id)
            ? list.map((previous) => (previous.result.id === result.id ? turn : previous))
            : [...list, turn];
        });
        setOpen(true);
      }
      if (result.status === 'done') onChange();
      return result.kind;
    } catch (e) {
      if (account !== current.current) return false;
      setError(say(e));
      toast.show(say(e), { tone: 'bad' });
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function send(text: string, source: DispatchRequest['source']) {
    const cleaned = text.trim();
    if (!cleaned || pending.current) return false;
    const previous = last.current;
    const request =
      previous?.text === cleaned && (previous.source === source || source === 'web')
        ? previous
        : { id: uuidv7(), text: cleaned, source };
    last.current = request;
    const sent = await run(request);
    if (sent) last.current = null;
    return sent;
  }

  return {
    turns,
    open: !!account && open,
    busy,
    error,
    send,
    close: () => setOpen(false),
    confirm: (turn: CommandTurn) => run({ ...turn.request, confirm: true }),
    correct: (turn: CommandTurn, kind: CommandKind) => run(turn.request, kind),
  };
}
