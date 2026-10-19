import { Button, Field, Note } from '@qubite/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearch } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { deviceName, ME, must, param, PROVIDER_NAME, say, useMe, useProviders } from './client';
import { useHelpers, usePage, useShyPassword } from './page';

const WHEN = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});
const when = (iso: string) => WHEN.format(new Date(iso));

/** Действие, которое просит пароль: привязка и отвязка входа, ссылка на бота. */
type Ask = { kind: 'link' | 'unlink'; provider: string } | { kind: 'telegram-bot' };

/** Аккаунт: кто вошёл, сессии и устройства, привязанные входы, бот, выход. */
export function AccountPage() {
  const me = useMe();
  const router = useRouter();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const qc = useQueryClient();
  const helpers = useHelpers();
  const linked = param(search.linked);

  usePage({ dots: 'АККАУНТ', title: 'Аккаунт', wide: true });

  useEffect(() => {
    if (me.data === null) router.history.replace('/auth?return_to=%2Faccount');
  }, [me.data, router]);

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => must(api.GET('/api/auth/sessions')),
    enabled: !!me.data,
  });
  const identities = useQuery({
    queryKey: ['identities'],
    queryFn: () => must(api.GET('/api/auth/oauth/identities')),
    enabled: !!me.data,
  });
  const providers = useProviders();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(
    linked
      ? { ok: true, text: `${PROVIDER_NAME[linked] ?? linked} привязан — теперь им можно входить.` }
      : null,
  );

  if (me.isPending) return <p className="auth-small">Загружаем…</p>;
  if (me.isError) return <Note tone="bad">{say(me.error)}</Note>;
  if (!me.data) return null;
  const account = me.data;

  const done = (text: string) => {
    setNote({ ok: true, text });
    helpers.cheer();
  };
  const failed = (e: unknown) => {
    setNote({ ok: false, text: say(e) });
    helpers.sad();
  };

  const revoke = async (id: string) => {
    try {
      await must(api.DELETE('/api/auth/sessions/{id}', { params: { path: { id } } }));
      await qc.invalidateQueries({ queryKey: ['sessions'] });
      done('Сессия закрыта — на том устройстве нужно будет войти заново.');
    } catch (e) {
      failed(e);
    }
  };
  const everywhere = async () => {
    try {
      const r = await must(api.POST('/api/auth/logout-everywhere'));
      qc.setQueryData(ME, null);
      setNote({ ok: true, text: `Закрыто входов: ${r.revoked}.` });
      router.history.push('/auth');
    } catch (e) {
      failed(e);
    }
  };
  const logout = async () => {
    try {
      await must(api.POST('/api/auth/logout'));
    } catch {
      /* сессии уже нет — всё равно выходим */
    }
    qc.setQueryData(ME, null);
    router.history.push('/');
  };

  const linkedIds = new Set(identities.data?.map((i) => i.provider));
  const linkable = (providers.data ?? []).filter((p) => !linkedIds.has(p.id));

  return (
    <div className="acc">
      {note && <Note tone={note.ok ? 'ok' : 'bad'}>{note.text}</Note>}
      <section className="acc-sec" aria-labelledby="acc-me">
        <h2 id="acc-me">Это вы</h2>
        <div className="acc-row">
          <span className="acc-main">
            <b>{account.display_name || account.email}</b>
            <small>
              {account.email}
              {account.is_owner && ' · владелец'}
            </small>
          </span>
        </div>
      </section>

      <section className="acc-sec" aria-labelledby="acc-sessions">
        <h2 id="acc-sessions">Где вы вошли</h2>
        {sessions.isError && <Note tone="bad">{say(sessions.error)}</Note>}
        {sessions.data?.map((s) => (
          <div className="acc-row" key={s.id}>
            <span className="acc-main">
              <b>
                {deviceName(s)}
                {s.current && <em className="acc-tag">это устройство</em>}
              </b>
              <small>
                был(а) {when(s.last_seen_at)} · вход {when(s.created_at)}
                {s.ip && ` · ${s.ip}`}
              </small>
            </span>
            {!s.current && (
              <Button
                size="sm"
                onClick={() => void revoke(s.id)}
                aria-label={`Закрыть: ${deviceName(s)}`}
              >
                Закрыть
              </Button>
            )}
          </div>
        ))}
        <div className="acc-actions">
          <Button size="sm" onClick={() => void everywhere()}>
            Выйти везде
          </Button>
          <Button size="sm" onClick={() => void logout()}>
            Выйти здесь
          </Button>
        </div>
      </section>

      <section className="acc-sec" aria-labelledby="acc-logins">
        <h2 id="acc-logins">Вход через другие сервисы</h2>
        <p className="auth-small">
          Привязать можно только из открытого аккаунта и с паролем: совпадение почты у Яндекса или
          VK само по себе в ваш аккаунт не пускает.
        </p>
        {identities.data?.map((i) => (
          <div className="acc-row" key={i.provider}>
            <span className="acc-main">
              <b>{PROVIDER_NAME[i.provider] ?? i.provider}</b>
              <small>
                {i.display_name}
                {i.email && ` · ${i.email}`} · привязан {when(i.linked_at)}
              </small>
            </span>
            <Button size="sm" onClick={() => setAsk({ kind: 'unlink', provider: i.provider })}>
              Отвязать
            </Button>
          </div>
        ))}
        {linkable.map((p) => (
          <div className="acc-row" key={p.id}>
            <span className="acc-main">
              <b>{PROVIDER_NAME[p.id] ?? p.id}</b>
              <small>не привязан</small>
            </span>
            {p.kind === 'redirect' ? (
              <Button size="sm" onClick={() => setAsk({ kind: 'link', provider: p.id })}>
                Привязать
              </Button>
            ) : (
              <small className="acc-later">привязка — через бота ниже</small>
            )}
          </div>
        ))}
        {identities.data && linkable.length === 0 && identities.data.length === 0 && (
          <p className="auth-small">Владелец пока не включил вход через другие сервисы.</p>
        )}
      </section>

      <section className="acc-sec" aria-labelledby="acc-bot">
        <h2 id="acc-bot">Telegram-бот</h2>
        <p className="auth-small">
          Привяжите Telegram — и всё, что напишете боту, попадёт во Входящие.
        </p>
        <div className="acc-actions">
          <Button size="sm" onClick={() => setAsk({ kind: 'telegram-bot' })}>
            Привязать Telegram
          </Button>
        </div>
      </section>

      {ask && (
        <Confirm
          ask={ask}
          onClose={() => setAsk(null)}
          onDone={async (text) => {
            setAsk(null);
            await qc.invalidateQueries({ queryKey: ['identities'] });
            done(text);
          }}
        />
      )}
    </div>
  );
}

/** Подтверждение паролем для привязки, отвязки и ссылки на бота. */
function Confirm({
  ask,
  onClose,
  onDone,
}: {
  ask: Ask;
  onClose(): void;
  onDone(text: string): void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bot, setBot] = useState<string | null>(null);
  const shy = useShyPassword();
  const title =
    ask.kind === 'telegram-bot'
      ? 'Ссылка на бота'
      : `${ask.kind === 'link' ? 'Привязать' : 'Отвязать'} ${PROVIDER_NAME[ask.provider] ?? ask.provider}`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      if (ask.kind === 'link') {
        const r = await must(
          api.POST('/api/auth/oauth/{provider}/link', {
            params: { path: { provider: ask.provider } },
            body: { password },
          }),
        );
        window.location.assign(r.authorize_url);
        return;
      }
      if (ask.kind === 'unlink') {
        await must(
          api.POST('/api/auth/oauth/identities/{provider}/unlink', {
            params: { path: { provider: ask.provider } },
            body: { password },
          }),
        );
        onDone(`${PROVIDER_NAME[ask.provider] ?? ask.provider} отвязан.`);
        return;
      }
      const r = await must(api.POST('/api/v1/telegram/link-code', { body: { password } }));
      setBot(r.url);
    } catch (err) {
      setError(say(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="acc-sec acc-confirm" aria-labelledby="acc-confirm">
      <h2 id="acc-confirm">{title}</h2>
      {bot ? (
        <>
          <Note tone="ok">
            Откройте ссылку в Telegram и нажмите «Начать». Ссылка действует несколько минут.
          </Note>
          <div className="acc-actions">
            <a className="q-btn q-fill" href={bot} target="_blank" rel="noreferrer">
              <span className="q-dot" aria-hidden="true" />
              Открыть бота
            </a>
            <Button size="sm" onClick={onClose}>
              Готово
            </Button>
          </div>
        </>
      ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          <Field
            label="Ваш пароль Qubite"
            type="password"
            autoComplete="current-password"
            autoFocus
            reveal
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error}
            {...shy}
          />
          <div className="acc-actions">
            <Button type="submit" variant="fill" disabled={busy || !password}>
              {busy ? 'Проверяем…' : 'Подтвердить'}
            </Button>
            <Button size="sm" onClick={onClose}>
              Отмена
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
