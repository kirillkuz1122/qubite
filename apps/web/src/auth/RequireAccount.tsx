import { csrfFromCookie } from '@qubite/api-client';
import { useRouter } from '@tanstack/react-router';
import { useEffect, type ReactNode } from 'react';
import { useMe } from './client';

/**
 * Разделы приложения — только после входа (ответ владельца на Q-40, D-229): гостя сразу
 * отправляем на вход с возвратом туда, куда он шёл. Решает только явный ответ сервера
 * «не вошли» (401). Нет сети или сервер не ответил — разделы открываются: Qubite работает
 * и без сети (offline-first), а данные и так только на этом устройстве. Если в браузере есть
 * cookie входа, разделы открываются сразу, не дожидаясь ответа (сессия скорее всего жива).
 */
export function RequireAccount({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const guest = me.data === null;
  useEffect(() => {
    if (!guest) return;
    // адрес — в момент решения: пока роутер уходит на вход, подписка на адрес зациклила бы
    const href = router.state.location.href;
    if (!href.startsWith('/auth'))
      router.history.replace(`/auth?${new URLSearchParams({ return_to: href })}`);
  }, [guest, router]);
  // пока не знаем, вошёл ли человек, — разделы не мигают. Только до первого ответа: после
  // ошибки повторный запрос снова «ждёт», и прятать разделы на это время — зациклиться
  const wait = me.isPending && me.errorUpdateCount === 0 && !csrfFromCookie(document.cookie);
  if (wait || guest) return null;
  return <>{children}</>;
}
