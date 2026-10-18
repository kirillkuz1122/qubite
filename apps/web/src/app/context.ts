import type { ColorName, CompanionKind } from '@qubite/ui';
import { createContext, useContext } from 'react';
import type { SectionId } from './data';

/** Что оболочка даёт разделам: помощник прыгает, точка летит в раздел, переход. */
export interface ShellApi {
  /** помощник радуется — если он сейчас на виду */
  cheer(kind: CompanionKind): void;
  /** точка долетает от from до пункта раздела в навигации */
  fly(from: { x: number; y: number }, to: SectionId, color: ColorName, done?: () => void): void;
  go(to: SectionId): void;
  /** ПК (боковая панель) или телефон (капля снизу) */
  wide: boolean;
}

export const ShellCtx = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const v = useContext(ShellCtx);
  if (!v) throw new Error('useShell: только внутри оболочки');
  return v;
}
