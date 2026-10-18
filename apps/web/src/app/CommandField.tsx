import { DotIcon, PlusMenu, usePress, type PlusItem } from '@qubite/ui';
import type { RefObject } from 'react';

/** Что можно создать из «+»: вставляет команду в начало строки. */
const MENU: PlusItem[] = [
  { value: '/д ', label: 'Дело', color: 'ink', kbd: '/д' },
  { value: '/м ', label: 'Мысль', color: 'yellow', kbd: '/м' },
  { value: '/к ', label: 'Конспект', color: 'sky', kbd: '/к' },
  { value: '/з ', label: 'Запись в дневник', color: 'orange', kbd: '/з' },
];

export interface CommandFieldProps {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  wide: boolean;
  onChange: (v: string) => void;
  onMenu: (open: boolean) => void;
  onFocus: () => void;
  onBlur: () => void;
}

/** Содержимое строки Command: «+», поле, справа — Ctrl K на ПК или микрофон на телефоне. */
export function CommandField({
  inputRef,
  value,
  wide,
  onChange,
  onMenu,
  onFocus,
  onBlur,
}: CommandFieldProps) {
  return (
    <>
      <PlusMenu
        items={MENU}
        onOpenChange={onMenu}
        onPick={(it) => {
          onChange(it.value);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      />
      {wide && <span className="q-caret" aria-hidden="true" />}
      <input
        ref={inputRef}
        className="q-cmd-input"
        type="text"
        value={value}
        placeholder="Спроси или запиши…"
        aria-label="Строка Command"
        enterKeyHint="send"
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {wide ? <kbd>Ctrl K</kbd> : <MicButton />}
    </>
  );
}

/**
 * Микрофон: голосовой ввод появится позже (вопрос Q-11). Пока кнопка только пружинит —
 * и, главное, не уводит фокус из строки, поэтому строка Command не сворачивается.
 */
function MicButton() {
  const press = usePress(0.8);
  return (
    <button
      {...press}
      type="button"
      className="q-mic"
      aria-label="Голосом — скоро"
      title="Голосом — скоро"
      onPointerDown={(e) => {
        e.preventDefault(); // фокус остаётся в строке
        press.onPointerDown(e);
      }}
    >
      <DotIcon name="mic" />
    </button>
  );
}
