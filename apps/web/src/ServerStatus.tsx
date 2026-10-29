import { useQuery } from '@tanstack/react-query';
import type { QubiteClient } from '@qubite/api-client';
import { versionLine } from './deploy-view';

/**
 * Показывает, отвечает ли сервер Qubite. Живёт в подвале лендинга.
 */
export function ServerStatus({ client }: { client: QubiteClient }) {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const { data, error } = await client.GET('/api/health');
      if (error || !data) throw new Error('сервер не ответил');
      return data;
    },
    retry: false,
  });

  if (health.isPending) {
    return <span role="status">Проверяем сервер…</span>;
  }
  if (health.isError) {
    return (
      <span role="status" data-state="down">
        Сервер недоступен
      </span>
    );
  }
  return (
    <span role="status" data-state="up">
      Сервер работает · версия {versionLine(health.data.version, health.data.deploy?.commit)}
    </span>
  );
}
