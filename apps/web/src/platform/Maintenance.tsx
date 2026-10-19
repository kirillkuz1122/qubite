import { Button, DotGrid, DotText, Gang, Note, useMedia, WIDE, type GangHandle } from '@qubite/ui';
import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  MAINTENANCE_EVENT,
  ME,
  untilText,
  useMe,
  usePlatform,
  type PlatformStatus,
} from '../auth/client';
import './maintenance.css';

/** Текст по умолчанию (D-216), если сервер прислал пустой. */
const DEFAULT_TEXT =
  'Qubite ненадолго закрылся на обновление: подкручиваем винтики и добавляем новое. Все ваши заметки и дела на месте — скоро вернёмся!';

/** Что открыто и во время техработ: вход (owner должен войти) и документы. */
function openDuringMaintenance(path: string): boolean {
  return path === '/auth' || path.startsWith('/legal/') || path === '/design';
}

/**
 * Техработы (ACC-004, D-216): всем, кроме owner, вместо сайта — добрый экран с текстом
 * owner и «вернёмся к …», если он задал время. Owner работает как обычно и видит полоску
 * «идут техработы». Состояние платформы проверяется раз в 30 секунд и при возврате во вкладку.
 */
export function MaintenanceGate({ children }: { children: ReactNode }) {
  const status = usePlatform();
  const me = useMe();
  const qc = useQueryClient();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const on = status.data?.maintenance === true;
  const { refetch } = status;

  // любой ответ «техработы» от сервера — сразу перепроверить состояние
  useEffect(() => {
    const check = () => void refetch();
    addEventListener(MAINTENANCE_EVENT, check);
    return () => removeEventListener(MAINTENANCE_EVENT, check);
  }, [refetch]);
  // техработы кончились — заново узнать, кто вошёл (во время них сервер не отвечал)
  const was = useRef(on);
  useEffect(() => {
    if (was.current && !on) void qc.invalidateQueries({ queryKey: ME });
    was.current = on;
  }, [on, qc]);
  const blocked = on && !openDuringMaintenance(path) && !me.data?.is_owner;
  if (blocked) {
    // пока не знаем, owner ли это, — ничего не показываем (без мигания чужого экрана)
    if (me.isPending) return null;
    return <MaintenanceScreen status={status.data!} onRetry={() => void status.refetch()} />;
  }
  // одна и та же раскладка с полоской и без — страница не пересоздаётся при включении
  return (
    <>
      {on && me.data?.is_owner && <OwnerStrip status={status.data!} />}
      {children}
    </>
  );
}
function OwnerStrip({ status }: { status: PlatformStatus }) {
  return (
    <div className="mt-strip" role="status">
      <span className="q-dot" aria-hidden="true" />
      <span>
        Идут техработы
        {status.maintenance_until && (
          <> до {untilText(status.maintenance_until, status.timezone)}</>
        )}
      </span>
      <span className="mt-strip-more">— их видят все, кроме вас</span>
      <Link to="/account" hash="maintenance">
        Выключить →
      </Link>
    </div>
  );
}

export function MaintenanceScreen({
  status,
  onRetry,
}: {
  status: PlatformStatus;
  onRetry(): void;
}) {
  const wide = useMedia(WIDE);
  const gang = useRef<GangHandle>(null);
  useEffect(() => {
    document.title = 'Техработы · Qubite';
    const t = setTimeout(() => gang.current?.setMood('shut'), 900);
    return () => clearTimeout(t);
  }, []);
  const until = status.maintenance_until;
  return (
    <div className="mt">
      <DotGrid />
      <main className="mt-main">
        <Gang ref={gang} pitch={wide ? 4 : 3.2} label="Помощники дремлют" />
        <h1 className="q-sr">Техработы</h1>
        <div className="mt-title" aria-hidden="true">
          <DotText text="ТЕХРАБОТЫ" pitch={wide ? 5 : 3.4} color="orange" label="" />
        </div>
        <p className="mt-text">{status.maintenance_message || DEFAULT_TEXT}</p>
        {until && (
          <Note tone="info" className="mt-until">
            Вернёмся к <b>{untilText(until, status.timezone)}</b>
          </Note>
        )}
        <div className="mt-actions">
          <Button variant="fill" onClick={onRetry}>
            Проверить ещё раз
          </Button>
          <Link className="mt-owner" to="/auth">
            Я владелец — войти
          </Link>
        </div>
      </main>
    </div>
  );
}
