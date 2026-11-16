import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Presence } from './Presence';

export interface ToastOptions {
  /** ok — получилось (по умолчанию), info — к сведению, bad — не вышло */
  tone?: 'ok' | 'info' | 'bad';
  /** действие можно вернуть: справа появляется «Откатить» */
  undo?: () => void;
  undoLabel?: string;
  /** сколько держать, мс (по умолчанию 5 секунд) */
  ms?: number;
}

export interface ToastApi {
  show(text: ReactNode, options?: ToastOptions): void;
  hide(): void;
}

const ToastCtx = createContext<ToastApi>({ show() {}, hide() {} });

/** Показать короткое подтверждение над Command: `useToast().show('Дело перенесено', { undo })`. */
export const useToast = () => useContext(ToastCtx);

const HOLD_MS = 5000;

interface Shown extends ToastOptions {
  id: number;
  text: ReactNode;
}

/**
 * Место для подтверждений (одно на приложение). Сообщение поднимается над Command, держится
 * 5 секунд и гаснет; пока на нём курсор или фокус — ждёт, чтобы «Откатить» успели нажать.
 */
export function ToastHost({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Shown | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const count = useRef(0);
  const hold = useRef(HOLD_MS);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const run = useCallback(() => {
    stop();
    timer.current = setTimeout(() => setOpen(false), hold.current);
  }, [stop]);
  useEffect(() => stop, [stop]);

  const api = useMemo<ToastApi>(
    () => ({
      show(text, options = {}) {
        hold.current = options.ms ?? HOLD_MS;
        setToast({ ...options, id: ++count.current, text });
        setOpen(true);
        run();
      },
      hide() {
        stop();
        setOpen(false);
      },
    }),
    [run, stop],
  );

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="q-toast-wrap" data-open={open || undefined}>
            <Presence show={open} swap={toast?.id} className="q-toast-in">
              {toast && (
                <div
                  className={`q-toast q-toast-${toast.tone ?? 'ok'}`}
                  role={toast.tone === 'bad' ? 'alert' : 'status'}
                  onPointerEnter={stop}
                  onPointerLeave={run}
                  onFocus={stop}
                  onBlur={run}
                >
                  <span className="q-dot" aria-hidden="true" />
                  <span className="q-toast-text">{toast.text}</span>
                  {toast.undo && (
                    <button
                      type="button"
                      className="q-toast-undo"
                      onClick={() => {
                        toast.undo?.();
                        api.hide();
                      }}
                    >
                      {toast.undoLabel ?? 'Откатить'}
                    </button>
                  )}
                </div>
              )}
            </Presence>
          </div>,
          document.body,
        )}
    </ToastCtx.Provider>
  );
}
