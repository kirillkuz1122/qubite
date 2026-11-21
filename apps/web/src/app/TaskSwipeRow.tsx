import { SwipeRow } from '@qubite/ui';
import type { ReactNode } from 'react';
import { useShell } from './context';
import { EDGE_BACK_MAX, EDGE_BACK_MIN } from './EdgeBack';
import { usePlanner, type TaskDestination } from './planner-context';

export function TaskSwipeRow({
  id,
  done,
  columns,
  children,
}: {
  id: string;
  done: boolean;
  columns?: readonly TaskDestination[];
  children: ReactNode;
}) {
  const planner = usePlanner();
  const shell = useShell();
  return (
    <SwipeRow
      onEdit={() => planner.openTask(id)}
      onPlace={() => planner.placeTask(id, columns)}
      onDelete={() => void planner.swipeTask(id, 'delete')}
      onDone={
        done
          ? undefined
          : () => {
              void planner.swipeTask(id, 'done');
              shell.cheer('proto');
            }
      }
      filter={(event, target) =>
        !history.state?.qubitePreviousApp ||
        event.clientX < EDGE_BACK_MIN ||
        event.clientX > EDGE_BACK_MAX ||
        !!target.closest('.board [data-card]')
      }
    >
      {children}
    </SwipeRow>
  );
}
