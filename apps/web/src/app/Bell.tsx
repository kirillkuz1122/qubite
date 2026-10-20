/**
 * Колокольчик (PLAN-004): всё, что Qubite написал тебе, — напоминания о делах, позже сообщения
 * агента. Пока вкладка видна, сервер не шлёт push и Telegram (одно сообщение — один канал),
 * а новое всплывает здесь же. Прочитал здесь — гаснет в Telegram и в системных уведомлениях.
 */
import type { components } from '@qubite/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { must, useMe } from '../auth/client';
import { noticeLine, noticeWhen } from './notice-view';
import { closeShown } from './push';

type NoticeItem = components['schemas']['NoticeItem'];
type NoticeList = components['schemas']['NoticeList'];

const NOTICES = ['notices'] as const;

/** Вкладка видна — сервер знает, что ты в Qubite (раз в минуту и при переключении). */
function usePresence(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const tell = (visible: boolean) =>
      void api.POST('/api/v1/notifications/presence', { body: { visible } }).catch(() => null);
    const now = () => tell(document.visibilityState === 'visible');
    now();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') tell(true);
    }, 60_000);
    const hide = () => tell(false);
    document.addEventListener('visibilitychange', now);
    window.addEventListener('pagehide', hide);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', now);
      window.removeEventListener('pagehide', hide);
    };
  }, [on]);
}

export function Bell() {
  const me = useMe();
  const on = !!me.data;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<NoticeItem | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const box = useRef<HTMLDivElement>(null);
  usePresence(on);

  const list = useQuery({
    queryKey: NOTICES,
    queryFn: () => must(api.GET('/api/v1/notifications', { params: { query: { limit: 30 } } })),
    enabled: on,
    refetchInterval: () => (document.visibilityState === 'visible' ? 30_000 : false),
    refetchOnWindowFocus: true,
  });

  const read = useMutation({
    mutationFn: (id: string) =>
      must(api.POST('/api/v1/notifications/{id}/read', { params: { path: { id } } })),
    onMutate: (id) => {
      qc.setQueryData<NoticeList>(NOTICES, (old) =>
        old
          ? {
              unread: Math.max(
                0,
                old.unread - (old.items.some((n) => n.id === id && !n.read_at) ? 1 : 0),
              ),
              items: old.items.map((n) =>
                n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n,
              ),
            }
          : old,
      );
      void closeShown([id]);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: NOTICES }),
  });
  const readAll = useMutation({
    mutationFn: () => must(api.POST('/api/v1/notifications/read-all')),
    onSettled: () => void qc.invalidateQueries({ queryKey: NOTICES }),
  });
  const markRead = read.mutate;

  // Открыли из push (`?notice=…` или сообщение service worker) — прочитано.
  useEffect(() => {
    if (!on) return;
    const url = new URL(location.href);
    const id = url.searchParams.get('notice');
    if (id) {
      markRead(id);
      url.searchParams.delete('notice');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; id?: string | null } | null;
      if (d?.type === 'qubite:notice' && d.id) markRead(d.id);
    };
    sw.addEventListener('message', onMessage);
    return () => sw.removeEventListener('message', onMessage);
  }, [on, markRead]);

  // Новое, пока ты здесь, — всплывает; прочитанное в другом канале — убрать из системных.
  const items = list.data?.items;
  useEffect(() => {
    if (!items) return;
    void closeShown(items.filter((n) => n.read_at).map((n) => n.id));
    if (seen.current === null) {
      seen.current = new Set(items.map((n) => n.id));
      return;
    }
    const fresh = items.find((n) => !seen.current!.has(n.id) && !n.read_at);
    for (const n of items) seen.current.add(n.id);
    if (fresh && document.visibilityState === 'visible') setToast(fresh);
  }, [items]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  // Клик мимо панели или Escape — закрыть.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!on) return null;
  const unread = list.data?.unread ?? 0;
  return (
    <div className="bell" ref={box}>
      <button
        type="button"
        className={open ? 'bell-btn on' : 'bell-btn'}
        aria-label={unread ? `Уведомления: ${unread} новых` : 'Уведомления'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Zm4 4a2 2 0 0 0 4 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 && <b className="bell-n">{unread > 99 ? '99+' : unread}</b>}
      </button>
      {toast && !open && (
        <button
          type="button"
          className="bell-toast panel"
          role="status"
          onClick={() => {
            markRead(toast.id);
            setToast(null);
          }}
        >
          <b>{toast.title}</b>
          <small>{noticeLine(toast)}</small>
        </button>
      )}
      {open && (
        <div className="bell-panel panel" role="dialog" aria-label="Уведомления">
          <div className="bell-head">
            <b>Уведомления</b>
            {unread > 0 && (
              <button type="button" className="bell-all" onClick={() => readAll.mutate()}>
                Прочитать всё
              </button>
            )}
          </div>
          {list.data && list.data.items.length === 0 && (
            <p className="bell-empty">
              Пока тихо. Напоминания о делах со временем появятся здесь — за 15 минут, а «сходить
              куда-то» — за час.
            </p>
          )}
          <ul>
            {list.data?.items.map((n) => (
              <li key={n.id} className={n.read_at ? 'read' : undefined}>
                <button type="button" onClick={() => !n.read_at && markRead(n.id)}>
                  <span className="bell-dot" aria-hidden="true" />
                  <span className="bell-t">
                    <b>{n.title}</b>
                    <small>{noticeLine(n)}</small>
                  </span>
                  <time dateTime={n.created_at}>{noticeWhen(n.created_at)}</time>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
