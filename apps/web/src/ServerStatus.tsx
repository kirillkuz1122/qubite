import { useQuery } from '@tanstack/react-query';
import type { QubiteClient } from '@qubite/api-client';

/**
 * Показывает, отвечает ли сервер Qubite. Временный экран фундамента:
 * настоящая главная появится в задаче DS-007.
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
    return <p role="status">Проверяем сервер…</p>;
  }
  if (health.isError) {
    return (
      <p role="status" data-state="down">
        Сервер недоступен
      </p>
    );
  }
  return (
    <p role="status" data-state="up">
      Сервер работает · версия {health.data.version}
    </p>
  );
}
