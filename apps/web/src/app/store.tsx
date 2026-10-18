import { useMemo, useReducer, type ReactNode } from 'react';
import { initialState, reducer, StoreCtx, type State } from './state';

/** Хранилище оболочки в памяти: после перезагрузки страницы всё как было. */
export function StoreProvider({ children, initial }: { children: ReactNode; initial?: State }) {
  const [state, dispatch] = useReducer(reducer, initial ?? null, (i) => i ?? initialState());
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
