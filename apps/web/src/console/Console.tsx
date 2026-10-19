import { Button, DotGrid, DotText, Field, Note, Segmented, useMedia, WIDE } from '@qubite/ui';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Fail, must, say, useMe } from '../auth/client';
import { DangerCtx, TABS, type Danger, type TabId } from './api';
import { AiTab } from './Ai';
import { LogTab } from './Log';
import { ModulesTab } from './Modules';
import { PeopleTab } from './People';
import { PlatformTab } from './Platform';
import { ServerTab } from './Server';
import './console.css';

/**
 * Owner Console (ACC-003, OWNER_CONSOLE.md): отдельная комната владельца. Для всех остальных
 * её нет — та же страница «Такой страницы нет», что и на любой неизвестный адрес (D-231).
 */
export function ConsolePage() {
  const me = useMe();
  const { tab } = useParams({ strict: false }) as { tab?: string };
  const navigate = useNavigate();
  const wide = useMedia(WIDE);
  const current: TabId = TABS.find((t) => t.id === tab)?.id ?? 'platform';
  const head = TABS.find((t) => t.id === current)!;
  const danger = useConfirm();

  useEffect(() => {
    if (me.data?.is_owner) document.title = `${head.label} · Owner Console · Qubite`;
  }, [head.label, me.data?.is_owner]);

  if (me.isPending) return null;
  if (!me.data?.is_owner)
    return (
      <main className="shell">
        <h1>Такой страницы нет</h1>
        <a href="/">На главную</a>
      </main>
    );
  return (
    <DangerCtx.Provider value={danger.run}>
      <div className="cs">
        <DotGrid />
        <header className="cs-top">
          <Link className="cs-mark" to="/today" aria-label="Qubite — в приложение">
            <DotText text="qubite" pitch={3} assemble={false} repel={0} label="Qubite" />
            <span className="q-dot" />
            <span className="cs-badge">Owner Console</span>
          </Link>
          <Link className="cs-back" to="/today">
            В Qubite →
          </Link>
        </header>
        <main className="cs-main">
          <h1 className="q-sr">{head.label}</h1>
          <div className="cs-title" aria-hidden="true">
            <DotText
              key={head.dots}
              text={head.dots}
              pitch={wide ? 4.4 : 3}
              color="orange"
              repel={24}
              label=""
            />
          </div>
          <nav className="cs-tabs" aria-label="Разделы Console">
            <Segmented<TabId>
              label="Раздел Console"
              variant="chips"
              wrap
              value={current}
              onChange={(id) => void navigate({ to: '/console/$tab', params: { tab: id } })}
              options={TABS.map((t) => ({ value: t.id, label: t.label }))}
            />
          </nav>
          <section className="cs-body" aria-label={head.label}>
            {current === 'platform' && <PlatformTab ownerId={me.data.id} />}
            {current === 'people' && <PeopleTab ownerId={me.data.id} />}
            {current === 'modules' && <ModulesTab />}
            {current === 'ai' && <AiTab />}
            {current === 'log' && <LogTab />}
            {current === 'server' && <ServerTab />}
          </section>
        </main>
        {danger.asking && <ConfirmPassword onDone={danger.done} />}
      </div>
    </DangerCtx.Provider>
  );
}

/**
 * Пароль для опасных действий — не чаще раза в 5 минут (D-063, D-232). Действие сначала
 * пробуется как есть; сервер ответил `confirm_required` — спрашиваем пароль и повторяем.
 */
function useConfirm() {
  const [asking, setAsking] = useState(false);
  const waiter = useRef<((ok: boolean) => void) | null>(null);
  const run: Danger = useCallback(async (action) => {
    try {
      return await action();
    } catch (e) {
      if (!(e instanceof Fail) || e.code !== 'confirm_required') throw e;
      const ok = await new Promise<boolean>((resolve) => {
        waiter.current = resolve;
        setAsking(true);
      });
      if (!ok) throw new Fail('cancelled', 'Отменено', 0);
      return action();
    }
  }, []);
  const done = useCallback((ok: boolean) => {
    setAsking(false);
    waiter.current?.(ok);
    waiter.current = null;
  }, []);
  return { run, asking, done };
}

function ConfirmPassword({ onDone }: { onDone(ok: boolean): void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await must(api.POST('/api/owner/confirm', { body: { password } }));
      onDone(true);
    } catch (err) {
      setError(say(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onDone(false);
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [onDone]);
  return (
    <div className="cs-veil">
      <form
        className="cs-confirm cs-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Подтвердите паролем"
        onSubmit={submit}
        noValidate
      >
        <h2 className="cs-h">Подтвердите паролем</h2>
        <p className="cs-small">
          Это опасное действие. Следующие 5 минут пароль спрашивать не будем.
        </p>
        <Field
          label="Пароль"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error}
        />
        <div className="cs-row">
          <Button type="submit" variant="fill" disabled={busy || !password}>
            {busy ? 'Проверяем…' : 'Подтвердить'}
          </Button>
          <Button onClick={() => onDone(false)}>Отмена</Button>
        </div>
        {error === null && busy && <Note>Проверяем пароль…</Note>}
      </form>
    </div>
  );
}
