import { useEffect, useRef, useState } from "react";
import { request, AuthFault } from "../auth/api";
import { useOperation } from "../auth/operation";
import { LivingButton, LivingSwitch, LivingTabs } from "../material/Controls";
import { MorphContent } from "../material/Transition";
import { Mark } from "../material/Marks";
import { Empty } from "../ui";
import {
  metadata,
  base,
  parseState,
  parseUsers,
  parseDetail,
  parseBudget,
  parseReceipt,
  parseAudit,
  changeKey,
  amount,
  usd,
  capText,
  object,
  revision as validRevision,
  validChange,
  type OwnerState,
  type User,
  type Detail,
  type Change,
  type Budget,
} from "./api";
import { useDraft, type Draft, type Packet } from "./draft";
import "./owner.css";

const tabs = [
  { id: "users", label: "Люди" },
  { id: "budgets", label: "Бюджеты AI" },
  { id: "modules", label: "Модули" },
  { id: "registration", label: "Регистрация" },
  { id: "audit", label: "Журнал" },
];
const actions = [
  { id: "read", label: "Чтение" },
  { id: "write", label: "Изменение" },
  { id: "manage", label: "Управление" },
  { id: "ai", label: "AI" },
];
const periods: Record<string, string> = {
  day: "День",
  month: "Месяц",
  all: "За всё время",
};
const names: Record<string, string> = {
  entitlement: "Право на модуль",
  ai_grant: "Доступ к модели",
  catalog_visibility: "Видимость",
  module: "Работа модуля",
  limit: "Бюджет",
  timezone: "Часовой пояс",
  dispatcher: "Ожидание AI",
  account: "Блокировка аккаунта",
  revoke_sessions: "Отзыв сессий",
  registration: "Регистрация",
};
const budgetGroup = (scope: string, key: string, period: string) =>
  `${scope}~${encodeURIComponent(key)}~${period}`;
const budgetField = (group: string, dim: string) => `budget|${group}|${dim}`;
function prepare(d: Draft): Change[] {
  if (
    d.fields.timeout !== undefined &&
    (!/^\d+$/.test(d.fields.timeout) ||
      Number(d.fields.timeout) < 1 ||
      Number(d.fields.timeout) > 300)
  )
    throw new Error(
      "Время ожидания должно быть целым числом от 1 до 300 секунд.",
    );
  const changes = d.edits.map((e) => e.change),
    groups = new Set(
      Object.keys(d.fields)
        .filter((k) => k.startsWith("budget|"))
        .map((k) => k.split("|")[1]),
    );
  for (const group of groups) {
    const [scope, encoded, period] = group.split("~");
    const c: Change = {
      kind: "limit",
      scope,
      key: decodeURIComponent(encoded),
      period,
    };
    for (const dim of ["usd_micro", "requests", "tokens"])
      c[dim] = amount(
        d.fields[budgetField(group, dim)] || "",
        dim === "usd_micro",
      );
    if ([c.usd_micro, c.requests, c.tokens].every((v) => v === null))
      throw new Error(
        "В бюджете нужен хотя бы один предел. Ноль запрещает расход; пустое поле оставляет размерность без отдельного предела.",
      );
    changes.push(c);
  }
  if (changes.length > 32)
    throw new Error(
      "В одном сохранении не больше 32 изменений. Сохрани часть настроек отдельно.",
    );
  return changes;
}
function describe(c: Change) {
  if (c.kind === "limit")
    return `${c.scope}/${c.key} · ${periods[c.period as string]} · ${usd(c.usd_micro as number | null)} · запросы ${c.requests ?? "—"} · токены ${c.tokens ?? "—"}`;
  if (c.kind === "catalog_visibility")
    return c.visibility === "hidden"
      ? "Скрывать без доступа"
      : "Показывать с замком";
  if (c.kind === "module")
    return c.enabled ? "Включить модуль" : "Выключить модуль";
  if (c.kind === "entitlement" || c.kind === "ai_grant")
    return `${c.effect === "allow" ? "Разрешить" : "Отозвать"} · ${c.module} · ${c.action ? actions.find((a) => a.id === c.action)?.label : c.provider + "/" + String(c.model)} · ${c.expires_at ? "до " + new Date(String(c.expires_at)).toLocaleString("ru-RU") : "без срока"}`;
  if (c.kind === "account")
    return c.blocked
      ? "Заблокировать, завершить сессии"
      : "Разблокировать с сохранением проверки почты";
  if (c.kind === "revoke_sessions")
    return "Завершить все сессии этого пользователя";
  if (c.kind === "timezone") return String(c.name);
  if (c.kind === "dispatcher") return `${c.timeout_seconds} секунд`;
  return c.mode === "public"
    ? "Открытая регистрация"
    : c.mode === "invite"
      ? "Регистрация по приглашениям"
      : "Регистрация выключена";
}
function currentText(c: Change, value: unknown) {
  if (!Array.isArray(value)) return "Не задано";
  if (c.kind === "limit")
    return `${usd(value[0] as number | null)} · запросы ${value[1] ?? "—"} · токены ${value[2] ?? "—"}`;
  if (c.kind === "entitlement" || c.kind === "ai_grant")
    return `${value[0] === "allow" ? "Разрешено" : "Запрещено"} · ${value[1] ? "до " + new Date(String(value[1])).toLocaleString("ru-RU") : "без срока"}`;
  if (c.kind === "catalog_visibility")
    return value[0] === "hidden" ? "Скрывать" : "С замком";
  if (c.kind === "module")
    return !value[0] ? "Ещё не установлен" : value[1] ? "Включён" : "Выключен";
  if (c.kind === "registration")
    return value[0] === "public"
      ? "Открыта"
      : value[0] === "invite"
        ? "По приглашению"
        : "Выключена";
  if (c.kind === "account" || c.kind === "revoke_sessions")
    return value[0] === "blocked"
      ? "Заблокирован"
      : value[0] === "pending"
        ? "Ждёт подтверждения"
        : "Активен";
  return String(value[0]);
}

export function OwnerConsole({
  owner,
  onSaved,
}: {
  owner: string;
  onSaved: () => void;
}) {
  const memory = useDraft(owner),
    { draft } = memory;
  const [data, setData] = useState<OwnerState | null>(null),
    [failed, setFailed] = useState(false),
    [refresh, setRefresh] = useState(0),
    [password, setPassword] = useState(""),
    [notice, setNotice] = useState(""),
    [retry, setRetry] = useState(false),
    [review, setReview] = useState<{
      revision: string;
      items: { change: Change; current: unknown }[];
    } | null>(null);
  const op = useOperation(),
    generation = useRef(0);
  const tab = draft.fields.tab || "modules";
  useEffect(() => {
    const n = ++generation.current,
      c = new AbortController(),
      timer = setTimeout(() => c.abort(), 8000);
    setData(null);
    setFailed(false);
    void metadata("", c.signal)
      .then((v) => {
        const state = parseState(v);
        if (n === generation.current && !c.signal.aborted) setData(state);
      })
      .catch(() => {
        if (n === generation.current) setFailed(true);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      ++generation.current;
      c.abort();
      clearTimeout(timer);
    };
  }, [refresh, owner]);
  const dirty =
    draft.edits.length > 0 ||
    Object.keys(draft.fields).some((k) => k.startsWith("budget|"));
  let proposed: Change[] = [],
    invalid = "";
  try {
    proposed = prepare(draft);
  } catch (e) {
    invalid = (e as Error).message;
  }
  const conflict = !!(data && dirty && draft.revision !== data.revision);
  const proposedText = JSON.stringify(proposed);
  useEffect(() => {
    setReview(null);
    if (!conflict || draft.packet || invalid || !proposed.length) return;
    const c = new AbortController();
    void metadata("/review", c.signal, { changes: JSON.parse(proposedText) })
      .then((v) => {
        if (
          !object(v) ||
          !object(v.data) ||
          !validRevision(v.data.revision) ||
          !Array.isArray(v.data.items) ||
          v.data.items.length !== proposed.length ||
          v.data.items.some(
            (i) =>
              !object(i) ||
              !validChange(i.change) ||
              !(i.current === null || Array.isArray(i.current)),
          )
        )
          throw new AuthFault("invalid_response");
        if (!c.signal.aborted)
          setReview(
            v.data as {
              revision: string;
              items: { change: Change; current: unknown }[];
            },
          );
      })
      .catch(() => {
        if (!c.signal.aborted)
          op.setError(
            "Не удалось сверить текущие значения. Черновик сохранён; обнови настройки.",
          );
      });
    return () => c.abort();
  }, [conflict, data?.revision, proposedText, !!draft.packet, invalid]);
  function edit(c: Change, label: string, previous: string) {
    if (data && !op.busy && !draft.packet)
      memory.edit(c, label, previous, data.revision);
  }
  function choice(
    kind: string,
    module: string,
    field: string,
    fallback: string | boolean,
  ) {
    return (
      draft.edits.find(
        (e) => e.change.kind === kind && e.change.module === module,
      )?.change[field] ?? fallback
    );
  }
  async function proof(signal: AbortSignal) {
    if (password) {
      if (
        (await request("/api/v1/auth/reauth", signal, "POST", { password })) !==
        null
      )
        throw new AuthFault("invalid_response");
      setData((d) =>
        d
          ? { ...d, reauth_until: new Date(Date.now() + 290000).toISOString() }
          : d,
      );
    } else if (
      !data?.reauth_until ||
      Date.parse(data.reauth_until) <= Date.now()
    )
      throw new AuthFault("reauth_required");
  }
  function completed() {
    memory.update((d) => ({
      ...d,
      edits: [],
      packet: null,
      fields: Object.fromEntries(
        Object.entries(d.fields).filter(
          ([k]) => !k.startsWith("budget|") && k !== "timeout",
        ),
      ),
    }));
    setNotice("Изменения сохранены на сервере.");
    setRetry(false);
    setRefresh((n) => n + 1);
    onSaved();
  }
  function save() {
    if (!data || invalid || conflict || !proposed.length || op.busy) return;
    const packet: Packet = {
      id: crypto.randomUUID(),
      expected: draft.revision,
      changes: proposed,
    };
    void op.run(async (signal) => {
      try {
        await proof(signal);
        if (!memory.update((d) => ({ ...d, packet }))) return;
        const receipt = parseReceipt(
          await request(
            base + "/commands",
            signal,
            "POST",
            { changes: packet.changes },
            {
              "If-Match": `"${packet.expected}"`,
              "Idempotency-Key": packet.id,
            },
          ),
        );
        if (receipt.id !== packet.id || receipt.count !== packet.changes.length)
          throw new AuthFault("invalid_response");
        if (!signal.aborted) completed();
      } catch (e) {
        if (e instanceof AuthFault && e.status > 0 && e.status < 500) {
          memory.update((d) => ({ ...d, packet: null }));
          if (e.code === "owner_conflict") setRefresh((n) => n + 1);
        }
        throw e;
      } finally {
        setPassword("");
      }
    });
  }
  function reconcile(resend = false) {
    const packet = draft.packet;
    if (!packet) return;
    void op.run(async (signal) => {
      try {
        const receipt = parseReceipt(
          await request(base + "/receipts/" + packet.id, signal),
        );
        if (receipt.id !== packet.id || receipt.count !== packet.changes.length)
          throw new AuthFault("invalid_response");
        if (!signal.aborted) completed();
      } catch (e) {
        if (!(e instanceof AuthFault) || e.status !== 404) throw e;
        if (!resend) {
          setRetry(true);
          setNotice(
            "Сохранённый пакет на сервере пока не найден. Можно явно повторить его с тем же номером.",
          );
          return;
        }
        try {
          await proof(signal);
          const receipt = parseReceipt(
            await request(
              base + "/commands",
              signal,
              "POST",
              { changes: packet.changes },
              {
                "If-Match": `"${packet.expected}"`,
                "Idempotency-Key": packet.id,
              },
            ),
          );
          if (
            receipt.id !== packet.id ||
            receipt.count !== packet.changes.length
          )
            throw new AuthFault("invalid_response");
          if (!signal.aborted) completed();
        } catch (error) {
          if (
            error instanceof AuthFault &&
            error.status > 0 &&
            error.status < 500
          ) {
            memory.update((d) => ({ ...d, packet: null }));
            setRetry(false);
            setRefresh((n) => n + 1);
          }
          throw error;
        }
      } finally {
        setPassword("");
      }
    });
  }
  function field(k: string, v: string) {
    if (k.startsWith("budget|") && data) {
      memory.update((d) => ({
        ...d,
        revision:
          d.edits.length ||
          Object.keys(d.fields).some((x) => x.startsWith("budget|"))
            ? d.revision
            : data.revision,
        fields: { ...d.fields, [k]: v },
      }));
    } else memory.field(k, v);
  }
  const props = { data, draft, edit, field, busy: op.busy || !!draft.packet };
  if (!data)
    return (
      <>
        <Empty
          title={
            failed
              ? "Не удалось загрузить Owner Console"
              : "Загружаем управление Qubite"
          }
          text="Черновик хранится отдельно и не применяется автоматически."
        />
        {failed && (
          <LivingButton
            className="button blue"
            onClick={() => setRefresh((n) => n + 1)}
          >
            Обновить настройки
          </LivingButton>
        )}
      </>
    );
  return (
    <div className="owner-console">
      <div className="owner-heading">
        <div>
          <span className="eyebrow">ТВОЁ ПРОСТРАНСТВО · ТВОИ ПРАВИЛА</span>
          <h2>Управление Qubite</h2>
          <p>Доступ — осознанно. Изменения — под твоим контролем.</p>
        </div>
        <span className="owner-seal">
          <Mark service="qubite" />
        </span>
      </div>
      <div className="owner-storage-note">
        <span className="status-chip">
          {memory.error
            ? "Черновик не записан"
            : dirty || draft.packet
              ? "Черновик на устройстве"
              : "Все изменения сохранены"}
        </span>
        <p>
          Перезагрузка и переход между экранами сохраняют введённое в этом
          браузере. Пароли и секретные приглашения здесь не хранятся.
        </p>
      </div>
      {memory.restored && (dirty || draft.packet) && (
        <p role="status">
          Восстановлен незавершённый черновик. Проверь изменения перед
          сохранением.
        </p>
      )}
      {memory.alternatives.length > 0 && (
        <details className="owner-other-drafts">
          <summary>
            Другие черновики на этом устройстве ({memory.alternatives.length})
          </summary>
          {memory.alternatives.map((d) => (
            <LivingButton
              className="button small-button"
              key={d.id}
              disabled={op.busy || dirty || !!draft.packet}
              onClick={() => memory.restore(d)}
            >
              Открыть от {new Date(d.updated).toLocaleString("ru-RU")}
            </LivingButton>
          ))}
        </details>
      )}
      <LivingTabs
        label="Разделы Owner Console"
        items={tabs}
        value={tab}
        onChange={(v) => {
          memory.field("tab", v);
          op.setError("");
        }}
      />
      <fieldset className="owner-fields" disabled={op.busy || !!draft.packet}>
        <legend className="sr-only">Настройки платформы</legend>
        <MorphContent identity={tab} privateContent>
          {tab === "modules" && (
            <section className="plain-card visibility-card">
              <h2>Видимость модулей</h2>
              <p>
                Общая настройка для людей без доступа. Разрешения и установка
                настраиваются отдельно.
              </p>
              {data.modules.map((m) => (
                <div className="owner-module" key={m.id}>
                  <div className="owner-module-title">
                    <span className="note-icon blue">
                      <Mark service={m.id} />
                    </span>
                    <div>
                      <h3>{m.name}</h3>
                      <p>
                        {!m.installed || !m.released
                          ? "Готовится"
                          : m.enabled
                            ? "Включён"
                            : "Временно недоступен"}
                      </p>
                    </div>
                  </div>
                  <LivingTabs
                    label={`${m.name}: без доступа`}
                    items={[
                      { id: "hidden", label: "Скрывать" },
                      { id: "locked", label: "С замком" },
                    ]}
                    value={String(
                      choice(
                        "catalog_visibility",
                        m.id,
                        "visibility",
                        m.visibility,
                      ),
                    )}
                    onChange={(v) =>
                      edit(
                        {
                          kind: "catalog_visibility",
                          reason: "configure",
                          module: m.id,
                          visibility: v,
                        },
                        `Видимость: ${m.name}`,
                        m.visibility,
                      )
                    }
                  />
                  <LivingSwitch
                    label={`Работа модуля: ${m.name}`}
                    checked={Boolean(
                      choice("module", m.id, "enabled", m.enabled),
                    )}
                    disabled={!m.installed || props.busy}
                    onChange={(v) =>
                      edit(
                        {
                          kind: "module",
                          reason: "configure",
                          module: m.id,
                          enabled: v,
                        },
                        `Модуль: ${m.name}`,
                        String(m.enabled),
                      )
                    }
                  />
                </div>
              ))}
              <p className="small">
                Установщик появится отдельно. Tournaments — самостоятельная
                платформа и здесь не управляется.
              </p>
            </section>
          )}
          {tab === "users" && (
            <Users {...props} owner={owner} revision={refresh} />
          )}
          {tab === "budgets" && (
            <>
              <BudgetPanel
                {...props}
                scope="global"
                accountKey="*"
                advancedScope
              />
              <section className="plain-card">
                <h2>Ритм AI</h2>
                <label className="auth-field">
                  Часовой пояс
                  <input
                    value={String(
                      draft.edits.find((e) => e.change.kind === "timezone")
                        ?.change.name ?? data.timezone,
                    )}
                    maxLength={100}
                    onChange={(e) =>
                      edit(
                        { kind: "timezone", name: e.target.value },
                        "Часовой пояс",
                        data.timezone,
                      )
                    }
                  />
                </label>
                <label className="auth-field">
                  Ожидание ответа, секунды
                  <input
                    type="number"
                    min="1"
                    max="300"
                    value={
                      draft.fields.timeout ??
                      String(
                        draft.edits.find((e) => e.change.kind === "dispatcher")
                          ?.change.timeout_seconds ?? data.timeout_seconds,
                      )
                    }
                    onChange={(e) => {
                      memory.field("timeout", e.target.value);
                      if (/^\d+$/.test(e.target.value))
                        edit(
                          {
                            kind: "dispatcher",
                            timeout_seconds: Number(e.target.value),
                          },
                          "Ожидание ответа",
                          String(data.timeout_seconds),
                        );
                    }}
                  />
                </label>
                <p className="small">
                  Смена пояса не сбрасывает расходы. Неизвестный результат
                  продолжает удерживать резерв.
                </p>
              </section>
              <div className="owner-funding">
                <section className="plain-card">
                  <span className="status-chip">Готовится</span>
                  <h3>Личный ChatGPT</h3>
                  <p>
                    Отдельный источник доступа по возможностям аккаунта.
                    Проверка поддержки и подключение будут отдельной задачей.
                  </p>
                </section>
                <section className="plain-card">
                  <span className="status-chip">Готовится</span>
                  <h3>API владельца</h3>
                  <p>
                    Независимые разрешения и твои лимиты. Сейчас доступен только
                    тестовый провайдер; ключи и реальные расходы не включаются.
                  </p>
                </section>
              </div>
            </>
          )}
          {tab === "registration" && (
            <Registration
              {...props}
              proof={proof}
              password={password}
              setPassword={setPassword}
              rememberInvite={(id) =>
                memory.update((d) => ({
                  ...d,
                  fields: { ...d.fields, invite_pending: id },
                }))
              }
            />
          )}
          {tab === "audit" && <Audit revision={data.revision} />}
        </MorphContent>
      </fieldset>
      {(dirty || draft.packet || op.error || notice || memory.error) && (
        <section
          className="owner-save plain-card"
          aria-label="Сохранение изменений"
        >
          <div className="visibility-heading">
            <h2>{draft.packet ? "Проверим результат" : "Твои изменения"}</h2>
            <span className="status-chip">
              {draft.packet?.changes.length || proposed.length} изменений
            </span>
          </div>
          <p className="small">
            Настройки начнут действовать после явного сохранения.
            Восстановленный черновик сам ничего не включает.
          </p>
          {invalid && <p role="alert">{invalid}</p>}
          <ul className="owner-change-list">
            {draft.edits.map((e) => (
              <li key={changeKey(e.change)}>
                <strong>{e.label}</strong>
                <span>Было: {e.previous || "не задано"}</span>
                <span>Будет: {describe(e.change)}</span>
                {!draft.packet && (
                  <LivingButton
                    className="button small-button"
                    disabled={op.busy}
                    onClick={() =>
                      memory.update((d) => ({
                        ...d,
                        edits: d.edits.filter(
                          (x) => changeKey(x.change) !== changeKey(e.change),
                        ),
                      }))
                    }
                  >
                    Убрать изменение: {e.label}
                  </LivingButton>
                )}
              </li>
            ))}
            {proposed
              .filter((c) => c.kind === "limit")
              .map((c) => (
                <li key={changeKey(c)}>
                  <strong>Бюджет</strong>
                  <span>{describe(c)}</span>
                </li>
              ))}
          </ul>
          {conflict && !draft.packet && (
            <div className="auth-alert" role="alert">
              <p>
                Настройки изменились в другой вкладке или на сервере. Черновик
                сохранён. Сверь текущие значения с предлагаемыми ниже.
              </p>
              <LivingButton
                className="button blue"
                disabled={op.busy}
                onClick={() => setRefresh((n) => n + 1)}
              >
                Обновить настройки
              </LivingButton>
              {review ? (
                <ul className="owner-change-list">
                  {review.items.map((item, i) => (
                    <li key={i}>
                      <strong>
                        {names[item.change.kind] || item.change.kind}
                      </strong>
                      <span>
                        Сейчас на сервере:{" "}
                        {currentText(item.change, item.current)}
                      </span>
                      <span>Предлагается: {describe(item.change)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p role="status">Получаем текущие значения с сервера…</p>
              )}
              <LivingButton
                className="button blue"
                disabled={op.busy || !review}
                onClick={() => {
                  if (!review) return;
                  memory.update((d) => ({ ...d, revision: review.revision }));
                  setData((d) => (d ? { ...d, revision: review.revision } : d));
                  setNotice(
                    "Текущая серверная версия выбрана основой. Проверь сводку и нажми «Сохранить изменения».",
                  );
                }}
              >
                Я сверил: использовать текущую версию
              </LivingButton>
            </div>
          )}
          <label className="auth-field owner-catalog-password">
            Твой пароль для подтверждения
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              maxLength={256}
              disabled={op.busy}
              onChange={(e) => setPassword(e.target.value)}
            />
            <small>
              Подтверждение действует до пяти минут. Пароль не сохраняется в
              черновике.
            </small>
          </label>
          {draft.packet ? (
            <div className="owner-actions">
              <LivingButton
                className="button blue"
                disabled={op.busy}
                onClick={() => reconcile()}
              >
                Проверить сохранение
              </LivingButton>
              {retry && (
                <LivingButton
                  className="button orange"
                  disabled={op.busy}
                  onClick={() => reconcile(true)}
                >
                  Повторить тот же пакет
                </LivingButton>
              )}
            </div>
          ) : (
            <div className="owner-actions">
              <LivingButton
                className="button orange"
                disabled={
                  op.busy ||
                  conflict ||
                  !!invalid ||
                  !proposed.length ||
                  !!memory.error
                }
                onClick={save}
              >
                Сохранить изменения
              </LivingButton>
              <LivingButton
                className="button"
                disabled={op.busy}
                onClick={() => {
                  memory.clear();
                  setNotice("Черновик удалён с этого устройства.");
                }}
              >
                Удалить черновик
              </LivingButton>
            </div>
          )}
          {memory.error && (
            <div role="alert">
              <p>{memory.error}</p>
              <LivingButton
                className="button"
                onClick={() => {
                  const url = URL.createObjectURL(
                      new Blob([JSON.stringify(draft)], {
                        type: "application/json",
                      }),
                    ),
                    a = document.createElement("a");
                  a.href = url;
                  a.download = "qubite-owner-draft.json";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                Скачать черновик
              </LivingButton>
              <LivingButton
                className="button"
                onClick={() => memory.update((d) => ({ ...d }))}
              >
                Повторить запись черновика
              </LivingButton>
            </div>
          )}
          {op.busy && <p role="status">Проверяем и сохраняем…</p>}
          {op.error &&
            !(
              conflict &&
              op.error.startsWith("Настройки изменились в другой вкладке.")
            ) && (
              <div className="auth-alert" role="alert">
                <p>{op.error}</p>
                <p>
                  Черновик сохранён. При потерянном ответе сначала проверь
                  результат.
                </p>
                <LivingButton
                  className="button blue"
                  disabled={op.busy}
                  onClick={() => setRefresh((n) => n + 1)}
                >
                  Обновить настройки
                </LivingButton>
              </div>
            )}
          {notice && <p role="status">{notice}</p>}
        </section>
      )}
    </div>
  );
}

type Props = {
  data: OwnerState | null;
  draft: Draft;
  edit: (c: Change, label: string, previous: string) => void;
  field: (k: string, v: string) => void;
  busy: boolean;
};
function Users({
  data,
  draft,
  edit,
  field,
  busy,
  owner,
  revision,
}: { owner: string; revision: number } & Props) {
  const [users, setUsers] = useState<User[]>([]),
    [next, setNext] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState({ search: "", after: null as string | null }),
    [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState("");
  const selected = draft.fields.selected_user || "";
  useEffect(() => {
    const c = new AbortController();
    setError("");
    setUsers([]);
    void metadata("/users", c.signal, query)
      .then((v) => {
        const p = parseUsers(v);
        if (!c.signal.aborted) {
          setUsers(p.items);
          setNext(p.next);
        }
      })
      .catch(() => {
        if (!c.signal.aborted) setError("Не удалось загрузить пользователей.");
      });
    return () => c.abort();
  }, [query, revision, data?.revision]);
  useEffect(() => {
    setDetail(null);
    if (!selected) return;
    const c = new AbortController();
    void metadata("/users/" + selected, c.signal)
      .then((v) => {
        const d = parseDetail(v);
        if (d.subject_id !== selected) throw new AuthFault("invalid_response");
        if (!c.signal.aborted) setDetail(d);
      })
      .catch(() => {
        if (!c.signal.aborted)
          setError("Не удалось загрузить права пользователя.");
      });
    return () => c.abort();
  }, [selected, data?.revision]);
  const user = users.find((u) => u.id === selected);
  function current(module: string, action: string) {
    return draft.edits.find(
      (e) =>
        e.change.kind === "entitlement" &&
        e.change.subject_id === selected &&
        e.change.module === module &&
        e.change.action === action,
    )?.change;
  }
  return (
    <div className="owner-people">
      <section className="plain-card">
        <h2>Пользователи</h2>
        <form
          className="owner-search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery({ search, after: null });
          }}
        >
          <label className="auth-field">
            Найти по имени или email
            <input
              value={search}
              maxLength={160}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <LivingButton className="button blue" type="submit">
            Найти
          </LivingButton>
        </form>
        <div className="owner-user-list">
          {users.map((u) => (
            <LivingButton
              className={`owner-person ${u.id === selected ? "chosen" : ""}`}
              key={u.id}
              onClick={() => field("selected_user", u.id)}
            >
              <span className="owner-avatar">
                {(u.display_name || u.email).slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{u.display_name || u.email}</strong>
                <small>{u.email}</small>
              </span>
              <span className="status-chip">
                {u.platform_owner
                  ? "Владелец"
                  : u.status === "active"
                    ? "Активен"
                    : u.status === "blocked"
                      ? "Заблокирован"
                      : "Ждёт подтверждения"}
              </span>
            </LivingButton>
          ))}
        </div>
        {!users.length && !error && <p>Пользователей по этому запросу нет.</p>}
        {next && (
          <LivingButton
            className="button"
            onClick={() => setQuery((q) => ({ ...q, after: next }))}
          >
            Следующие пользователи
          </LivingButton>
        )}
        {query.after && (
          <LivingButton
            className="button"
            onClick={() => setQuery((q) => ({ ...q, after: null }))}
          >
            К началу списка
          </LivingButton>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
      {selected && detail && data && (
        <>
          <section className="plain-card">
            <span className="eyebrow">ДОСТУП ЛИЧНО ДЛЯ ЭТОГО АККАУНТА</span>
            <h2>{user?.display_name || user?.email || "Права пользователя"}</h2>
            <p className="small">
              Каждое право независимо. Доступ к модулю не открывает чужие
              документы или рабочие пространства.
            </p>
            {data.modules.map((m) => (
              <section className="owner-grant-module" key={m.id}>
                <h3>{m.name}</h3>
                <div className="owner-grants">
                  {actions.map((a) => {
                    const original = detail.grants.find(
                        (g) => g.module === m.id && g.action === a.id,
                      ),
                      modified = current(m.id, a.id),
                      expiry =
                        modified?.expires_at ?? original?.expires_at ?? null;
                    const allowed = modified
                      ? modified.effect === "allow"
                      : !!original &&
                        original.effect === "allow" &&
                        (!original.expires_at ||
                          Date.parse(original.expires_at) > Date.now());
                    return (
                      <LivingSwitch
                        key={a.id}
                        label={`${m.name}: ${a.label}`}
                        checked={allowed}
                        disabled={busy}
                        onChange={(v) =>
                          edit(
                            {
                              kind: "entitlement",
                              reason: v ? "grant" : "revoke",
                              module: m.id,
                              subject_id: selected,
                              action: a.id,
                              effect: v ? "allow" : "deny",
                              expires_at:
                                typeof expiry === "string" &&
                                Date.parse(expiry) > Date.now()
                                  ? expiry
                                  : null,
                            },
                            `${m.name}: ${a.label}`,
                            original?.effect || "не выдано",
                          )
                        }
                      />
                    );
                  })}
                </div>
              </section>
            ))}
            <details>
              <summary>Сроки доступа и конкретные модели</summary>
              {data.modules.map((m) => (
                <label className="auth-field" key={m.id}>
                  {m.name}: срок права чтения
                  <input
                    type="datetime-local"
                    value={(() => {
                      const g = current(m.id, "read");
                      const v = g
                        ? g.expires_at
                        : detail.grants.find(
                            (x) => x.module === m.id && x.action === "read",
                          )?.expires_at;
                      return typeof v === "string" ? localDate(v) : "";
                    })()}
                    onChange={(e) => {
                      const date = e.target.value
                        ? new Date(e.target.value).toISOString()
                        : null;
                      const g =
                        current(m.id, "read") ||
                        detail.grants.find(
                          (x) => x.module === m.id && x.action === "read",
                        );
                      edit(
                        {
                          kind: "entitlement",
                          reason: "configure",
                          module: m.id,
                          subject_id: selected,
                          action: "read",
                          effect: String(g?.effect || "deny"),
                          expires_at: date,
                        },
                        `${m.name}: срок чтения`,
                        String(g?.expires_at || "без срока"),
                      );
                    }}
                  />
                </label>
              ))}
              <p>Конкретная модель требует отдельного разрешения и бюджета.</p>
              {detail.models.map((g) => (
                <LivingSwitch
                  key={`${g.module}/${g.provider}/${g.model}`}
                  label={`${g.module}: ${g.provider}/${g.model}`}
                  checked={
                    (draft.edits.find(
                      (e) =>
                        e.change.kind === "ai_grant" &&
                        e.change.subject_id === selected &&
                        e.change.module === g.module &&
                        e.change.provider === g.provider &&
                        e.change.model === g.model,
                    )?.change.effect ?? g.effect) === "allow"
                  }
                  disabled={busy || g.provider !== "mock"}
                  onChange={(v) =>
                    edit(
                      {
                        kind: "ai_grant",
                        reason: v ? "grant" : "revoke",
                        subject_id: selected,
                        ...g,
                        effect: v ? "allow" : "deny",
                      },
                      `Модель: ${g.module}/${g.provider}/${g.model}`,
                      g.effect,
                    )
                  }
                />
              ))}
              {detail.more_models && (
                <p role="alert">
                  Показаны первые 128 настроек моделей. Невидимые настройки не
                  изменяются.
                </p>
              )}
              <label className="auth-field">
                Модуль для модели
                <select
                  value={draft.fields.model_module || "docs"}
                  onChange={(e) => field("model_module", e.target.value)}
                >
                  {data.modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="auth-field">
                Название тестовой модели
                <input
                  value={draft.fields.model_name || ""}
                  maxLength={96}
                  onChange={(e) => field("model_name", e.target.value)}
                />
              </label>
              <LivingButton
                className="button blue"
                disabled={
                  !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(
                    draft.fields.model_name || "",
                  )
                }
                onClick={() =>
                  edit(
                    {
                      kind: "ai_grant",
                      reason: "grant",
                      subject_id: selected,
                      module: draft.fields.model_module || "docs",
                      provider: "mock",
                      model: draft.fields.model_name,
                      effect: "allow",
                      expires_at: null,
                    },
                    "Доступ к тестовой модели",
                    "не выдано",
                  )
                }
              >
                Добавить разрешение модели
              </LivingButton>
            </details>
            {selected !== owner && user && !user.platform_owner && (
              <details>
                <summary>Безопасность аккаунта</summary>
                <LivingSwitch
                  label="Заблокировать аккаунт"
                  checked={Boolean(
                    draft.edits.find(
                      (e) =>
                        e.change.kind === "account" &&
                        e.change.subject_id === selected,
                    )?.change.blocked ?? user.status === "blocked",
                  )}
                  onChange={(v) =>
                    edit(
                      { kind: "account", subject_id: selected, blocked: v },
                      "Блокировка аккаунта",
                      user.status,
                    )
                  }
                />
                <LivingButton
                  className="button"
                  onClick={() =>
                    edit(
                      { kind: "revoke_sessions", subject_id: selected },
                      "Завершить все сессии пользователя",
                      "текущие сессии",
                    )
                  }
                >
                  Завершить все сессии пользователя
                </LivingButton>
                <p className="small">
                  Разблокировка не подтверждает почту. Владелец через эту панель
                  не меняется.
                </p>
              </details>
            )}
          </section>
          <BudgetPanel
            key={selected}
            data={data}
            draft={draft}
            edit={edit}
            field={field}
            busy={busy}
            scope="user"
            accountKey={selected}
          />
        </>
      )}
    </div>
  );
}
function localDate(v: string) {
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

function BudgetPanel({
  data,
  draft,
  field,
  busy,
  scope,
  accountKey,
  advancedScope = false,
}: Props & { scope: string; accountKey: string; advancedScope?: boolean }) {
  const [budget, setBudget] = useState<Budget | null>(null),
    [failed, setFailed] = useState(false),
    [query, setQuery] = useState({ scope, key: accountKey });
  useEffect(() => {
    setQuery({ scope, key: accountKey });
  }, [scope, accountKey]);
  useEffect(() => {
    const c = new AbortController();
    setBudget(null);
    setFailed(false);
    void metadata("/budget", c.signal, query)
      .then((v) => {
        const b = parseBudget(v);
        if (b.scope !== query.scope || b.key !== query.key)
          throw new AuthFault("invalid_response");
        if (!c.signal.aborted) setBudget(b);
      })
      .catch(() => {
        if (!c.signal.aborted) setFailed(true);
      });
    return () => c.abort();
  }, [query, data?.revision]);
  function input(period: string, dim: string, value: string) {
    if (!budget || !data) return;
    const group = budgetGroup(query.scope, query.key, period),
      r = budget.items.find((r) => r.period === period)!;
    // Seed every dimension on first edit, so later reload/selection cannot silently replace a sibling cap.
    for (const k of ["usd_micro", "requests", "tokens"]) {
      const key = budgetField(group, k);
      if (draft.fields[key] === undefined)
        field(
          key,
          capText(
            r[k as "usd_micro" | "requests" | "tokens"],
            k === "usd_micro",
          ),
        );
    }
    field(budgetField(group, dim), value);
  }
  return (
    <section className="plain-card owner-budget">
      <div className="visibility-heading">
        <h2>{query.scope === "user" ? "Бюджет пользователя" : "Бюджеты AI"}</h2>
        <span className="status-chip">USD</span>
      </div>
      {advancedScope && (
        <details>
          <summary>Область ограничения</summary>
          <form
            className="owner-scope"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery({
                scope: draft.fields.budget_scope || "global",
                key: draft.fields.budget_key || "*",
              });
            }}
          >
            <label className="auth-field">
              Область
              <select
                value={draft.fields.budget_scope || "global"}
                onChange={(e) => {
                  field("budget_scope", e.target.value);
                  field("budget_key", e.target.value === "global" ? "*" : "");
                }}
              >
                {[
                  ["global", "Вся платформа"],
                  ["user", "Пользователь"],
                  ["module", "Модуль"],
                  ["model", "Модель"],
                  ["project", "Проект"],
                ].map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="auth-field">
              Идентификатор области
              <input
                value={draft.fields.budget_key ?? "*"}
                maxLength={145}
                onChange={(e) => field("budget_key", e.target.value)}
              />
            </label>
            <LivingButton type="submit" className="button blue">
              Показать бюджет
            </LivingButton>
          </form>
          <p className="small">
            Пользователь и проект — UUID, модуль — системное имя, модель —
            mock/название. Это ограничения, а не выдача доступа.
          </p>
        </details>
      )}
      {budget ? (
        <>
          <p className="small">
            {query.scope}/{query.key}. Лимиты пересекаются. Резерв включает
            незавершённые запросы прошлых периодов.
          </p>
          <div className="owner-money-grid">
            {budget.items
              .filter((r) => r.period !== "all")
              .map((r) => (
                <article
                  key={r.period}
                  className={`owner-money ${r.period === "day" ? "orange" : "blue"}`}
                >
                  <span>{periods[r.period]}</span>
                  <strong>{usd(r.remaining_usd)}</strong>
                  <small>
                    {r.usd_micro === null
                      ? "Денежный предел не задан"
                      : "Денежный предел: " + usd(r.usd_micro)}
                  </small>
                  <dl>
                    <div>
                      <dt>Потрачено</dt>
                      <dd>{usd(r.spent_usd)}</dd>
                    </div>
                    <div>
                      <dt>В резерве</dt>
                      <dd>{usd(r.reserved_usd)}</dd>
                    </div>
                  </dl>
                  <label className="auth-field">
                    {periods[r.period]}: предел в USD
                    <input
                      inputMode="decimal"
                      value={
                        draft.fields[
                          budgetField(
                            budgetGroup(query.scope, query.key, r.period),
                            "usd_micro",
                          )
                        ] ?? capText(r.usd_micro, true)
                      }
                      onChange={(e) =>
                        input(r.period, "usd_micro", e.target.value)
                      }
                      disabled={busy}
                    />
                  </label>
                </article>
              ))}
          </div>
          <details>
            <summary>Все лимиты: деньги, запросы и токены</summary>
            {budget.items.map((r) => (
              <div className="owner-period" key={r.period}>
                <h3>{periods[r.period]}</h3>
                <div className="owner-limit-fields">
                  {["usd_micro", "requests", "tokens"].map((dim) => (
                    <label className="auth-field" key={dim}>
                      {periods[r.period]}:{" "}
                      {dim === "usd_micro"
                        ? "USD"
                        : dim === "requests"
                          ? "запросы"
                          : "токены"}
                      <input
                        inputMode={dim === "usd_micro" ? "decimal" : "numeric"}
                        value={
                          draft.fields[
                            budgetField(
                              budgetGroup(query.scope, query.key, r.period),
                              dim,
                            )
                          ] ??
                          capText(
                            r[dim as "usd_micro" | "requests" | "tokens"],
                            dim === "usd_micro",
                          )
                        }
                        disabled={busy}
                        onChange={(e) => input(r.period, dim, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
                <p className="small">
                  Израсходовано запросов/токенов: {r.spent_requests}/
                  {r.spent_tokens}; в резерве: {r.reserved_requests}/
                  {r.reserved_tokens}.
                </p>
              </div>
            ))}
            <p className="small">
              Общий денежный предел «За всё время» обязателен у платформы и
              пользователя. Ноль запрещает расход. Пустая размерность не
              добавляет отдельного ограничения. Сохранение не сбрасывает учёт.
            </p>
          </details>
          {budget.freezes.length > 0 && (
            <div className="auth-alert" role="alert">
              Маршруты заморожены:{" "}
              {budget.freezes.map((f) => `${f.provider}/${f.model}`).join(", ")}
              . Автоматического снятия заморозки нет.
            </div>
          )}
        </>
      ) : (
        <p role="status">
          {failed
            ? "Не удалось загрузить бюджет. Проверь область и обнови настройки."
            : "Загружаем расходы и лимиты…"}
        </p>
      )}
    </section>
  );
}

function Registration({
  data,
  draft,
  edit,
  field,
  proof,
  password,
  setPassword,
  rememberInvite,
}: Props & {
  rememberInvite: (id: string) => boolean;
  proof: (s: AbortSignal) => Promise<void>;
  password: string;
  setPassword: (v: string) => void;
}) {
  const [invites, setInvites] = useState<Record<string, unknown>[]>([]),
    [secret, setSecret] = useState<{ id: string; token: string } | null>(null),
    [refresh, setRefresh] = useState(0),
    [pending, setPending] = useState<string | null>(
      draft.fields.invite_pending || null,
    ),
    [notice, setNotice] = useState("");
  const op = useOperation();
  useEffect(() => {
    const c = new AbortController();
    void request("/api/v1/owner/registration/invites", c.signal)
      .then((v) => {
        if (!object(v) || !Array.isArray(v.items) || v.items.length > 100)
          throw new AuthFault("invalid_response");
        if (!c.signal.aborted) setInvites(v.items);
      })
      .catch(() => {
        if (!c.signal.aborted) op.setError("Не удалось загрузить приглашения.");
      });
    return () => c.abort();
  }, [refresh]);
  function create() {
    const id = crypto.randomUUID();
    void op.run(async (signal) => {
      try {
        await proof(signal);
        if (!rememberInvite(id)) return;
        setPending(id);
        const result = await request(
          "/api/v1/owner/registration/invites",
          signal,
          "POST",
          {
            email: draft.fields.invite_email?.trim() || null,
            ttl_seconds: Number(draft.fields.invite_ttl || 604800),
          },
          { "Idempotency-Key": id },
        );
        if (
          !object(result) ||
          result.id !== id ||
          typeof result.token !== "string" ||
          !/^qbt_ri_[A-Za-z0-9_-]{43}$/.test(result.token)
        )
          throw new AuthFault("invalid_response");
        if (!signal.aborted) {
          setSecret({ id, token: result.token });
          setPending(null);
          rememberInvite("");
          setRefresh((n) => n + 1);
        }
      } catch (e) {
        if (
          e instanceof AuthFault &&
          e.status > 0 &&
          e.status < 500 &&
          e.code !== "invite_already_issued"
        ) {
          setPending(null);
          rememberInvite("");
        }
        throw e;
      } finally {
        setPassword("");
      }
    });
  }
  function revoke(id: string) {
    void op.run(async (signal) => {
      try {
        await proof(signal);
        if (
          (await request(
            "/api/v1/owner/registration/invites/" + id,
            signal,
            "DELETE",
          )) !== null
        )
          throw new AuthFault("invalid_response");
        if (!signal.aborted) {
          setRefresh((n) => n + 1);
          setPending(null);
          rememberInvite("");
          if (secret?.id === id) setSecret(null);
          setNotice("Приглашение отозвано.");
        }
      } finally {
        setPassword("");
      }
    });
  }
  const mode = String(
    draft.edits.find((e) => e.change.kind === "registration")?.change.mode ??
      data?.registration.mode ??
      "invite",
  );
  return (
    <>
      <section className="plain-card">
        <h2>Регистрация</h2>
        <LivingTabs
          label="Режим регистрации"
          items={[
            { id: "disabled", label: "Выключена" },
            { id: "invite", label: "По приглашению" },
            { id: "public", label: "Открыта" },
          ]}
          value={mode}
          onChange={(v) =>
            edit(
              { kind: "registration", mode: v },
              "Режим регистрации",
              data?.registration.mode || "",
            )
          }
        />
        <p className="small">
          Новые аккаунты получают только профиль и настройки. Модули и AI
          выдаются вручную. Режим регистрации не выключает вход существующих
          пользователей.
        </p>
      </section>
      <section className="plain-card">
        <h2>Приглашения</h2>
        <p>
          Одно приглашение подходит и для ссылки, и для ручного ввода. Создание
          — отдельное явное действие.
        </p>
        <label className="auth-field">
          Email приглашённого, необязательно
          <input
            type="email"
            value={draft.fields.invite_email || ""}
            maxLength={254}
            onChange={(e) => field("invite_email", e.target.value)}
          />
        </label>
        <label className="auth-field">
          Срок приглашения
          <select
            value={draft.fields.invite_ttl || "604800"}
            onChange={(e) => field("invite_ttl", e.target.value)}
          >
            <option value="3600">Час</option>
            <option value="86400">День</option>
            <option value="604800">Неделя</option>
          </select>
        </label>
        <label className="auth-field">
          Пароль для создания или отзыва приглашения
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            maxLength={256}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <LivingButton
          className="button orange"
          disabled={op.busy || !!pending}
          onClick={create}
        >
          Создать приглашение
        </LivingButton>
        {pending && (
          <div className="auth-alert" role="alert">
            <p>
              Выпуск приглашения мог завершиться. Не создавай повторное вслепую;
              проверь список или отзови исходный номер.
            </p>
            <LivingButton
              className="button"
              disabled={op.busy}
              onClick={() => revoke(pending)}
            >
              Отозвать незавершённое приглашение
            </LivingButton>
          </div>
        )}
        {secret && (
          <div className="owner-invite-secret">
            <h3>Показываем один раз</h3>
            <label className="auth-field">
              Приглашение для ручного ввода
              <textarea
                aria-label="Приглашение для ручного ввода"
                readOnly
                value={secret.token}
              />
            </label>
            <label className="auth-field">
              Ссылка приглашения
              <textarea
                aria-label="Ссылка приглашения"
                readOnly
                value={`${location.origin}/#/auth/register?invite=${secret.token}`}
              />
            </label>
            <p className="small">
              Токен не сохраняется в черновике и исчезнет после ухода с этого
              экрана.
            </p>
          </div>
        )}
        <div className="owner-invites">
          {invites.map((i) => (
            <div className="owner-invite" key={String(i.id)}>
              <div>
                <strong>{String(i.email || "Для любого email")}</strong>
                <small>
                  {i.revoked_at
                    ? "Отозвано"
                    : i.redeemed_at
                      ? "Использовано"
                      : Date.parse(String(i.expires_at)) < Date.now()
                        ? "Истекло"
                        : "Действует до " +
                          new Date(String(i.expires_at)).toLocaleString(
                            "ru-RU",
                          )}
                </small>
              </div>
              <LivingButton
                className="button small-button"
                disabled={op.busy || !!i.revoked_at || !!i.redeemed_at}
                onClick={() => revoke(String(i.id))}
              >
                Отозвать приглашение
              </LivingButton>
            </div>
          ))}
        </div>
        {op.error && <p role="alert">{op.error}</p>}
        {notice && <p role="status">{notice}</p>}
      </section>
    </>
  );
}
function Audit({ revision }: { revision: string }) {
  const [events, setEvents] = useState<ReturnType<typeof parseAudit> | null>(
      null,
    ),
    [cursor, setCursor] = useState<string | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    setEvents(null);
    setFailed(false);
    void metadata("/audit", c.signal, { before: cursor })
      .then((v) => {
        const p = parseAudit(v);
        if (!c.signal.aborted) setEvents(p);
      })
      .catch(() => {
        if (!c.signal.aborted) setFailed(true);
      });
    return () => c.abort();
  }, [revision, cursor]);
  return (
    <section className="plain-card">
      <h2>Журнал действий</h2>
      <p className="small">
        Кто, когда и какие настройки изменил. Пароли, ключи и тексты AI-запросов
        не записываются.
      </p>
      {events ? (
        events.items.map((e) => (
          <details className="owner-event" key={e.id}>
            <summary>
              <strong>
                {e.source === "console"
                  ? "Настройки Console"
                  : e.source === "policy"
                    ? "Разрешения"
                    : e.source === "budget"
                      ? "Бюджет"
                      : "Регистрация"}
              </strong>
              <span>
                {new Date(e.created_at).toLocaleString("ru-RU")} ·{" "}
                {e.changes.length} изменений
              </span>
            </summary>
            <p>Автор: {e.actor_id || "Регистрация пользователя"}</p>
            <pre>{JSON.stringify(e.changes, null, 2)}</pre>
          </details>
        ))
      ) : (
        <p role="status">
          {failed ? "Журнал временно недоступен." : "Загружаем журнал…"}
        </p>
      )}
      {events?.next && (
        <LivingButton className="button" onClick={() => setCursor(events.next)}>
          Раньше
        </LivingButton>
      )}
      {cursor && (
        <LivingButton className="button" onClick={() => setCursor(null)}>
          Последние действия
        </LivingButton>
      )}
    </section>
  );
}
