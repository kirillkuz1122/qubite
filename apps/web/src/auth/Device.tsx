import { Button, Note } from '@qubite/ui';
import { useRouter, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { must, param, say, useMe } from './client';
import { useHelpers, usePage } from './page';

const APPS: Record<string, string> = {
  'qubite-desktop': 'Qubite для компьютера',
  'qubite-android': 'Qubite для Android',
};

/**
 * «Разрешить вход» для приложения (AUTH-006): приложение открывает эту страницу
 * в системном браузере, человек в своей сессии нажимает «Разрешить» — сервер
 * возвращает адрес приложения с одноразовым кодом.
 */
export function DevicePage() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const router = useRouter();
  const me = useMe();
  const helpers = useHelpers();
  const [state, setState] = useState<'ask' | 'busy' | 'sent' | 'no'>('ask');
  const [fail, setFail] = useState<string | null>(null);
  const client = param(search.client_id);
  const device = param(search.device_name);
  const appName = APPS[client] ?? 'Приложение Qubite';

  usePage({ dots: 'ПРИЛОЖЕНИЕ', title: 'Вход в приложение' });

  useEffect(() => {
    if (me.data === null) {
      const back = `${window.location.pathname}${window.location.search}`;
      router.history.replace(`/auth?${new URLSearchParams({ return_to: back })}`);
    }
  }, [me.data, router]);

  if (!me.data) return <p className="auth-small">Проверяем, вошли ли вы…</p>;
  if (!APPS[client] || !search.redirect_uri || !search.code_challenge)
    return (
      <Note tone="bad">
        Ссылка для входа в приложение неполная. Откройте вход из приложения ещё раз.
      </Note>
    );

  const allow = async () => {
    setState('busy');
    setFail(null);
    try {
      const r = await must(
        api.POST('/api/auth/device/authorize', {
          body: {
            client_id: client,
            redirect_uri: param(search.redirect_uri),
            state: param(search.state),
            code_challenge: param(search.code_challenge),
            code_challenge_method: param(search.code_challenge_method) || 'S256',
            device_name: device || appName,
          },
        }),
      );
      helpers.cheer();
      setState('sent');
      window.location.assign(r.redirect_to);
    } catch (e) {
      setFail(say(e));
      setState('ask');
      helpers.sad();
    }
  };

  if (state === 'sent')
    return <Note tone="ok">Готово — возвращаемся в приложение. Эту вкладку можно закрыть.</Note>;
  if (state === 'no') return <Note>Вход не разрешён. Эту вкладку можно закрыть.</Note>;
  return (
    <>
      <p className="auth-text">
        <b>{appName}</b>
        {device && device !== appName && <> на устройстве «{device}»</>} просит войти в ваш аккаунт{' '}
        <b>{me.data.email}</b>. Оно увидит то же, что и вы на сайте. Отозвать вход можно в любой
        момент на странице «Аккаунт».
      </p>
      {fail && <Note tone="bad">{fail}</Note>}
      <div className="acc-actions">
        <Button variant="fill" disabled={state === 'busy'} onClick={() => void allow()}>
          {state === 'busy' ? 'Разрешаем…' : 'Разрешить'}
        </Button>
        <Button onClick={() => setState('no')}>Не разрешать</Button>
      </div>
    </>
  );
}
