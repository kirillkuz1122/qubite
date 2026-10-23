import { Button, Field, Note, Segmented, Swap } from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { MY_AI, useMyAi } from '../ai-me';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import type { components } from '@qubite/api-client';
import { api } from '../../api';
import { must, say } from '../../auth/client';
import { CallList, LimitRow, SpendChart, SpendTotals, UsageTable } from '../AiParts';
import { usd } from '../ai-view';
import { SecHead } from '../parts';

type MyAi = components['schemas']['MyAi'];
type Source = 'owner' | 'chatgpt' | 'own_key';
const SOURCES: readonly Source[] = ['owner', 'chatgpt', 'own_key'];

/**
 * «Настройки → AI и бюджет» (AI-003, D-493): свой расход и лимиты и откуда брать AI — деньги
 * owner по личному лимиту, своя подписка ChatGPT или свой ключ OpenRouter.
 */
export function AiSettings() {
  const navigate = useNavigate();
  const [waiting, setWaiting] = useState(false);
  const me = useMyAi(waiting);
  return (
    <>
      <div className="ai-back">
        <Button size="sm" dot={false} onClick={() => void navigate({ to: '/settings' })}>
          ← Настройки
        </Button>
      </div>
      <SecHead text="AI И БЮДЖЕТ" label="AI и бюджет" />
      {me.isPending && <p className="ai-small">Загружаем…</p>}
      {me.isError && <Note tone="bad">{say(me.error)}</Note>}
      {me.data && (
        <div className="ai-page">
          <Connect me={me.data} waiting={waiting} setWaiting={setWaiting} />
          <MyLimits me={me.data} />
          <div className="panel ai-pad" aria-label="Мой расход">
            <h3 className="ai-h3">Мой расход</h3>
            <SpendTotals usage={me.data.usage} />
            <SpendChart days={me.data.usage.by_day} />
            <div className="ai-tables">
              <UsageTable title="Модули" rows={me.data.usage.by_module} />
              <UsageTable title="Модели" rows={me.data.usage.by_model} />
            </div>
          </div>
          <div className="panel ai-pad" aria-label="Мои AI-вызовы">
            <h3 className="ai-h3">Последние вызовы</h3>
            <CallList calls={me.data.calls} who={false} />
          </div>
        </div>
      )}
    </>
  );
}

function MyLimits({ me }: { me: MyAi }) {
  return (
    <div className="panel ai-pad" aria-label="Мои лимиты">
      <h3 className="ai-h3">Мои лимиты</h3>
      {me.is_owner && (
        <p className="ai-small">
          {me.owner_unlimited
            ? 'У тебя включён режим «owner без личного лимита».'
            : 'Режим «owner без личного лимита» выключен.'}{' '}
          <Link to="/console/$tab" params={{ tab: 'ai' }}>
            Открыть настройки лимитов →
          </Link>
        </p>
      )}
      {me.limits.length === 0 ? (
        <p className="ai-small">
          Лимитов нет.{' '}
          {me.is_owner
            ? ''
            : 'Без личного лимита в $ AI платформы тебе не доступен — попроси owner.'}
        </p>
      ) : (
        <ul className="ai-limits" aria-label="Список лимитов">
          {me.limits.map((l) => (
            <LimitRow key={l.id} limit={l} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** «Подключить AI»: три пути (D-493). */
function Connect({
  me,
  waiting,
  setWaiting,
}: {
  me: MyAi;
  waiting: boolean;
  setWaiting(on: boolean): void;
}) {
  const qc = useQueryClient();
  const [view, setView] = useState<Source>(me.source as Source);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (what: () => Promise<MyAi>, done: string) => {
    setBusy(true);
    setNote(null);
    try {
      qc.setQueryData(MY_AI, await what());
      setNote({ ok: true, text: done });
      return true;
    } catch (e) {
      setNote({ ok: false, text: say(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const choose = (s: Source) => {
    setView(s);
    setNote(null);
    // переключить сразу можно только на то, что уже готово
    const ready =
      s === 'owner' ||
      (s === 'chatgpt' && me.chatgpt.connected) ||
      (s === 'own_key' && !!me.own_key_hint);
    if (ready && s !== me.source)
      void run(() => must(api.PUT('/api/ai/me/source', { body: { source: s } })), 'Сохранено');
  };
  const current =
    me.source === 'chatgpt'
      ? `своя подписка ChatGPT${me.chatgpt.email ? ` (${me.chatgpt.email})` : ''}`
      : me.source === 'own_key'
        ? `свой ключ OpenRouter (…${me.own_key_hint ?? ''})`
        : me.is_owner
          ? 'платформа (ты owner)'
          : me.owner_allows
            ? 'деньги owner по твоему лимиту'
            : 'ничего — AI не подключён';
  return (
    <div className="panel ai-pad" aria-label="Подключить AI">
      <h3 className="ai-h3">Подключить AI</h3>
      <p className="ai-small">
        Сейчас AI для текста идёт через: <b>{current}</b>. Голос — всегда через платформу.
      </p>
      <Segmented<Source>
        label="Откуда AI"
        variant="chips"
        wrap
        value={view}
        onChange={(v) => choose(v)}
        options={[
          { value: 'owner', label: me.is_owner ? 'Платформа' : 'Owner' },
          { value: 'chatgpt', label: 'ChatGPT' },
          { value: 'own_key', label: 'Свой ключ' },
        ]}
      />
      <Swap view={view} order={SOURCES}>
        <div className="ai-form">
          {view === 'owner' && <OwnerPath me={me} />}
          {view === 'chatgpt' && (
            <ChatGptPath me={me} run={run} busy={busy} waiting={waiting} setWaiting={setWaiting} />
          )}
          {view === 'own_key' && <KeyPath me={me} run={run} busy={busy} />}
        </div>
      </Swap>
      {note && <Note tone={note.ok ? 'ok' : 'bad'}>{note.text}</Note>}
    </div>
  );
}

function OwnerPath({ me }: { me: MyAi }) {
  const money = me.limits.filter((l) => l.metric === 'usd' && l.account_id);
  if (me.is_owner)
    return (
      <p className="ai-small">
        Ты owner: платит платформа своим ключом OpenRouter. Лимиты, «сделать мне безлимит», ключи и
        расход всех —{' '}
        <Link to="/console/$tab" params={{ tab: 'ai' }}>
          в Console → AI →
        </Link>
      </p>
    );
  return (
    <p className="ai-small">
      {me.owner_allows
        ? `Owner разрешил тебе свой OpenRouter: ${money.map((l) => `${usd(l.value)} ${l.period === 'day' ? 'в день' : l.period === 'month' ? 'в месяц' : l.period === 'hour' ? 'в час' : 'всего'}`).join(', ')}.`
        : 'Owner пока не выдал тебе AI-бюджет. Попроси его — или подключи свою подписку ChatGPT или свой ключ.'}
    </p>
  );
}

function ChatGptPath({
  me,
  run,
  busy,
  waiting,
  setWaiting,
}: {
  me: MyAi;
  run: (what: () => Promise<MyAi>, done: string) => Promise<boolean>;
  busy: boolean;
  waiting: boolean;
  setWaiting(on: boolean): void;
}) {
  const [started, setStarted] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState<string | null>(null);
  const c = me.chatgpt;
  useEffect(() => {
    if (waiting && (c.connected || c.last_error)) setWaiting(false);
  }, [waiting, c.connected, c.last_error, setWaiting]);
  if (!c.available) return <Note>{c.unavailable_reason}</Note>;
  if (c.connected)
    return (
      <>
        <p className="ai-small">
          Подписка подключена{c.email ? `: ${c.email}` : ''}. Тексты агента и английского идут через
          неё — деньги owner не тратятся (лимиты запросов и защита от зацикливания действуют).
        </p>
        {c.models.length > 0 && (
          <label className="ai-sel">
            Модель подписки
            <select
              value={c.model ?? ''}
              disabled={busy}
              onChange={(e) =>
                void run(
                  () =>
                    must(
                      api.PUT('/api/ai/me/source', {
                        body: { source: 'chatgpt', chatgpt_model: e.target.value || null },
                      }),
                    ),
                  'Модель выбрана',
                )
              }
            >
              <option value="">— первая из подписки —</option>
              {c.models.map((m) => (
                <option key={m} value={m}>
                  {m.replace(/^chatgpt:/, '')}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="ai-row">
          <Button
            disabled={busy}
            onClick={() =>
              void run(() => must(api.DELETE('/api/ai/me/chatgpt')), 'Подписка отключена')
            }
          >
            Отключить ChatGPT
          </Button>
        </div>
      </>
    );
  const start = async () => {
    setError(null);
    try {
      const s = await must(api.POST('/api/ai/me/chatgpt/start'));
      setStarted(s.redirect_uri);
      setWaiting(true);
      window.open(s.url, '_blank', 'noopener');
    } catch (e) {
      setError(say(e));
    }
  };
  const finish = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () => must(api.POST('/api/ai/me/chatgpt/finish', { body: { callback: pasted } })),
      'ChatGPT подключён',
    );
    if (ok) {
      setWaiting(false);
      setPasted('');
    }
  };
  return (
    <>
      <p className="ai-small">
        Своя подписка ChatGPT Plus или Pro: агент и английский работают на её лимитах, деньги owner
        не тратятся. Вход — на сайте OpenAI, пароль Qubite не видит.
      </p>
      {c.last_error && <Note tone="bad">Вход не удался: {c.last_error}</Note>}
      {error && <Note tone="bad">{error}</Note>}
      <div className="ai-row">
        <Button variant="fill" disabled={busy} onClick={() => void start()}>
          Войти через ChatGPT
        </Button>
        {waiting && <small className="ai-small">Ждём, пока ты войдёшь…</small>}
      </div>
      {started && (
        <form className="ai-form" aria-label="Закончить вход" onSubmit={finish} noValidate>
          <p className="ai-small">
            Если после входа страница не открылась («не удаётся подключиться») — это нормально,
            когда Qubite на другом компьютере. Скопируй адрес из строки браузера (начинается с{' '}
            <code>{started.replace(/\/auth\/callback$/, '')}</code>) и вставь сюда.
          </p>
          <Field
            label="Адрес после входа"
            placeholder="http://127.0.0.1:…/auth/callback?code=…"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <div className="ai-row">
            <Button type="submit" disabled={busy || !pasted.includes('code=')}>
              Закончить вход
            </Button>
          </div>
        </form>
      )}
    </>
  );
}

function KeyPath({
  me,
  run,
  busy,
}: {
  me: MyAi;
  run: (what: () => Promise<MyAi>, done: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [key, setKey] = useState('');
  if (!me.keys_available)
    return (
      <Note>
        На сервере не задан ключ шифрования (QUBITE_AI_SECRET_KEY) — свой ключ хранить негде.
        Попроси owner.
      </Note>
    );
  return (
    <>
      <p className="ai-small">
        Свой ключ OpenRouter: запросы оплачивает твой счёт OpenRouter, лимиты в $ owner не
        действуют. Ключ хранится зашифрованным, на экране — только последние 4 символа.
        {me.own_key_hint ? ` Сейчас: …${me.own_key_hint}.` : ''}
      </p>
      <form
        className="ai-form"
        aria-label="Свой ключ"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () => must(api.PUT('/api/ai/me/key', { body: { key } })),
            'Ключ сохранён — AI идёт через него',
          ).then((ok) => ok && setKey(''));
        }}
      >
        <Field
          label="Ключ OpenRouter"
          type="password"
          reveal
          autoComplete="off"
          placeholder="sk-or-v1-…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          hint="Создать: openrouter.ai → Keys. Другие API — позже."
        />
        <div className="ai-row">
          <Button type="submit" variant="fill" disabled={busy || key.trim().length < 16}>
            Сохранить ключ
          </Button>
          {me.own_key_hint && (
            <Button
              disabled={busy}
              onClick={() => void run(() => must(api.DELETE('/api/ai/me/key')), 'Ключ убран')}
            >
              Убрать ключ
            </Button>
          )}
        </div>
      </form>
    </>
  );
}
