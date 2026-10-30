import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import type { DocHandle } from '@qubite/sync-client';
import { Button, Note, Presence } from '@qubite/ui';
import { useEffect, useState } from 'react';
import { $appendMarkdown } from './markdown';
import { $restoreLost } from './restore';

/** Восстановление читает находки хранилища, включая обмен без открытого экрана. */
export function LostEdits({ handle }: { handle: DocHandle }) {
  const [editor] = useLexicalComposerContext();
  const [lost, setLost] = useState(handle.lost);
  const [recovered, setRecovered] = useState(handle.recovered);
  const [failure, setFailure] = useState(false);
  useEffect(() => handle.onLost(setLost), [handle]);

  const forgetLost = () => {
    void handle.clearLost().catch(() => setFailure(true));
  };
  const forgetRecovered = () => {
    void handle
      .clearRecovered()
      .then(() => setRecovered(null))
      .catch(() => setFailure(true));
  };
  const shown = lost.map((item) => item.text).join(' · ');
  return (
    <>
      {failure && <Note tone="bad">Не удалось сохранить выбор на устройстве. Повторите.</Note>}
      <Presence show={recovered !== null} className="docs-lost">
        <Note>
          <p>На этом устройстве был свой вариант — вставить в конец?</p>
          <div className="docs-lost-actions">
            <Button
              size="sm"
              variant="fill"
              onClick={() => {
                if (recovered === null) return;
                editor.update(() => $appendMarkdown(recovered), { discrete: true });
                forgetRecovered();
              }}
            >
              Вставить
            </Button>
            <Button size="sm" onClick={forgetRecovered}>
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
              onClick={() => {
                editor.update(() => $restoreLost(lost), { discrete: true });
                forgetLost();
              }}
            >
              Вернуть
            </Button>
            <Button size="sm" onClick={forgetLost}>
              Не надо
            </Button>
          </div>
        </Note>
      </Presence>
    </>
  );
}
