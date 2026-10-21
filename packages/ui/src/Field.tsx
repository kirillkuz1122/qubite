import { loop } from '@qubite/motion';
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { caretPoint, focusOn } from './dots/attention';
import { DotIcon } from './icons';
import { useSpring } from './useSpring';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  /** подсказка под полем */
  hint?: ReactNode;
  /** ошибка под полем: поле краснеет и коротко качается */
  error?: string | null;
  /** для пароля: кнопка-глаз «показать / спрятать» */
  reveal?: boolean;
  /** пароль показан или спрятан (помощники отворачиваются, когда он виден) */
  onReveal?: (shown: boolean) => void;
  /** помощники смотрят на каретку, пока поле в фокусе (для пароля — нет) */
  watch?: boolean;
}

/**
 * Поле ввода «Частиц»: подпись сверху, подсказка или ошибка снизу. Пока в поле печатают,
 * помощники смотрят на каретку. Ошибка — поле качается пружиной (только transform).
 */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  {
    label,
    hint,
    error,
    reveal = false,
    onReveal,
    watch,
    type = 'text',
    className,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => input.current as HTMLInputElement);
  const [shown, setShown] = useState(false);
  const looks = watch ?? type !== 'password';
  const shake = useSpring(0, 0.35, (x) => {
    if (box.current) box.current.style.transform = x === 0 ? '' : `translateX(${x.toFixed(2)}px)`;
  });

  useEffect(() => {
    if (!error) return;
    loop().kick(shake, 260);
  }, [error, shake]);

  useEffect(() => () => focusOn(null), []);

  const describedBy = error || hint ? `${id}-note` : undefined;
  return (
    <div className={['q-field', error && 'q-bad', className].filter(Boolean).join(' ')}>
      <label className="q-field-label" htmlFor={id}>
        {label}
      </label>
      <div className="q-field-box" ref={box}>
        <input
          ref={input}
          id={id}
          type={reveal && shown ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onFocus={(e) => {
            if (looks) focusOn(() => (input.current ? caretPoint(input.current) : null));
            onFocus?.(e);
          }}
          onBlur={(e) => {
            if (looks) focusOn(null);
            onBlur?.(e);
          }}
          {...rest}
        />
        {reveal && (
          <button
            type="button"
            className="q-field-eye"
            aria-pressed={shown}
            aria-label={shown ? 'Спрятать пароль' : 'Показать пароль'}
            onClick={() => {
              setShown(!shown);
              onReveal?.(!shown);
            }}
          >
            <DotIcon name={shown ? 'eye-off' : 'eye'} size={22} />
          </button>
        )}
      </div>
      {describedBy && (
        <p className="q-field-note" id={`${id}-note`} role={error ? 'alert' : undefined}>
          {error || hint}
        </p>
      )}
    </div>
  );
});
