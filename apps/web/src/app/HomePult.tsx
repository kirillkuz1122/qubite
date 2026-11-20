import { Button, Presence } from '@qubite/ui';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useMe } from '../auth/client';
import { SecHead } from './parts';
import { usePult } from './pult';
import { WaitCard } from './PultParts';
import './pult.css';

const MAX_CARDS = 2;

export function PultWaitingPart({ onLayout }: { onLayout: () => void }) {
  const owner = !!useMe().data?.is_owner;
  const board = usePult(owner);
  const navigate = useNavigate();
  const data = board.isSuccess ? board.data : undefined;
  const count = data?.waiting.length ?? 0;

  // Карточка уходит до обновления списка. Сдвигаем соседей до отрисовки следующего кадра.
  const watchLayout = useCallback(
    (section: HTMLElement | null) => {
      if (!section || typeof ResizeObserver !== 'function') return;
      const observer = new ResizeObserver(() => flushSync(onLayout));
      observer.observe(section);
      return () => observer.disconnect();
    },
    [onLayout],
  );

  if (!owner) return null;
  return (
    <Presence show={count > 0} onLayout={onLayout} flip="home-pult">
      {data && count > 0 && (
        <section className="home-pult" aria-label="Ждёт тебя в Пульте" ref={watchLayout}>
          <SecHead text="ЖДЁТ ТЕБЯ В ПУЛЬТЕ" label="Ждёт тебя в Пульте">
            {count > MAX_CARDS ? (
              <Button
                size="sm"
                variant="quiet"
                className="more"
                onClick={() => void navigate({ to: '/pult' })}
              >
                все {count} →
              </Button>
            ) : (
              <span className="n">{count}</span>
            )}
          </SecHead>
          <div className="pult-stack">
            {data.waiting.slice(0, MAX_CARDS).map((w, i) => (
              <WaitCard
                key={w.number}
                w={w}
                now={new Date(data.now)}
                main={i === 0}
                compact
                onOpen={() =>
                  void navigate({
                    to: '/pult',
                    search: () => ({ tab: 'agents', agent: w.key }),
                  })
                }
              />
            ))}
          </div>
        </section>
      )}
    </Presence>
  );
}
