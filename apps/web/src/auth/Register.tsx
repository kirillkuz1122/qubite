import { Button, Check, Field, Note } from '@qubite/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouter, useSearch } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Captcha } from './Captcha';
import { Fail, must, param, say, useMe } from './client';
import { LEGAL_VERSION } from './legal';
import { useHelpers, usePage, useShyPassword } from './page';
import { Providers } from './Providers';

/** Регистрация по режиму платформы: закрыта / по приглашениям / открыта (D-056, D-187). */
export function RegisterPage() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const router = useRouter();
  const me = useMe();
  const helpers = useHelpers();
  const shy = useShyPassword();
  const info = useQuery({
    queryKey: ['registration'],
    queryFn: () => must(api.GET('/api/auth/registration')),
    retry: false,
  });
  const [invite, setInvite] = useState(param(search.invite));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [reset, setReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [fail, setFail] = useState<Fail | null>(null);

  usePage({
    dots: 'РЕГИСТРАЦИЯ',
    title: 'Регистрация',
    lead: 'Аккаунт Qubite — одна почта и пароль для сайта, телефона и компьютера.',
  });

  useEffect(() => {
    if (me.data) router.history.replace('/today');
  }, [me.data, router]);

  const mode = info.data?.mode;
  /** версия документов, которые человек видит и принимает (D-230) */
  const legal = info.data?.legal_version ?? LEGAL_VERSION;
  const needCaptcha = mode === 'open' && !invite.trim() && !!info.data?.captcha;
  const short = password.length > 0 && password.length < 10;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (busy || !agree || password.length < 10) {
      helpers.sad();
      return;
    }
    setBusy(true);
    setFail(null);
    try {
      await must(
        api.POST('/api/auth/register', {
          body: {
            email: email.trim(),
            password,
            display_name: name.trim(),
            invite: invite.trim() || null,
            captcha_token: needCaptcha ? token : null,
            consent_version: legal,
          },
        }),
      );
      helpers.cheer();
      router.history.push(
        `/verify-email?${new URLSearchParams({ email: email.trim(), sent: '1' })}`,
      );
    } catch (err) {
      setFail(err instanceof Fail ? err : new Fail('network', say(err), 0));
      helpers.sad();
      if (token) {
        setToken(null);
        setReset((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  if (info.isPending) return <p className="auth-small">Узнаём, открыта ли регистрация…</p>;
  if (info.isError)
    return (
      <>
        <Note tone="bad">{say(info.error)}</Note>
        <p className="auth-links">
          <Link to="/auth">Ко входу</Link>
        </p>
      </>
    );
  if (mode === 'closed')
    return (
      <>
        <Note>Регистрация сейчас закрыта. Если у вас уже есть аккаунт — просто войдите.</Note>
        <p className="auth-links">
          <Link to="/auth">Ко входу</Link>
        </p>
      </>
    );

  const inviteError =
    fail && (fail.code === 'invalid_invite' || fail.code === 'invite_required')
      ? fail.message
      : null;
  return (
    <>
      {mode === 'invite_only' && !invite && (
        <Note>
          Регистрация — по приглашениям. Вставьте код из письма или откройте ссылку из него.
        </Note>
      )}
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field
          label={mode === 'invite_only' ? 'Код приглашения' : 'Код приглашения (если есть)'}
          name="invite"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="7KQ2-M9XD-4TPR"
          required={mode === 'invite_only'}
          value={invite}
          onChange={(e) => setInvite(e.target.value)}
          error={inviteError}
        />
        <Field
          label="Как вас зовут"
          name="name"
          autoComplete="nickname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          hint="Видно только вам и владельцу. Можно не писать."
        />
        <Field
          label="Почта"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          hint="Пришлём код, чтобы проверить, что почта ваша."
          error={fail?.code === 'invalid' && !inviteError ? fail.message : null}
        />
        <Field
          label="Пароль"
          type="password"
          name="new-password"
          autoComplete="new-password"
          required
          minLength={10}
          reveal
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="Не короче 10 символов. Лучше — несколько слов подряд."
          error={short && tried ? 'Пароль короче 10 символов' : null}
          {...shy}
        />
        <Check
          checked={agree}
          onChange={setAgree}
          required
          error={tried && !agree ? 'Без согласия аккаунт не создать' : null}
        >
          Принимаю{' '}
          <Link to="/legal/$doc" params={{ doc: 'terms' }}>
            условия
          </Link>{' '}
          и даю{' '}
          <Link to="/legal/$doc" params={{ doc: 'consent' }}>
            согласие на обработку данных
          </Link>{' '}
          по{' '}
          <Link to="/legal/$doc" params={{ doc: 'privacy' }}>
            политике
          </Link>
        </Check>
        {needCaptcha && info.data?.captcha && (
          <Captcha widget={info.data.captcha} onToken={setToken} resetKey={reset} />
        )}
        {fail && !inviteError && fail.code !== 'invalid' && <Note tone="bad">{fail.message}</Note>}
        <Button
          type="submit"
          variant="fill"
          className="auth-submit"
          disabled={busy || (needCaptcha && !token)}
        >
          {busy ? 'Создаём…' : 'Создать аккаунт'}
        </Button>
      </form>
      <Providers
        returnTo="/today"
        invite={invite.trim() || undefined}
        verb="Продолжить"
        consent={agree ? legal : undefined}
        locked={
          agree
            ? null
            : 'Сначала поставьте галочку согласия — она нужна и для входа через провайдера.'
        }
        onDone={() => router.history.push('/today')}
        onError={(t) => {
          setTried(true);
          setFail(new Fail('oauth', t, 0));
          helpers.sad();
        }}
      />
      <p className="auth-links">
        <span>Уже есть аккаунт?</span>
        <Link to="/auth">Войти</Link>
      </p>
    </>
  );
}
