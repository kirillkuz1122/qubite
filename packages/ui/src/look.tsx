/**
 * Вид интерфейса: тема (тёмная, светлая или как в системе), форма и размер точки.
 * Хранится в браузере; тема ставится атрибутом data-theme на <html>, форма точки — переменной --q-round.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { recolorAll } from './dots/engine';
import { dotLook } from './dots/look';
import { PALETTES, type Palette, type ThemeName } from './tokens';
import { themeWave } from './wave';

export type ThemeChoice = ThemeName | 'auto';
export interface Look {
  theme: ThemeChoice;
  /** скругление точки, 0…100 */
  round: number;
  /** размер точки, 60…125 */
  size: number;
}
export const DEFAULT_LOOK: Look = { theme: 'dark', round: 50, size: 95 };
export const LOOK_STORE = 'qubite.look.v1';

export function loadLook(): Look {
  try {
    const raw = localStorage.getItem(LOOK_STORE);
    return raw ? { ...DEFAULT_LOOK, ...(JSON.parse(raw) as Partial<Look>) } : { ...DEFAULT_LOOK };
  } catch {
    return { ...DEFAULT_LOOK };
  }
}

function systemTheme(): ThemeName {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}
export function resolveTheme(choice: ThemeChoice): ThemeName {
  return choice === 'auto' ? systemTheme() : choice;
}

/** Таблица «цвет старой темы → цвет новой» для холстов. */
export function paletteMap(from: ThemeName, to: ThemeName): Record<string, string> {
  const map: Record<string, string> = {};
  (Object.keys(PALETTES[from]) as (keyof Palette)[]).forEach(
    (k) => (map[PALETTES[from][k]] = PALETTES[to][k]),
  );
  return map;
}

interface LookContext {
  look: Look;
  theme: ThemeName;
  palette: Palette;
  /** поменять настройку; для темы — origin, откуда пойдёт волна */
  set<K extends keyof Look>(key: K, value: Look[K], origin?: { x: number; y: number }): void;
}
const Ctx = createContext<LookContext | null>(null);

function applyDom(look: Look, theme: ThemeName): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.setProperty('--q-round', String(look.round / 100));
  dotLook.round = look.round / 100;
  dotLook.size = look.size / 100;
}

export function LookProvider({ children, initial }: { children: ReactNode; initial?: Look }) {
  const [look, setLook] = useState<Look>(() => initial ?? loadLook());
  const [theme, setTheme] = useState<ThemeName>(() => resolveTheme((initial ?? loadLook()).theme));

  useEffect(() => {
    applyDom(look, theme);
    try {
      localStorage.setItem(LOOK_STORE, JSON.stringify(look));
    } catch {
      /* без хранилища просто не запомним */
    }
  }, [look, theme]);

  /* «как в системе»: следим за системной темой */
  useEffect(() => {
    if (look.theme !== 'auto' || typeof matchMedia !== 'function') return;
    const media = matchMedia('(prefers-color-scheme: light)');
    const on = () => {
      const next = systemTheme();
      setTheme((cur) => {
        if (cur !== next) recolorAll(paletteMap(cur, next));
        return next;
      });
    };
    media.addEventListener('change', on);
    return () => media.removeEventListener('change', on);
  }, [look.theme]);

  const set = useCallback<LookContext['set']>(
    (key, value, origin) => {
      const next = { ...look, [key]: value };
      setLook(next);
      if (key !== 'theme') return;
      const from = theme;
      const to = resolveTheme(next.theme);
      if (to === from) return;
      themeWave(PALETTES[to].bg, origin ?? null, () => {
        applyDom(next, to);
        recolorAll(paletteMap(from, to));
        setTheme(to);
      });
    },
    [look, theme],
  );

  const value = useMemo(() => ({ look, theme, palette: PALETTES[theme], set }), [look, theme, set]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLook(): LookContext {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLook: оберни приложение в <LookProvider>');
  return v;
}
