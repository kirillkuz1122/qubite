import type { components } from '@qubite/api-client';

type Rollback = Omit<components['schemas']['Rollback'], 'reason'> & { reason?: string | null };

/** Номер общий для релиза, коммит различает выкладки. */
export function versionLine(version: string, commit?: string | null): string {
  return commit ? `${version} · ${commit}` : version;
}

/** Короткая русская дата в часовом поясе браузера, как в Console. */
export function deployWhen(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${day} в ${time}`;
}

export function updatedLine(iso?: string | null): string | null {
  const at = deployWhen(iso);
  return at ? `обновлено ${at}` : null;
}

export function builtLine(iso?: string | null): string | null {
  const at = deployWhen(iso);
  return at ? `собрано ${at}` : null;
}

export function rollbackLine(rollback?: Rollback | null): string | null {
  if (!rollback) return null;
  return [`Откат с ${rollback.from} на ${rollback.to}`, deployWhen(rollback.at), rollback.reason]
    .filter(Boolean)
    .join(' · ');
}
