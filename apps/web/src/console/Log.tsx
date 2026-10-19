import { Button, Note, Segmented } from '@qubite/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { must, say } from '../auth/client';
import { when, type AuditItem } from './api';

const KINDS = [
  { value: '', label: 'Всё' },
  { value: 'auth', label: 'Вход' },
  { value: 'account', label: 'Люди' },
  { value: 'platform', label: 'Платформа' },
  { value: 'module', label: 'Модули и доступ' },
  { value: 'invitation', label: 'Приглашения' },
  { value: 'ai', label: 'AI' },
];

/** Что случилось — словами; неизвестное показываем как есть. */
const ACTION: Record<string, string> = {
  'auth.login': 'вошёл',
  'auth.logout': 'вышел',
  'auth.logout_everywhere': 'вышел везде',
  'auth.session_revoked': 'закрыл сессию',
  'auth.sessions_revoked_by_owner': 'закрыты все сессии',
  'account.registered': 'зарегистрировался',
  'account.created': 'создан аккаунт',
  'account.blocked': 'заблокирован',
  'account.unblocked': 'разблокирован',
  'platform.setting_changed': 'тумблер изменён',
  'platform.owner_created': 'создан owner',
  'auth.password_changed': 'сменил пароль',
  'auth.password_reset': 'восстановил пароль',
  'auth.email_verified': 'подтвердил почту',
  'auth.oauth_linked': 'привязал вход',
  'auth.oauth_unlinked': 'отвязал вход',
  'auth.device_authorized': 'разрешил вход приложению',
  'module.updated': 'модуль изменён',
  'module.grant_set': 'выдан доступ',
  'module.grant_revoked': 'отозван доступ',
  'invitation.created': 'создано приглашение',
  'invitation.revoked': 'отозвано приглашение',
  'ai.model_enabled_set': 'модель разрешена/запрещена',
  'ai.task_model_set': 'выбрана модель для задачи',
  'ai.limit_set': 'изменён лимит',
};

const PAGE = 50;

/** Журнал (OWNER_CONSOLE §1.6): неизменяемая лента, новые сверху, «Ещё» — старее. */
export function LogTab() {
  const [kind, setKind] = useState('');
  const log = useInfiniteQuery({
    queryKey: ['owner-audit', kind],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      must(
        api.GET('/api/owner/audit', {
          params: { query: { kind: kind || null, before: pageParam, limit: PAGE } },
        }),
      ),
    getNextPageParam: (last: AuditItem[]) =>
      last.length < PAGE ? undefined : last[last.length - 1]!.seq,
    retry: false,
  });
  const entries = log.data?.pages.flat() ?? [];
  return (
    <div className="cs-stack">
      <div className="cs-panel">
        <Segmented<string>
          label="Что показать"
          variant="chips"
          wrap
          value={kind}
          onChange={(v) => setKind(v)}
          options={KINDS}
        />
        {log.isPending && <p className="cs-small">Загружаем журнал…</p>}
        {log.isError && <Note tone="bad">{say(log.error)}</Note>}
        {log.isSuccess && entries.length === 0 && <p className="cs-small">Записей нет.</p>}
        <ol className="cs-log" aria-label="Журнал">
          {entries.map((e) => (
            <li key={e.seq}>
              <time dateTime={e.at}>{when(e.at)}</time>
              <span>
                <b>{e.actor_email ?? 'система'}</b> · {ACTION[e.action] ?? e.action}
                {e.target_id && e.target_kind !== 'session' && (
                  <small className="cs-small">
                    {' '}
                    {e.target_kind} {e.target_id.slice(0, 40)}
                  </small>
                )}
                {e.reason && <small className="cs-small"> · {e.reason}</small>}
                {(e.before || e.after) && <Diff before={e.before} after={e.after} />}
              </span>
            </li>
          ))}
        </ol>
        {log.hasNextPage && (
          <Button size="sm" onClick={() => void log.fetchNextPage()} disabled={log.isFetching}>
            Ещё
          </Button>
        )}
      </div>
    </div>
  );
}

function Diff({ before, after }: { before?: unknown; after?: unknown }) {
  const text = (v: unknown) => (v == null ? '' : JSON.stringify(v));
  return (
    <code className="cs-diffline">
      {before != null && <>{text(before)} → </>}
      {text(after)}
    </code>
  );
}
