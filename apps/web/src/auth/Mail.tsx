/** Письма: подтверждение почты, «забыл пароль» и новый пароль (AUTH-002, AUTH-005). */
import { Button, Field, Note } from '@qubite/ui';
import { Link, useRouter, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Fail, must, param, say } from './client';
import { useHelpers, usePage, useShyPassword } from './page';

type Search = Record<string, unknown>;

/** Код из письма: только цифры, не больше шести. */
const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

/** Кнопка «прислать ещё раз»: не чаще раза в минуту (так же считает сервер). */
function useResend(send: () => Promise<string>) {
  const [wait, setWait] = useState(0);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  return {
    wait,
    note,
    resend: async () => {
      try {
        setNote({ ok: true, text: await send() });
        setWait(60);
      } catch (e) {
        setNote({ ok: false, text: say(e) });
      }
    },
  };
}

export function VerifyEmailPage() {
  const search = useSearch({ strict: false }) as Search;
  const router = useRouter();
  const helpers = useHelpers();
  const linkToken = param(search.token);
  const [email, setEmail] = useState(param(search.email));
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fromLink = useRef(false);

  usePage({
    dots: 'ПОЧТА',
    title: 'Подтверждение почты',
    lead: linkToken
      ? 'Проверяем ссылку из письма…'
      : 'Мы отправили письмо с кодом из 6 цифр. Код действует сутки.',
  });

  const verify = async (body: { token: string } | { email: string; code: string }) => {
    setBusy(true);
    setFail(null);
    try {
      await must(api.POST('/api/auth/email/verify', { body }));
      setDone(true);
      helpers.cheer();
    } catch (e) {
      setFail(say(e));
      helpers.sad();
    } finally {
      setBusy(false);
    }
  };

  // ссылка из письма подтверждает сама, один раз
  useEffect(() => {
    if (!linkToken || fromLink.current) return;
    fromLink.current = true;
    void verify({ token: linkToken });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkToken]);

  const again = useResend(async () => {
    const r = await must(
      api.POST('/api/auth/email/verify/request', { body: { email: email.trim() } }),
    );
    return r.message;
  });

  if (done)
    return (
      <>
        <Note tone="ok">Почта подтверждена. Теперь можно войти.</Note>
        <Button
          variant="fill"
          className="auth-submit"
          onClick={() =>
            router.history.push(email ? `/auth?${new URLSearchParams({ email })}` : '/auth')
          }
        >
          Войти
        </Button>
      </>
    );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) void verify({ email: email.trim(), code });
  };
  return (
    <>
      {search.sent != null && !fail && (
        <Note tone="ok">Аккаунт почти готов: осталось подтвердить почту.</Note>
      )}
      {linkToken && fail && (
        <Note tone="bad">Ссылка не подошла: {fail} Введите код из письма вручную.</Note>
      )}
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field
          label="Почта"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Код из письма"
          name="code"
          className="auth-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          required
          value={code}
          onChange={(e) => setCode(digits(e.target.value))}
          error={!linkToken ? fail : null}
        />
        <Button
          type="submit"
          variant="fill"
          className="auth-submit"
          disabled={busy || code.length !== 6}
        >
          {busy ? 'Проверяем…' : 'Подтвердить'}
        </Button>
      </form>
      {again.note && <Note tone={again.note.ok ? 'ok' : 'bad'}>{again.note.text}</Note>}
      <p className="auth-links">
        <button
          type="button"
          className="auth-linkbtn"
          disabled={again.wait > 0 || !email.trim()}
          onClick={again.resend}
        >
          {again.wait > 0 ? `Прислать ещё раз через ${again.wait} с` : 'Прислать письмо ещё раз'}
        </button>
        <Link to="/auth">Ко входу</Link>
      </p>
    </>
  );
}

export function ForgotPage() {
  const search = useSearch({ strict: false }) as Search;
  const router = useRouter();
  const helpers = useHelpers();
  const [email, setEmail] = useState(param(search.email));
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);

  usePage({
    dots: 'ПАРОЛЬ',
    title: 'Восстановление пароля',
    lead: 'Пришлём на почту код, по которому можно задать новый пароль.',
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFail(null);
    try {
      await must(api.POST('/api/auth/password/forgot', { body: { email: email.trim() } }));
      router.history.push(
        `/reset-password?${new URLSearchParams({ email: email.trim(), sent: '1' })}`,
      );
    } catch (err) {
      setFail(say(err));
      helpers.sad();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field
          label="Почта аккаунта"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fail}
        />
        <Button
          type="submit"
          variant="fill"
          className="auth-submit"
          disabled={busy || !email.trim()}
        >
          {busy ? 'Отправляем…' : 'Прислать код'}
        </Button>
      </form>
      <p className="auth-links">
        <Link to="/auth">Вспомнил — ко входу</Link>
      </p>
    </>
  );
}

export function ResetPasswordPage() {
  const search = useSearch({ strict: false }) as Search;
  const router = useRouter();
  const helpers = useHelpers();
  const shy = useShyPassword();
  const linkToken = param(search.token);
  const [email, setEmail] = useState(param(search.email));
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<Fail | null>(null);
  const [done, setDone] = useState(false);

  usePage({
    dots: 'ПАРОЛЬ',
    title: 'Новый пароль',
    lead: linkToken
      ? 'Придумайте новый пароль.'
      : 'Введите код из письма и новый пароль. Код действует 30 минут.',
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || password.length < 10) return;
    setBusy(true);
    setFail(null);
    try {
      await must(
        api.POST('/api/auth/password/reset', {
          body: linkToken
            ? { token: linkToken, password }
            : { email: email.trim(), code, password },
        }),
      );
      setDone(true);
      helpers.cheer();
    } catch (err) {
      setFail(err instanceof Fail ? err : new Fail('network', say(err), 0));
      helpers.sad();
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <>
        <Note tone="ok">
          Пароль обновлён. Для безопасности мы закрыли все входы — на всех устройствах нужно войти
          заново.
        </Note>
        <Button
          variant="fill"
          className="auth-submit"
          onClick={() =>
            router.history.push(email ? `/auth?${new URLSearchParams({ email })}` : '/auth')
          }
        >
          Войти
        </Button>
      </>
    );

  return (
    <>
      {search.sent != null && (
        <Note tone="ok">
          Если такой аккаунт есть, письмо уже летит. Не пришло за пару минут — проверьте «Спам».
        </Note>
      )}
      <form className="auth-form" onSubmit={submit} noValidate>
        {!linkToken && (
          <>
            <Field
              label="Почта"
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field
              label="Код из письма"
              name="code"
              className="auth-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              required
              value={code}
              onChange={(e) => setCode(digits(e.target.value))}
              error={fail?.code === 'invalid_code' ? fail.message : null}
            />
          </>
        )}
        <Field
          label="Новый пароль"
          type="password"
          name="new-password"
          autoComplete="new-password"
          required
          minLength={10}
          reveal
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="Не короче 10 символов."
          error={
            password.length > 0 && password.length < 10
              ? null
              : fail && fail.code !== 'invalid_code'
                ? fail.message
                : null
          }
          {...shy}
        />
        {linkToken && fail?.code === 'invalid_code' && (
          <Note tone="bad">
            Ссылка устарела или уже использована. <Link to="/forgot">Прислать новую →</Link>
          </Note>
        )}
        <Button
          type="submit"
          variant="fill"
          className="auth-submit"
          disabled={busy || password.length < 10 || (!linkToken && code.length !== 6)}
        >
          {busy ? 'Сохраняем…' : 'Сохранить пароль'}
        </Button>
      </form>
      <p className="auth-links">
        <Link to="/forgot">Прислать код ещё раз</Link>
        <Link to="/auth">Ко входу</Link>
      </p>
    </>
  );
}
