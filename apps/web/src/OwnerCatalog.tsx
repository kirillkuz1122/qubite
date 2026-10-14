import { useEffect, useRef, useState } from "react";
import {
  parseCatalog,
  statusText,
  type Catalog,
  type OwnerCard,
} from "./catalog-api";
import { request, AuthFault } from "./auth/api";
import { useOperation } from "./auth/operation";
import { LivingTabs, LivingButton } from "./material/Controls";
import { Mark } from "./material/Marks";
import { Empty } from "./ui";
import {
  modules as demoModules,
  type Visibility,
  type VisibilityMap,
} from "./catalog";
export function OwnerCatalog({
  onSaved,
  demo = false,
  visibility,
  onDemoSave,
}: {
  onSaved: () => void;
  demo?: boolean;
  visibility?: VisibilityMap;
  onDemoSave?: (v: VisibilityMap) => void;
}) {
  const [data, setData] = useState<Catalog<OwnerCard> | null>(null),
    [failed, setFailed] = useState(false),
    [revision, setRevision] = useState(0),
    [password, setPassword] = useState(""),
    [draft, setDraft] = useState<Record<string, Visibility>>({});
  const op = useOperation(),
    latest = useRef(0);
  useEffect(() => {
    if (demo) {
      setData({
        revision: 1,
        items: demoModules.map((m) => ({
          ...m,
          visibility: visibility?.[m.id] || "locked",
          status: m.id === "planner" ? "unavailable" : "preparing",
          access_expires_at: null,
          installed: m.id === "planner",
          enabled: false,
          released: false,
        })),
      });
      setDraft({});
      return;
    }
    const n = ++latest.current,
      c = new AbortController(),
      timer = setTimeout(() => c.abort(), 8000);
    setData(null);
    setFailed(false);
    setDraft({});
    void request("/api/v1/owner/modules", c.signal)
      .then((v) => {
        const parsed = parseCatalog(v, true) as Catalog<OwnerCard>;
        if (n === latest.current && !c.signal.aborted) setData(parsed);
      })
      .catch(() => {
        if (n === latest.current) setFailed(true);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      ++latest.current;
      c.abort();
      clearTimeout(timer);
    };
  }, [revision, demo, visibility]);
  function save(m: OwnerCard) {
    if (demo) {
      if (onDemoSave && visibility && draft[m.id]) {
        onDemoSave({ ...visibility, [m.id]: draft[m.id] });
      }
      return;
    }
    if (!data || !password) {
      op.setError("Введи свой пароль для подтверждения изменения.");
      return;
    }
    const expected = data.revision,
      key = crypto.randomUUID(),
      choice = draft[m.id] || m.visibility;
    void op.run(async (signal) => {
      try {
        if (
          (await request("/api/v1/auth/reauth", signal, "POST", {
            password,
          })) !== null
        )
          throw new AuthFault("invalid_response");
        const v = await request(
          "/api/v1/owner/policy/commands",
          signal,
          "POST",
          {
            kind: "catalog_visibility",
            module: m.id,
            visibility: choice,
            reason: "configure",
          },
          { "If-Match": `"policy-${expected}"`, "Idempotency-Key": key },
        );
        if (
          !v ||
          typeof v !== "object" ||
          Object.keys(v).join() !== "revision" ||
          !Number.isSafeInteger((v as { revision: number }).revision) ||
          (v as { revision: number }).revision !== expected + 1
        )
          throw new AuthFault("invalid_response");
        if (!signal.aborted) {
          setRevision((n) => n + 1);
          onSaved();
        }
      } finally {
        setPassword("");
      }
    });
  }
  if (!data)
    return (
      <>
        <Empty
          icon="settings"
          title={
            failed
              ? "Не удалось загрузить настройки каталога"
              : "Загружаем настройки каталога"
          }
          text="Проверь подключение и попробуй снова."
        />
        {failed && (
          <LivingButton
            className="button blue"
            onClick={() => setRevision((n) => n + 1)}
          >
            Обновить настройки
          </LivingButton>
        )}
      </>
    );
  return (
    <section
      className="plain-card visibility-card"
      aria-label="Настройки видимости модулей"
    >
      <div className="visibility-heading">
        <h2>Видимость модулей</h2>
        <span className="status-chip">Без доступа</span>
      </div>
      <p className="small">
        Общая настройка для всех пользователей без права просмотра. По умолчанию
        — замок. Она не выдаёт права и не устанавливает модуль.
      </p>
      {data.items.map((m) => (
        <div className="visibility-row server-visibility-row" key={m.id}>
          <span className={`note-icon ${m.tone}`}>
            <Mark service={m.id} />
          </span>
          <div className="visibility-label">
            <strong>{m.name}</strong>
            <small>
              {draft[m.id] && draft[m.id] !== m.visibility
                ? "Не сохранено"
                : statusText(m.status)}
            </small>
          </div>
          <LivingTabs
            label={`${m.name}: без доступа`}
            items={[
              { id: "hidden", label: "Скрывать" },
              { id: "locked", label: "С замком" },
            ]}
            value={draft[m.id] || m.visibility}
            onChange={(v) => {
              if (!op.busy)
                setDraft((d) => ({ ...d, [m.id]: v as Visibility }));
            }}
          />
          <LivingButton
            className="button small-button blue"
            disabled={op.busy || !draft[m.id] || draft[m.id] === m.visibility}
            onClick={() => save(m)}
            aria-label={`Сохранить: ${m.name}`}
          >
            Сохранить
          </LivingButton>
        </div>
      ))}
      {!demo && (
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
        </label>
      )}
      {op.busy && <p role="status">Сохраняем настройку…</p>}
      {op.error && (
        <div role="alert" className="auth-alert">
          <p>{op.error}</p>
          <p>
            Если ответ потерялся, обнови настройки и проверь результат перед
            повторной отправкой.
          </p>
          <LivingButton
            className="button blue"
            disabled={op.busy}
            onClick={() => {
              setRevision((n) => n + 1);
              onSaved();
            }}
          >
            Обновить настройки
          </LivingButton>
        </div>
      )}
    </section>
  );
}
