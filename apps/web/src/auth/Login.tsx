import { Button, Field, Note } from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useRouter, useSearch } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Captcha } from './Captcha';
import { Fail, ME, must, oauthError, param, safePath, say, useMe, usePlatform } from './client';
import { useHelpers, usePage, useShyPassword } from './page';
import { Providers } from './Providers';

/** Вход: почта и пароль, «я не робот» после неудач, вход через провайдеров (AUTH-005). */
export function LoginPage() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const returnTo = safePath(search.return_to);
  const me = useMe();
  const status = usePlatform();
  const qc = useQueryClient();
  const router = useRouter();
  const helpers = useHelpers();
  const shy = useShyPassword();
  const [email, setEmail] = useState(param(search.email));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<Fail | null>(null);
  const [problem, setProblem] = useState<string | null>(() => {
    const code = param(search.error);
    return code ? oauthError(code, param(search.provider)) : null;
  });
  const [captcha, setCaptcha] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [reset, setReset] = useState(0);

  usePage({
    dots: 'ВХОД',
    title: 'Вход',
    lead: 'Войдите, чтобы открыть свои дела, заметки и Входящие.',
  });

  const go = () => router.history.push(returnTo);

  // уже вошёл — сразу дальше
  useEffect(() => {
    if (me.data) router.history.replace(returnTo);
  }, [me.data, returnTo, router]);

  useEffect(() => {
    if (problem) helpers.sad();
  }, [problem, helpers]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFail(null);
    setProblem(null);
    try {
      const r = await must(
        api.POST('/api/auth/login', {
          body: { email: email.trim(), password, captcha_token: token },
        }),
      );
      qc.setQueryData(ME, r.account);
      helpers.cheer();
      setTimeout(go, 450);
    } catch (err) {
      const f = err instanceof Fail ? err : new Fail('network', say(err), 0);
      setFail(f);
      helpers.sad();
      if (f.code === 'captcha_required' || f.code === 'captcha_failed') setCaptcha(true);
      if (token) {
        setToken(null);
        setReset((n) => n + 1);
      }
      if (f.code === 'invalid_credentials') setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const off = status.data && !status.data.login_enabled;
  const passwordOff = status.data && !status.data.login_methods.password;
  const widget = status.data?.login_captcha;

  return (
    <>
      {status.data?.maintenance && (
        <Note>Qubite на техработах. Войти сейчас может только владелец — паролем.</Note>
      )}
      {off && !status.data?.maintenance && (
        <Note tone="bad">Вход сейчас выключен. Уже открытые сессии работают как обычно.</Note>
      )}
      {problem && <Note tone="bad">{problem}</Note>}
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field
          label="Почта"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Пароль"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          reveal
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fail && fail.code !== 'email_not_verified' ? fail.message : null}
          {...shy}
        />
        {fail?.code === 'email_not_verified' && (
          <Note tone="bad">
            Почта ещё не подтверждена.{' '}
            <Link to="/verify-email" search={{ email: email.trim() }}>
              Ввести код из письма →
            </Link>
          </Note>
        )}
        {captcha && widget && <Captcha widget={widget} onToken={setToken} resetKey={reset} />}
        <Button
          type="submit"
          variant="fill"
          className="auth-submit"
          disabled={busy || (captcha && !!widget && !token)}
        >
          {busy ? 'Входим…' : 'Войти'}
        </Button>
        {passwordOff && (
          <p className="auth-small">Вход паролем выключен владельцем — кроме самого владельца.</p>
        )}
      </form>
      <Providers
        returnTo={returnTo}
        onDone={() => {
          helpers.cheer();
          setTimeout(go, 450);
        }}
        onError={setProblem}
      />
      <p className="auth-links">
        <Link to="/forgot" search={email ? { email: email.trim() } : {}}>
          Забыли пароль?
        </Link>
        {status.data?.registration_mode !== 'closed' && <Link to="/register">Создать аккаунт</Link>}
      </p>
    </>
  );
}
