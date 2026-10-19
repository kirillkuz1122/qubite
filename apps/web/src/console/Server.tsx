import { Note } from '@qubite/ui';
import { say } from '../auth/client';
import { useServer, when } from './api';

const uptime = (secs: number) => {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return d ? `${d} дн. ${h} ч` : h ? `${h} ч ${m} мин` : `${m} мин`;
};

/**
 * Сервер (OWNER_CONSOLE §1.7, базово): версия, сколько работает, база, люди, сессии.
 * Нагрузка, бэкапы и перезапуск модулей — позже (D-233).
 */
export function ServerTab() {
  const server = useServer();
  if (server.isPending) return <p className="cs-small">Спрашиваем сервер…</p>;
  if (server.isError) return <Note tone="bad">{say(server.error)}</Note>;
  const s = server.data;
  return (
    <div className="cs-stack">
      <dl className="cs-panel cs-stats">
        <div>
          <dt>Версия</dt>
          <dd>{s.version}</dd>
        </div>
        <div>
          <dt>Работает</dt>
          <dd>{uptime(s.uptime_secs)}</dd>
          <small className="cs-small">с {when(s.started_at)}</small>
        </div>
        <div>
          <dt>База</dt>
          <dd>миграция {s.migration}</dd>
        </div>
        <div>
          <dt>Людей</dt>
          <dd>{s.accounts}</dd>
        </div>
        <div>
          <dt>Живых сессий</dt>
          <dd>{s.sessions}</dd>
        </div>
        <div>
          <dt>Записей в журнале</dt>
          <dd>{s.audit_entries}</dd>
        </div>
      </dl>
      <p className="cs-small">
        Нагрузка, бэкапы и перезапуск модулей появятся здесь позже. Обновляется раз в 30 секунд.
      </p>
    </div>
  );
}
