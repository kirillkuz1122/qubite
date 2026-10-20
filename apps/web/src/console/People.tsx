import { Button, Field, Note, Segmented, Switch } from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Fail, must, say } from '../auth/client';
import {
  ACCOUNTS,
  INVITATIONS,
  STATUS_LABEL,
  useAccounts,
  useDanger,
  useGrants,
  useInvitations,
  useModules,
  when,
  type AccountItem,
  type GrantItem,
  type ModuleFlags,
} from './api';

type Level = 'none' | 'read' | 'write' | 'manage';
const LEVELS: { value: Level; label: string }[] = [
  { value: 'none', label: 'Нет' },
  { value: 'read', label: 'Читать' },
  { value: 'write', label: 'Изменять' },
  { value: 'manage', label: 'Управлять' },
];

const levelOf = (f: ModuleFlags | undefined): Level =>
  !f?.read ? 'none' : f.manage ? 'manage' : f.write ? 'write' : 'read';

const flagsOf = (level: Level, ai: boolean): ModuleFlags => ({
  read: level !== 'none',
  write: level === 'write' || level === 'manage',
  manage: level === 'manage',
  ai: level !== 'none' && ai,
});

/** Люди (OWNER_CONSOLE §1.2): список, карточка, создать вручную, приглашения. */
export function PeopleTab({ ownerId }: { ownerId: string }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const accounts = useAccounts(q.trim(), status);
  return (
    <div className="cs-stack">
      <div className="cs-panel">
        <div className="cs-filters">
          <Field
            label="Поиск"
            placeholder="почта или имя"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Segmented<string>
            label="Кого показать"
            variant="chips"
            wrap
            value={status}
            onChange={(v) => setStatus(v)}
            options={[
              { value: '', label: 'Все' },
              { value: 'active', label: 'Активны' },
              { value: 'pending_email', label: 'Ждут почту' },
              { value: 'blocked', label: 'Заблокированы' },
            ]}
          />
        </div>
        {accounts.isPending && <p className="cs-small">Загружаем…</p>}
        {accounts.isError && <Note tone="bad">{say(accounts.error)}</Note>}
        {accounts.data?.length === 0 && <p className="cs-small">Никого не нашлось.</p>}
        <ul className="cs-people" aria-label="Люди">
          {accounts.data?.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="cs-person"
                aria-expanded={openId === a.id}
                onClick={() => setOpenId(openId === a.id ? null : a.id)}
              >
                <span className="cs-who">
                  <b>{a.display_name || a.email}</b>
                  <small>{a.display_name ? a.email : ''}</small>
                </span>
                <span className={`cs-pill cs-${a.status}`}>
                  {a.is_owner ? 'owner' : (STATUS_LABEL[a.status] ?? a.status)}
                </span>
                <small className="cs-meta">
                  модулей {a.modules} · был {when(a.last_seen_at)}
                </small>
              </button>
              {openId === a.id && <PersonCard person={a} self={a.id === ownerId} />}
            </li>
          ))}
        </ul>
      </div>
      <NewPerson />
      <Invitations />
    </div>
  );
}

function PersonCard({ person, self }: { person: AccountItem; self: boolean }) {
  const qc = useQueryClient();
  const danger = useDanger();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (what: () => Promise<string>) => {
    setBusy(true);
    setNote(null);
    try {
      setNote({ ok: true, text: await danger(what) });
      await qc.invalidateQueries({ queryKey: ACCOUNTS });
    } catch (e) {
      if (!(e instanceof Fail && e.code === 'cancelled')) setNote({ ok: false, text: say(e) });
    } finally {
      setBusy(false);
    }
  };
  const block = person.status !== 'blocked';
  return (
    <div className="cs-card" aria-label={`Карточка: ${person.email}`} role="group">
      <dl className="cs-facts">
        <dt>Почта</dt>
        <dd>{person.email}</dd>
        <dt>Вход</dt>
        <dd>
          {[person.has_password ? 'пароль' : null, ...person.providers]
            .filter(Boolean)
            .join(', ') || '—'}
        </dd>
        <dt>Сессий</dt>
        <dd>{person.sessions}</dd>
        <dt>С нами с</dt>
        <dd>{when(person.created_at)}</dd>
      </dl>
      <Grants accountId={person.id} owner={person.is_owner} />
      {!self && (
        <div className="cs-row">
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await must(
                  api.PATCH('/api/owner/accounts/{id}', {
                    params: { path: { id: person.id } },
                    body: { status: block ? 'blocked' : 'active' },
                  }),
                );
                return block
                  ? 'Заблокирован: все его сессии закрыты, войти он не сможет.'
                  : 'Разблокирован.';
              })
            }
          >
            {block ? 'Заблокировать' : 'Разблокировать'}
          </Button>
          <Button
            size="sm"
            disabled={busy || person.sessions === 0}
            onClick={() =>
              void act(async () => {
                const r = await must(
                  api.POST('/api/owner/accounts/{id}/sessions/revoke', {
                    params: { path: { id: person.id } },
                  }),
                );
                return `Закрыто сессий: ${r.revoked}. Ему придётся войти заново.`;
              })
            }
          >
            Закрыть все сессии
          </Button>
        </div>
      )}
      {self && <p className="cs-small">Это вы. Себя заблокировать нельзя.</p>}
      {note && <Note tone={note.ok ? 'ok' : 'bad'}>{note.text}</Note>}
    </div>
  );
}

/** Модули человека: выдаются каждому вручную и действуют сразу (D-062). */
function Grants({ accountId, owner }: { accountId: string; owner: boolean }) {
  const qc = useQueryClient();
  const modules = useModules();
  const grants = useGrants(accountId);
  const danger = useDanger();
  const [error, setError] = useState<string | null>(null);
  if (owner) return <p className="cs-small">Owner видит все модули.</p>;
  if (modules.isPending || grants.isPending) return <p className="cs-small">Загружаем модули…</p>;
  if (modules.isError || grants.isError)
    return <Note tone="bad">{say(modules.error ?? grants.error)}</Note>;
  const byModule = new Map<string, GrantItem>(grants.data.map((g) => [g.module_id, g]));
  const set = async (moduleId: string, flags: ModuleFlags) => {
    setError(null);
    try {
      const path = { account_id: accountId, module_id: moduleId };
      await danger(() =>
        flags.read
          ? must(
              api.PUT('/api/owner/accounts/{account_id}/grants/{module_id}', {
                params: { path },
                body: flags,
              }),
            )
          : must(
              api.DELETE('/api/owner/accounts/{account_id}/grants/{module_id}', {
                params: { path },
              }),
            ),
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['owner-grants', accountId] }),
        qc.invalidateQueries({ queryKey: ACCOUNTS }),
      ]);
    } catch (e) {
      setError(say(e));
    }
  };
  return (
    <div className="cs-grants" role="group" aria-label="Доступ к модулям">
      <h3 className="cs-h3">Доступ к модулям</h3>
      {modules.data.map((m) => {
        const g = byModule.get(m.id);
        const level = levelOf(g?.flags);
        return (
          <div key={m.id} className="cs-grant">
            <span className="cs-lbl">
              {m.title}
              {!m.installed && <small className="cs-small">не установлен</small>}
            </span>
            <Segmented<Level>
              label={`Доступ к ${m.title}`}
              variant="chips"
              value={level}
              onChange={(v) => void set(m.id, flagsOf(v, !!g?.flags.ai))}
              options={LEVELS}
              wrap
            />
            {level !== 'none' && (
              <label className="cs-ai">
                <span>AI</span>
                <Switch
                  label={`AI в ${m.title}`}
                  checked={!!g?.flags.ai}
                  onChange={(v) => void set(m.id, flagsOf(level, v))}
                />
              </label>
            )}
          </div>
        );
      })}
      {error && <Note tone="bad">{error}</Note>}
    </div>
  );
}

function NewPerson() {
  const qc = useQueryClient();
  const danger = useDanger();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const made = await danger(() =>
        must(
          api.POST('/api/owner/accounts', {
            body: { email: email.trim(), display_name: name.trim(), password },
          }),
        ),
      );
      setNote({
        ok: true,
        text: `Создан ${made.email}. Он может войти сразу; модули выдайте в его карточке.`,
      });
      setEmail('');
      setName('');
      setPassword('');
      await qc.invalidateQueries({ queryKey: ACCOUNTS });
    } catch (err) {
      if (!(err instanceof Fail && err.code === 'cancelled'))
        setNote({ ok: false, text: say(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="cs-panel" onSubmit={submit} noValidate aria-label="Создать человека">
      <h2 className="cs-h">Создать вручную</h2>
      <div className="cs-grid">
        <Field
          label="Почта"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field label="Имя" value={name} onChange={(e) => setName(e.target.value)} />
        <Field
          label="Пароль"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="Не короче 10 символов. Передайте его человеку сами."
        />
      </div>
      {note && <Note tone={note.ok ? 'ok' : 'bad'}>{note.text}</Note>}
      <Button type="submit" variant="fill" disabled={busy || !email.trim() || !password}>
        {busy ? 'Создаём…' : 'Создать'}
      </Button>
    </form>
  );
}

function Invitations() {
  const qc = useQueryClient();
  const list = useInvitations();
  const [email, setEmail] = useState('');
  const [days, setDays] = useState('7');
  const [fresh, setFresh] = useState<{ code: string; link: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await must(
        api.POST('/api/owner/invitations', {
          body: { email: email.trim() || null, days: Number(days) || 7 },
        }),
      );
      setFresh({ code: r.code, link: r.link });
      setEmail('');
      await qc.invalidateQueries({ queryKey: INVITATIONS });
    } catch (err) {
      setError(say(err));
    }
  };
  const revoke = async (id: string) => {
    setError(null);
    try {
      await must(api.DELETE('/api/owner/invitations/{id}', { params: { path: { id } } }));
      await qc.invalidateQueries({ queryKey: INVITATIONS });
    } catch (err) {
      setError(say(err));
    }
  };
  return (
    <div className="cs-panel">
      <h2 className="cs-h">Приглашения</h2>
      <form className="cs-grid" onSubmit={create} noValidate aria-label="Новое приглашение">
        <Field
          label="Почта (необязательно)"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          hint="Пусто — общая одноразовая ссылка."
        />
        <Field
          label="Срок, дней"
          inputMode="numeric"
          value={days}
          onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 2))}
        />
        <Button type="submit">Пригласить</Button>
      </form>
      {fresh && (
        <Note tone="ok">
          Код <b>{fresh.code}</b> — показываем один раз. Ссылка: <span>{fresh.link}</span>
        </Note>
      )}
      {error && <Note tone="bad">{error}</Note>}
      <ul className="cs-invites" aria-label="Список приглашений">
        {list.data?.map((i) => (
          <li key={i.id}>
            <span>
              {i.email ?? 'общая ссылка'} · <small>{inviteStatus(i.status)}</small> · до{' '}
              {when(i.expires_at)}
              {i.used_by_email && <> · {i.used_by_email}</>}
            </span>
            {i.status === 'active' && (
              <Button size="sm" onClick={() => void revoke(i.id)}>
                Отозвать
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function inviteStatus(s: string): string {
  return (
    { active: 'действует', used: 'использовано', revoked: 'отозвано', expired: 'истекло' }[s] ?? s
  );
}
