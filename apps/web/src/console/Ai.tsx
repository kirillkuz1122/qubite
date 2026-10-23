import { Button, Field, Note, Segmented, Sheet, Switch, Swap } from '@qubite/ui';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Fail, must, say } from '../auth/client';
import { CallList, LimitRow, SpendChart, SpendTotals, UsageTable } from '../app/AiParts';
import {
  METRIC_LABEL,
  MICROS,
  parseUsd,
  payer,
  PERIOD_LABEL,
  SCOPE_LABEL,
  unlimitedMissing,
  usd,
} from '../app/ai-view';
import {
  AI_LIMITS,
  AI_MODELS,
  AI_OVERVIEW,
  AI_TASKS,
  useAccounts,
  useAiLimits,
  useAiModels,
  useAiOverview,
  useAiTasks,
  useAiUsage,
  useDanger,
  useModules,
  when,
  type AiCallItem,
  type AiLimitItem,
  type AiOverview,
  type AuditItem,
} from './api';

const TASK_LABEL: Record<string, string> = {
  default: 'По умолчанию',
  'inbox.triage': 'Разбор Входящих',
  'english.tutor': 'Репетитор английского',
  'voice.stt': 'Голос: распознавание',
  'voice.tts': 'Голос: речь',
};

/** Цена: микродоллары за миллион токенов → «$0.15». */
const price = (micro: number) => `$${(micro / 1_000_000).toFixed(micro < 100_000 ? 3 : 2)}`;

type View = 'budget' | 'spend' | 'models' | 'guard' | 'calls';
const VIEWS: { value: View; label: string }[] = [
  { value: 'budget', label: 'Бюджет' },
  { value: 'spend', label: 'Расход' },
  { value: 'models', label: 'Модели и ключи' },
  { value: 'guard', label: 'Защита' },
  { value: 'calls', label: 'Журнал' },
];
const ORDER = VIEWS.map((v) => v.value);

/**
 * AI (OWNER_CONSOLE §1.4, AI-003): бюджет и «сделать мне безлимит», все лимиты, расход
 * (AI Cost Center), модели и ключи провайдеров, защита от зацикливания, журнал вызовов и
 * изменений. Всё, что меняет AI, — с паролем (раз в 10 минут) и в аудит.
 */
export function AiTab() {
  const [view, setView] = useState<View>('budget');
  return (
    <div className="cs-stack">
      <Segmented<View>
        label="Что настроить в AI"
        variant="chips"
        wrap
        value={view}
        onChange={(v) => setView(v)}
        options={VIEWS}
      />
      <Swap view={view} order={ORDER}>
        <div className="cs-stack">
          {view === 'budget' && <Budget />}
          {view === 'spend' && <Spend />}
          {view === 'models' && <ModelsAndKeys />}
          {view === 'guard' && <Guard />}
          {view === 'calls' && <Calls />}
        </div>
      </Swap>
    </div>
  );
}

/** Опасное действие Console: пароль (если нужен), ошибка — словами, после — обновить данные. */
function useAct() {
  const qc = useQueryClient();
  const danger = useDanger();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (what: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setNote(null);
    try {
      await danger(what);
      setNote({ ok: true, text: done });
      return true;
    } catch (e) {
      if (!(e instanceof Fail && e.code === 'cancelled')) setNote({ ok: false, text: say(e) });
      return false;
    } finally {
      setBusy(false);
      await Promise.all(
        [AI_OVERVIEW, AI_LIMITS, AI_MODELS, AI_TASKS].map((k) =>
          qc.invalidateQueries({ queryKey: k }),
        ),
      );
    }
  };
  const shown = note && <Note tone={note.ok ? 'ok' : 'bad'}>{note.text}</Note>;
  return { act, busy, shown };
}

// ---------------------------------------------------------------- бюджет

function Budget() {
  const overview = useAiOverview();
  const limits = useAiLimits();
  if (overview.isPending || limits.isPending) return <p className="cs-small">Загружаем бюджет…</p>;
  if (overview.isError || limits.isError)
    return <Note tone="bad">{say(overview.error ?? limits.error)}</Note>;
  return (
    <>
      <Unlimited o={overview.data} />
      <Limits limits={limits.data} />
    </>
  );
}

/** «Сделать мне безлимит»: что нужно режиму и одна кнопка. */
function Unlimited({ o }: { o: AiOverview }) {
  const { act, busy, shown } = useAct();
  const missing = unlimitedMissing(o);
  const cap = o.platform_day_usd?.value;
  return (
    <div className="cs-panel" aria-label="Безлимит для owner">
      <div className="cs-set">
        <span className="cs-lbl">
          <h2 className="cs-h">Мне без лимита</h2>
          <small className="cs-small">
            {o.unlimited_works
              ? `Работает: у тебя нет личного лимита, ограничивает только потолок платформы ${usd(cap ?? 0)} в день и лимит самого ключа OpenRouter.`
              : 'Сейчас не работает — AI для тебя ограничен личным лимитом или выключен.'}
          </small>
        </span>
        <Switch
          label="Owner без личного лимита"
          checked={o.owner_unlimited}
          onChange={(v) =>
            void act(
              () => must(api.PUT('/api/owner/ai/owner-unlimited', { body: { enabled: v } })),
              v ? 'Режим включён' : 'Режим выключен',
            )
          }
        />
      </div>
      <ul className="ai-check" aria-label="Что нужно для режима">
        <li className={o.owner_unlimited ? 'ok' : 'no'}>
          Режим «owner без личного лимита» включён
        </li>
        <li className={o.owner_personal_usd.length === 0 ? 'ok' : 'no'}>
          Нет личного лимита в $ у тебя
          {o.owner_personal_usd.length > 0 &&
            ` — сейчас ${o.owner_personal_usd.map((l) => `${usd(l.value)} ${PERIOD_LABEL[l.period]}`).join(', ')}`}
        </li>
        <li className={cap != null ? 'ok' : 'no'}>
          Есть дневной потолок платформы в $
          {cap != null ? ` — ${usd(cap)} в день` : ' — без него режим не работает'}
        </li>
      </ul>
      {missing.length > 0 && (
        <div className="cs-row">
          <Button
            variant="fill"
            disabled={busy}
            onClick={() =>
              void act(
                () => must(api.POST('/api/owner/ai/unlimited', { body: {} })),
                'Готово: личный лимит снят, режим включён' +
                  (cap == null
                    ? `, потолок платформы ${usd(o.default_platform_day_usd)} в день`
                    : ''),
              )
            }
          >
            Сделать мне безлимит
          </Button>
          <small className="cs-small">
            Снимет твои личные лимиты в $,{' '}
            {cap == null
              ? `поставит потолок платформы ${usd(o.default_platform_day_usd)} в день (его можно поменять ниже) `
              : ''}
            и включит режим. Общие лимиты и лимит ключа OpenRouter остаются.
          </small>
        </div>
      )}
      {shown}
    </div>
  );
}

const SCOPES = Object.keys(SCOPE_LABEL);
const PERIODS = ['hour', 'day', 'month', 'all'] as const;
const METRICS = ['usd', 'requests', 'tokens'] as const;

function Limits({ limits }: { limits: AiLimitItem[] }) {
  const { act, busy, shown } = useAct();
  const [edit, setEdit] = useState<AiLimitItem | 'new' | null>(null);
  return (
    <div className="cs-panel" aria-label="Лимиты">
      <div className="cs-set">
        <span className="cs-lbl">
          <h2 className="cs-h">Лимиты</h2>
          <small className="cs-small">
            На платформу, каждого человека, человека, модуль, модель и провайдера — в $, запросах
            или токенах; дневные сбрасываются в полночь. AI получает только тот, у кого есть личный
            лимит в $ (или своя подписка и ключ).
          </small>
        </span>
        <Button size="sm" onClick={() => setEdit('new')}>
          + Лимит
        </Button>
      </div>
      {limits.length === 0 ? (
        <p className="cs-small">
          Лимитов нет — AI не доступен никому (бюджет по умолчанию — ноль).
        </p>
      ) : (
        <ul className="ai-limits" aria-label="Список лимитов">
          {limits.map((l) => (
            <LimitRow key={l.id} limit={l}>
              <Button size="sm" onClick={() => setEdit(l)}>
                Изменить
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      must(
                        api.DELETE('/api/owner/ai/limits/{id}', { params: { path: { id: l.id } } }),
                      ),
                    'Лимит снят',
                  )
                }
              >
                Снять
              </Button>
            </LimitRow>
          ))}
        </ul>
      )}
      {shown}
      <Sheet
        open={edit !== null}
        onClose={() => setEdit(null)}
        title={edit === 'new' ? 'Новый лимит' : 'Изменить лимит'}
      >
        {edit !== null && (
          <LimitForm
            start={edit === 'new' ? null : edit}
            onDone={() => setEdit(null)}
            act={act}
            busy={busy}
          />
        )}
      </Sheet>
    </div>
  );
}

function LimitForm({
  start,
  onDone,
  act,
  busy,
}: {
  start: AiLimitItem | null;
  onDone(): void;
  act: (what: () => Promise<unknown>, done: string) => Promise<boolean>;
  busy: boolean;
}) {
  const people = useAccounts('', '');
  const modules = useModules();
  const models = useAiModels();
  const [scope, setScope] = useState(start?.scope ?? 'platform');
  const [account, setAccount] = useState(start?.account_id ?? '');
  const [module, setModule] = useState(start?.module_id ?? '');
  const [model, setModel] = useState(start?.model_id ?? '');
  const [provider, setProvider] = useState(start?.provider_id ?? '');
  const [period, setPeriod] = useState(start?.period ?? 'day');
  const [metric, setMetric] = useState(start?.metric ?? 'usd');
  const [value, setValue] = useState(
    start ? (start.metric === 'usd' ? String(start.value / MICROS) : String(start.value)) : '',
  );
  const [error, setError] = useState<string | null>(null);
  const needs = {
    account: scope === 'user' || scope === 'user_module',
    module: scope === 'module' || scope === 'user_module',
    model: scope === 'model',
    provider: scope === 'provider',
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed =
      metric === 'usd' ? parseUsd(value) : /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
    if (parsed === null) {
      setError(
        metric === 'usd' ? 'Сумма в долларах, например 2 или 0.5' : 'Целое число, 0 — запрещено',
      );
      return;
    }
    setError(null);
    const ok = await act(
      () =>
        must(
          api.POST('/api/owner/ai/limits', {
            body: {
              scope,
              period,
              metric,
              value: parsed,
              account_id: needs.account ? account || null : null,
              module_id: needs.module ? module || null : null,
              model_id: needs.model ? model || null : null,
              provider_id: needs.provider ? provider || null : null,
            },
          }),
        ),
      'Лимит сохранён',
    );
    if (ok) onDone();
  };
  const fixed = start !== null;
  return (
    <form className="ai-form" aria-label="Лимит" onSubmit={submit} noValidate>
      {fixed ? (
        <p className="cs-small">
          {SCOPE_LABEL[start.scope]} · {PERIOD_LABEL[start.period]} · {METRIC_LABEL[start.metric]} —
          новое значение заменит старое, расход начнётся с нуля.
        </p>
      ) : (
        <>
          <label className="ai-sel">
            На что
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {SCOPE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          {needs.account && (
            <label className="ai-sel">
              Человек
              <select value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="">— выбрать —</option>
                {people.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.email}
                    {p.is_owner ? ' (owner)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {needs.module && (
            <label className="ai-sel">
              Модуль
              <select value={module} onChange={(e) => setModule(e.target.value)}>
                <option value="">— выбрать —</option>
                {modules.data?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {needs.model && (
            <label className="ai-sel">
              Модель
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">— выбрать —</option>
                {models.data?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          {needs.provider && (
            <Field
              label="Провайдер"
              placeholder="openrouter, chatgpt, elevenlabs"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            />
          )}
          <Segmented<string>
            label="Период"
            variant="chips"
            wrap
            value={period}
            onChange={(v) => setPeriod(v)}
            options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p]! }))}
          />
          <Segmented<string>
            label="В чём"
            variant="chips"
            wrap
            value={metric}
            onChange={(v) => setMetric(v)}
            options={METRICS.map((m) => ({ value: m, label: METRIC_LABEL[m]! }))}
          />
        </>
      )}
      <Field
        label={metric === 'usd' ? 'Сколько, $' : `Сколько, ${METRIC_LABEL[metric]}`}
        inputMode="decimal"
        autoFocus={fixed}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={error}
        hint="0 — запрещено"
      />
      <div className="cs-row">
        <Button type="submit" variant="fill" disabled={busy || !value.trim()}>
          Сохранить
        </Button>
        <Button onClick={onDone}>Отмена</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- расход

function Spend() {
  const [days, setDays] = useState('30');
  const usage = useAiUsage(Number(days));
  const overview = useAiOverview();
  return (
    <div className="cs-panel" aria-label="Расход">
      <div className="cs-set">
        <h2 className="cs-h">AI Cost Center</h2>
        <Segmented<string>
          label="За сколько дней"
          variant="chips"
          value={days}
          onChange={(v) => setDays(v)}
          options={[
            { value: '7', label: '7 дн.' },
            { value: '30', label: '30 дн.' },
            { value: '90', label: '90 дн.' },
          ]}
        />
      </div>
      {usage.isPending && <p className="cs-small">Считаем расход…</p>}
      {usage.isError && <Note tone="bad">{say(usage.error)}</Note>}
      {usage.data && (
        <>
          <SpendTotals
            usage={usage.data}
            extra={overview.data ? [['Сегодня', usd(overview.data.today_usd)]] : []}
          />
          <SpendChart days={usage.data.by_day} />
          <div className="ai-tables">
            <UsageTable title="Модули" rows={usage.data.by_module} />
            <UsageTable title="Модели" rows={usage.data.by_model} />
            <UsageTable title="Люди" rows={usage.data.by_person} />
            <UsageTable title="Кто платил" rows={usage.data.by_payer} label={payer} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- модели и ключи

function ModelsAndKeys() {
  const overview = useAiOverview();
  return (
    <>
      {overview.data && <Keys o={overview.data} />}
      {overview.isError && <Note tone="bad">{say(overview.error)}</Note>}
      <TaskModels />
      <Catalog />
    </>
  );
}

function Keys({ o }: { o: AiOverview }) {
  const { act, busy, shown } = useAct();
  const [key, setKey] = useState('');
  const k = o.keys.find((x) => x.provider === 'openrouter');
  const source =
    k?.source === 'console'
      ? `сохранён здесь (…${k.hint})`
      : k?.source === 'server'
        ? 'из настроек сервера (.env)'
        : 'нет — платный AI платформы выключен';
  return (
    <div className="cs-panel" aria-label="Ключи провайдеров">
      <h2 className="cs-h">Ключи провайдеров</h2>
      <dl className="cs-facts">
        <dt>OpenRouter</dt>
        <dd>{source}</dd>
        <dt>ChatGPT</dt>
        <dd>
          {o.chatgpt_enabled
            ? `включён · подключили подписку: ${o.chatgpt_people}`
            : 'выключен (QUBITE_AI_CHATGPT_ENABLED)'}
        </dd>
        <dt>Голос</dt>
        <dd>
          {o.voice ? 'ElevenLabs — ключ в настройках сервера' : 'выключен (нет ключа ElevenLabs)'}
        </dd>
        <dt>Шифрование</dt>
        <dd>
          {o.secret_key_set ? 'есть (QUBITE_AI_SECRET_KEY)' : 'нет — ключи здесь не сохранить'}
        </dd>
      </dl>
      <form
        className="ai-form"
        aria-label="Ключ OpenRouter"
        onSubmit={(e) => {
          e.preventDefault();
          void act(
            () => must(api.PUT('/api/owner/ai/keys/openrouter', { body: { key } })),
            'Ключ сохранён — действует сразу',
          ).then((ok) => ok && setKey(''));
        }}
      >
        <Field
          label="Новый ключ OpenRouter"
          type="password"
          reveal
          autoComplete="off"
          placeholder="sk-or-v1-…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          hint="Хранится зашифрованным; на экране и в журнале — только последние 4 символа."
        />
        <div className="cs-row">
          <Button type="submit" variant="fill" disabled={busy || key.trim().length < 16}>
            Сохранить ключ
          </Button>
          {k?.source === 'console' && (
            <Button
              disabled={busy}
              onClick={() =>
                void act(() => must(api.DELETE('/api/owner/ai/keys/openrouter')), 'Ключ убран')
              }
            >
              Убрать ключ
            </Button>
          )}
        </div>
      </form>
      {shown}
    </div>
  );
}

function TaskModels() {
  const models = useAiModels();
  const tasks = useAiTasks();
  const { act, busy, shown } = useAct();
  if (models.isPending || tasks.isPending) return <p className="cs-small">Загружаем модели…</p>;
  if (models.isError || tasks.isError)
    return <Note tone="bad">{say(models.error ?? tasks.error)}</Note>;
  const enabled = models.data.filter((m) => m.enabled);
  const taskIds = [...new Set(['default', 'inbox.triage', ...tasks.data.map((t) => t.task)])];
  return (
    <>
      <div className="cs-panel" aria-label="Модели для задач">
        <h2 className="cs-h">Модели для задач</h2>
        {taskIds.map((task) => (
          <label key={task} className="cs-set">
            <span className="cs-lbl">{TASK_LABEL[task] ?? task}</span>
            <select
              className="cs-select"
              disabled={busy}
              value={tasks.data.find((t) => t.task === task)?.model_id ?? ''}
              onChange={(e) =>
                void act(
                  () =>
                    must(
                      api.PUT('/api/owner/ai/tasks/{task}', {
                        params: { path: { task } },
                        body: { model_id: e.target.value || null },
                      }),
                    ),
                  'Модель выбрана',
                )
              }
            >
              <option value="">— не выбрана —</option>
              {enabled.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
          </label>
        ))}
        {shown}
      </div>
      <div className="cs-panel" aria-label="Разрешённые модели">
        <h2 className="cs-h">Разрешённые модели</h2>
        {models.data.length === 0 && (
          <p className="cs-small">
            Моделей пока нет — добавьте ключ OpenRouter и включите нужные из каталога ниже.
          </p>
        )}
        {models.data.map((m) => (
          <div key={m.id} className="cs-set">
            <span className="cs-lbl">
              {m.id}
              <small className="cs-small">
                {m.provider_id} · вход {price(m.price_in_per_mtok)} / выход{' '}
                {price(m.price_out_per_mtok)} за 1M токенов · контекст{' '}
                {Math.round(m.context_tokens / 1000)}k
                {m.blocked_reason ? ` · заблокирована: ${m.blocked_reason}` : ''}
              </small>
            </span>
            <Switch
              label={`Модель ${m.id}`}
              checked={m.enabled}
              onChange={(v) =>
                void act(
                  () =>
                    must(
                      api.PATCH('/api/owner/ai/models/{id}', {
                        params: { path: { id: m.id } },
                        body: { enabled: v },
                      }),
                    ),
                  v ? 'Модель разрешена' : 'Модель запрещена',
                )
              }
            />
          </div>
        ))}
      </div>
    </>
  );
}

function Catalog() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const { act, busy, shown } = useAct();
  const catalog = useQuery({
    queryKey: ['owner-ai-catalog', q],
    queryFn: () =>
      must(api.GET('/api/owner/ai/catalog', { params: { query: { search: q || null } } })),
    retry: false,
    enabled: q.length > 0,
  });
  return (
    <div className="cs-panel" aria-label="Каталог OpenRouter">
      <h2 className="cs-h">Каталог OpenRouter</h2>
      <form
        className="cs-row"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(search.trim());
        }}
      >
        <Field
          label="Найти модель"
          placeholder="gemini, gpt, claude…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={!search.trim()}>
          Найти
        </Button>
      </form>
      {catalog.isError && <Note tone="bad">{say(catalog.error)}</Note>}
      {catalog.data?.length === 0 && (
        <p className="cs-small">Ничего — каталог появляется после ключа OpenRouter.</p>
      )}
      {catalog.data?.slice(0, 30).map((m) => (
        <div key={m.external_id} className="cs-set">
          <span className="cs-lbl">
            {m.external_id}
            <small className="cs-small">
              вход {price(m.price_in_per_mtok)} / выход {price(m.price_out_per_mtok)} за 1M
            </small>
          </span>
          {m.enabled ? (
            <small className="cs-small">разрешена</small>
          ) : (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void act(
                  () =>
                    must(
                      api.PATCH('/api/owner/ai/models/{id}', {
                        params: { path: { id: m.external_id } },
                        body: { enabled: true },
                      }),
                    ),
                  'Модель разрешена',
                ).then(() => catalog.refetch())
              }
            >
              Разрешить
            </Button>
          )}
        </div>
      ))}
      {shown}
    </div>
  );
}

// ---------------------------------------------------------------- защита

function Guard() {
  const overview = useAiOverview();
  if (overview.isPending) return <p className="cs-small">Загружаем…</p>;
  if (overview.isError) return <Note tone="bad">{say(overview.error)}</Note>;
  return <GuardForm o={overview.data} key={JSON.stringify(overview.data.loop_guard)} />;
}

function GuardForm({ o }: { o: AiOverview }) {
  const { act, busy, shown } = useAct();
  const g = o.loop_guard;
  const [v, setV] = useState({
    user_per_minute: String(g.user_per_minute),
    job_per_minute: String(g.job_per_minute),
    repeat_limit: String(g.repeat_limit),
    repeat_window_secs: String(g.repeat_window_secs),
  });
  const [error, setError] = useState<string | null>(null);
  const num = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = {
      user_per_minute: num(v.user_per_minute),
      job_per_minute: num(v.job_per_minute),
      repeat_limit: num(v.repeat_limit),
      repeat_window_secs: num(v.repeat_window_secs),
    };
    if (
      [n.user_per_minute, n.job_per_minute, n.repeat_limit].some((x) => x === null || x > 10_000)
    ) {
      setError('Целые числа от 0 до 10 000');
      return;
    }
    if (
      n.repeat_window_secs === null ||
      n.repeat_window_secs < 1 ||
      n.repeat_window_secs > 86_400
    ) {
      setError('Окно повторов — от 1 до 86 400 секунд');
      return;
    }
    setError(null);
    void act(
      () =>
        must(
          api.PUT('/api/owner/ai/loop-guard', {
            body: {
              user_per_minute: n.user_per_minute,
              job_per_minute: n.job_per_minute,
              repeat_limit: n.repeat_limit,
              repeat_window_secs: n.repeat_window_secs,
            },
          }),
        ),
      'Защита сохранена',
    );
  };
  const field = (k: keyof typeof v, label: string, hint: string) => (
    <Field
      label={label}
      inputMode="numeric"
      value={v[k]}
      onChange={(e) => setV({ ...v, [k]: e.target.value })}
      hint={hint}
    />
  );
  const s = o.loop_guard_server;
  return (
    <form className="cs-panel" aria-label="Защита от зацикливания" onSubmit={submit} noValidate>
      <span className="cs-lbl">
        <h2 className="cs-h">Защита от зацикливания</h2>
        <small className="cs-small">
          Если модуль или агент «зациклится», AI остановится до трат. 0 — проверка выключена. Сейчас
          — {o.loop_guard_from_console ? 'задано здесь' : 'как в настройках сервера'}.
        </small>
      </span>
      <div className="ai-guard">
        {field('user_per_minute', 'Запросов в минуту на человека', `сервер: ${s.user_per_minute}`)}
        {field(
          'job_per_minute',
          'Запросов в минуту на фоновую задачу',
          `сервер: ${s.job_per_minute}`,
        )}
        {field('repeat_limit', 'Один и тот же запрос — не больше раз', `сервер: ${s.repeat_limit}`)}
        {field(
          'repeat_window_secs',
          '…за столько секунд',
          `1…86 400; сервер: ${s.repeat_window_secs}`,
        )}
      </div>
      {error && <Note tone="bad">{error}</Note>}
      <div className="cs-row">
        <Button type="submit" variant="fill" disabled={busy}>
          Сохранить
        </Button>
        {o.loop_guard_from_console && (
          <Button
            disabled={busy}
            onClick={() =>
              void act(
                () => must(api.PUT('/api/owner/ai/loop-guard', { body: { reset: true } })),
                'Как в настройках сервера',
              )
            }
          >
            Как в настройках сервера
          </Button>
        )}
      </div>
      {shown}
    </form>
  );
}

// ---------------------------------------------------------------- журнал

const AI_ACTION: Record<string, string> = {
  'ai.limit_set': 'лимит задан',
  'ai.limit_revoked': 'лимит снят',
  'ai.owner_unlimited_set': 'режим «owner без лимита»',
  'ai.loop_guard_set': 'защита от зацикливания',
  'ai.key_set': 'ключ сохранён',
  'ai.key_removed': 'ключ убран',
  'ai.source_set': 'выбран источник AI',
  'ai.model_enabled_set': 'модель разрешена/запрещена',
  'ai.model_routing_set': 'провайдеры модели',
  'ai.task_model_set': 'модель для задачи',
  'ai.catalog_synced': 'каталог обновлён',
  'ai.provider_set': 'провайдер',
};

const PAGE = 50;

function Calls() {
  const [what, setWhat] = useState<'calls' | 'changes'>('calls');
  return (
    <div className="cs-panel" aria-label="Журнал AI">
      <Segmented<'calls' | 'changes'>
        label="Что в журнале"
        variant="chips"
        value={what}
        onChange={(v) => setWhat(v)}
        options={[
          { value: 'calls', label: 'Вызовы' },
          { value: 'changes', label: 'Изменения' },
        ]}
      />
      <Swap view={what} order={['calls', 'changes']}>
        <div>{what === 'calls' ? <CallLog /> : <ChangeLog />}</div>
      </Swap>
    </div>
  );
}

function CallLog() {
  const log = useInfiniteQuery({
    queryKey: ['owner-ai-calls'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      must(
        api.GET('/api/owner/ai/calls', { params: { query: { before: pageParam, limit: PAGE } } }),
      ),
    getNextPageParam: (last: AiCallItem[]) =>
      last.length < PAGE ? undefined : last[last.length - 1]!.at,
    retry: false,
  });
  if (log.isPending) return <p className="cs-small">Загружаем вызовы…</p>;
  if (log.isError) return <Note tone="bad">{say(log.error)}</Note>;
  return (
    <div className="cs-stack">
      <CallList calls={log.data.pages.flat()} />
      {log.hasNextPage && (
        <Button size="sm" onClick={() => void log.fetchNextPage()} disabled={log.isFetching}>
          Ещё
        </Button>
      )}
    </div>
  );
}

function ChangeLog() {
  const log = useInfiniteQuery({
    queryKey: ['owner-audit', 'ai'],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      must(
        api.GET('/api/owner/audit', {
          params: { query: { kind: 'ai', before: pageParam, limit: PAGE } },
        }),
      ),
    getNextPageParam: (last: AuditItem[]) =>
      last.length < PAGE ? undefined : last[last.length - 1]!.seq,
    retry: false,
  });
  if (log.isPending) return <p className="cs-small">Загружаем изменения…</p>;
  if (log.isError) return <Note tone="bad">{say(log.error)}</Note>;
  const entries = log.data.pages.flat();
  if (entries.length === 0) return <p className="cs-small">Изменений пока не было.</p>;
  return (
    <div className="cs-stack">
      <ol className="cs-log" aria-label="Изменения AI">
        {entries.map((e) => (
          <li key={e.seq}>
            <time dateTime={e.at}>{when(e.at)}</time>
            <span>
              <b>{e.actor_email ?? 'система'}</b> · {AI_ACTION[e.action] ?? e.action}
              {e.reason && <small className="cs-small"> · {e.reason}</small>}
              <code className="cs-diffline">
                {e.before != null && <>{JSON.stringify(e.before)} → </>}
                {e.after != null ? JSON.stringify(e.after) : ''}
              </code>
            </span>
          </li>
        ))}
      </ol>
      {log.hasNextPage && (
        <Button size="sm" onClick={() => void log.fetchNextPage()} disabled={log.isFetching}>
          Ещё
        </Button>
      )}
    </div>
  );
}
