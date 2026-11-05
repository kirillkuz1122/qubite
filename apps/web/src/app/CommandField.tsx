import { PlusMenu, Swap, type PlusItem } from '@qubite/ui';
import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import type { VoiceSaved } from './inbox-context';
import { CommandMic, CommandVoiceLive } from './VoiceCapture';
import { useVoice } from './voice-context';

/** Что можно создать из «+»: вставляет команду в начало строки. */
const MENU: PlusItem[] = [
  { value: '/д ', label: 'Дело', color: 'ink', kbd: '/д' },
  { value: '/м ', label: 'Мысль', color: 'yellow', kbd: '/м' },
  { value: '/к ', label: 'Конспект', color: 'sky', kbd: '/к' },
  { value: '/з ', label: 'Запись в дневник', color: 'orange', kbd: '/з' },
];

/** «+» и поле или запись голоса: запись въезжает справа, поле возвращается слева. */
const VIEWS = ['text', 'voice'] as const;

export interface CommandFieldProps {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  wide: boolean;
  /** список подсказок под строкой и выбранный пункт — для экранного диктора */
  listId: string;
  expanded: boolean;
  activeId?: string | undefined;
  onChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onMenu: (open: boolean) => void;
  onFocus: () => void;
  onBlur: () => void;
  /** голосовая запись из строки сохранена (CMD-005b) */
  onVoiceSaved?: (saved: VoiceSaved) => void;
}

/**
 * Содержимое строки Command: «+», поле, справа — микрофон (и Ctrl K на ПК). Пока идёт запись
 * голоса, вместо «+» и поля — таймер и «Отменить», а микрофон перетекает в «стоп».
 */
export function CommandField({
  inputRef,
  value,
  wide,
  listId,
  expanded,
  activeId,
  onChange,
  onKeyDown,
  onMenu,
  onFocus,
  onBlur,
  onVoiceSaved,
}: CommandFieldProps) {
  const voice = useVoice();
  const live = voice.phase !== 'idle';
  /* запись отменили или она не удалась — вернуть человека в поле; сохранили — строка закроется сама */
  const saved = useRef(false);
  const was = useRef(live);
  useEffect(() => {
    if (was.current && !live && voice.origin === 'command' && !saved.current)
      requestAnimationFrame(() => inputRef.current?.focus());
    was.current = live;
    if (!live) saved.current = false;
  }, [live, voice.origin, inputRef]);
  return (
    <>
      <Swap view={live ? 'voice' : 'text'} order={VIEWS} className="cmd-swap">
        {live ? (
          <CommandVoiceLive wide={wide} />
        ) : (
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
              role="combobox"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-expanded={expanded}
              aria-activedescendant={activeId}
              value={value}
              placeholder="Спроси или запиши…"
              aria-label="Строка Command"
              enterKeyHint="send"
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              onFocus={onFocus}
              onBlur={onBlur}
            />
          </>
        )}
      </Swap>
      {wide && <kbd>Ctrl K</kbd>}
      <CommandMic
        onSaved={(s) => {
          saved.current = true;
          onVoiceSaved?.(s);
        }}
      />
    </>
  );
}
