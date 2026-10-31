import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import type { DocHandle, LostBlock } from '@qubite/sync-client';
import { Button, Note, Presence } from '@qubite/ui';
import { useEffect, useState } from 'react';
import { $appendRecovered, $restoreLost } from './restore';

/** Дописки и запасной Markdown принадлежат хранилищу и переживают закрытие экрана. */
export function LostEdits({ handle }: { handle: DocHandle }) {
  const [editor] = useLexicalComposerContext();
  const [lost, setLost] = useState<LostBlock[]>(handle.lost);
  const [recovered, setRecovered] = useState(handle.recovered);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => handle.onLost(setLost), [handle]);
  useEffect(() => handle.onStatus(() => setRecovered(handle.recovered)), [handle]);

  const accept = async (kind: 'lost' | 'recovered', restore: boolean) => {
    setBusy(true);
    setError(false);
    try {
      if (restore) {
        editor.update(
          () => {
            if (kind === 'lost') $restoreLost(handle.lost);
            else if (recovered !== null) $appendRecovered(recovered);
          },
          { discrete: true },
        );
      }
      // Сначала редактор записал Yjs на устройство, потом убираем предложение.
      if (kind === 'lost') await handle.clearLost();
      else await handle.clearRecovered();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const shown = lost.map((item) => item.text).join(' · ');
  return (
    <>
      <Presence show={recovered !== null} className="docs-lost">
        <Note>
          <p>На этом устройстве был свой вариант — вставить в конец?</p>
          <div className="docs-lost-actions">
            <Button
              size="sm"
              variant="fill"
              disabled={busy}
              onClick={() => void accept('recovered', true)}
            >
              Вставить
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void accept('recovered', false)}>
              Не надо
            </Button>
          </div>
        </Note>
      </Presence>
      <Presence show={lost.length > 0} className="docs-lost">
        <Note>
          <p>
            На другом устройстве блок удалили, а здесь в него дописали: «
            {shown.length > 120 ? `${shown.slice(0, 120)}…` : shown}». Вернуть?
          </p>
          <div className="docs-lost-actions">
            <Button
              size="sm"
              variant="fill"
              disabled={busy}
              onClick={() => void accept('lost', true)}
            >
              Вернуть
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void accept('lost', false)}>
              Не надо
            </Button>
          </div>
        </Note>
      </Presence>
      <Presence show={error}>
        <Note tone="bad">Не удалось сохранить выбор на устройстве. Попробуйте ещё раз.</Note>
      </Presence>
    </>
  );
}
