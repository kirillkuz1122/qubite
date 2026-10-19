/**
 * Состояние оболочки в памяти: документы и включённые помощники.
 * «Входящие» (`inbox.tsx`), «Сегодня» и Planner (`planner.tsx`) — уже настоящие данные.
 */
import type { CompanionKind } from '@qubite/ui';
import { createContext, useContext } from 'react';
import { DOCS, newId, type Doc } from './data';

export interface State {
  docs: Doc[];
  helpers: Record<CompanionKind, boolean>;
}

export type Action =
  { type: 'doc.add'; name: string } | { type: 'helper'; kind: CompanionKind; on: boolean };

export function initialState(): State {
  return {
    docs: DOCS.map((x) => ({ ...x })),
    helpers: { elik: true, proto: true, neit: true, foti: true },
  };
}

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'doc.add':
      return {
        ...s,
        docs: [
          {
            id: newId('d'),
            name: a.name,
            pre: 'новая страница — допишешь потом',
            tags: [['sky', 'Конспект']],
            when: 'сейчас',
          },
          ...s.docs,
        ],
      };
    case 'helper':
      return { ...s, helpers: { ...s.helpers, [a.kind]: a.on } };
  }
}

export const StoreCtx = createContext<{ state: State; dispatch: (a: Action) => void } | null>(null);

export function useStore() {
  const v = useContext(StoreCtx);
  if (!v) throw new Error('useStore: оберни в <StoreProvider>');
  return v;
}
