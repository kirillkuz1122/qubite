import { DotIcon } from './icons';
import { usePress } from './press';

export interface MicButtonProps {
  /** идёт запись: микрофон перетекает в квадрат «остановить» */
  recording: boolean;
  /** что сделает нажатие — для читалки и подсказки («Записать голосом», «Остановить и отправить») */
  label: string;
  onClick: () => void;
  /** fill — оранжевый круг (главное действие экрана); plain — значок в строке, во время записи — круг */
  variant?: 'plain' | 'fill';
  /** не уводить фокус из поля рядом (строка Command не сворачивается) */
  keepFocus?: boolean;
  disabled?: boolean;
}

/**
 * Кнопка записи голоса: микрофон из точек, под пальцем пружинит. Пока идёт запись, точки
 * перетекают в квадрат «остановить», а кнопка становится оранжевой — видно, что микрофон включён.
 */
export function MicButton({
  recording,
  label,
  onClick,
  variant = 'plain',
  keepFocus = false,
  disabled = false,
}: MicButtonProps) {
  const press = usePress(0.8);
  return (
    <button
      {...press}
      type="button"
      className={['q-mic', variant === 'fill' && 'q-mic-fill', recording && 'q-mic-on']
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={(e) => {
        if (keepFocus) e.preventDefault(); // фокус остаётся в строке
        press.onPointerDown(e);
      }}
      onClick={onClick}
    >
      <DotIcon name={recording ? 'stop' : 'mic'} />
    </button>
  );
}
