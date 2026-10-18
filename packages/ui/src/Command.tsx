import { loop } from '@qubite/motion';
import { useRef, useState } from 'react';
import { caretPoint, focusOn } from './dots/attention';
import { COMMAND_COLOR, parseCommand, type ParsedCommand } from './command';
import { DotIcon } from './icons';
import { useSpring } from './useSpring';

export interface CommandProps {
  placeholder?: string;
  /** Enter или кнопка: что сохранить и куда */
  onSave?: (cmd: ParsedCommand) => void;
  /** каждое изменение текста (например, чтобы помощники закрыли глаза на «пароль») */
  onInput?: (value: string) => void;
}

/**
 * Строка Command: пиши как думаешь, под строкой видно, куда ляжет запись.
 * Пока поле в фокусе, помощники смотрят на каретку.
 */
export function Command({ placeholder = 'Спроси или запиши…', onSave, onInput }: CommandProps) {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState<ParsedCommand | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const parsed = parseCommand(value);
  const shown = parsed ?? saved;
  const kindRef = useRef<string | null>(null);
  const pop = useSpring(1, 0.8, (x) => {
    if (card.current) card.current.style.transform = `scaleY(${Math.max(0.2, x).toFixed(4)})`;
  });

  function change(v: string) {
    setValue(v);
    onInput?.(v);
    setSaved(null);
    const k = parseCommand(v)?.kind ?? null;
    if (k && k !== kindRef.current) {
      const L = loop();
      L.set(pop, 0.5);
      L.to(pop, 1);
    }
    kindRef.current = k;
  }
  function save() {
    if (!parsed) return;
    onSave?.(parsed);
    setSaved(parsed);
    setValue('');
    onInput?.('');
    kindRef.current = null;
  }

  return (
    <div className="q-command-wrap">
      <form
        className="q-command"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <span className="q-caret" aria-hidden="true" />
        <input
          ref={input}
          value={value}
          placeholder={placeholder}
          aria-label="Строка Command"
          onChange={(e) => change(e.target.value)}
          onFocus={() => focusOn(() => (input.current ? caretPoint(input.current) : null))}
          onBlur={() => focusOn(null)}
        />
        <button className="q-send" type="submit" aria-label="Сохранить">
          <DotIcon name="send" />
        </button>
      </form>
      {shown && (
        <div className="q-command-card" role="status">
          <div className="q-command-card-bg" ref={card} />
          <div className="q-command-card-in">
            <span
              className="q-dot"
              style={{ background: `var(--q-${COMMAND_COLOR[shown.kind]})` }}
            />
            <b>{saved && !parsed ? `Сохранено: ${shown.title.toLowerCase()}` : shown.title}</b>
            <span>
              → {shown.where}
              {shown.when ? ` · ${shown.when}` : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
