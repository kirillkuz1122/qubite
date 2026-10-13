import { useEffect, useState } from "react";
import { LivingButton, LivingLink } from "../material/Controls";
import { Icon } from "../ui";
import {
  AuthFault,
  authorization,
  parseProviders,
  parseSessions,
  providerNames,
  request,
  providers,
  type DeviceSession,
  type Provider,
} from "./api";
import { useOperation } from "./operation";
export function Security({
  demo,
  onIdentityChange,
}: {
  demo: boolean;
  onIdentityChange: () => void;
}) {
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null),
    [available, setAvailable] = useState<
      { provider: Provider; available: boolean }[]
    >([]),
    [linked, setLinked] = useState<Provider[]>([]),
    [password, setPassword] = useState(""),
    [revision, setRevision] = useState(0);
  const [confirmAll, setConfirmAll] = useState(false);
  const op = useOperation();
  useEffect(() => {
    if (demo) return;
    const c = new AbortController(),
      timer = setTimeout(() => c.abort(), 8000);
    void request("/api/v1/auth/sessions", c.signal)
      .then((v) => {
        if (!c.signal.aborted) setSessions(parseSessions(v));
      })
      .catch(() => {});
    void request("/api/v1/auth/oauth/providers", c.signal)
      .then((v) => {
        if (!c.signal.aborted) setAvailable(parseProviders(v));
      })
      .catch(() => {});
    void request("/api/v1/me/oauth", c.signal)
      .then((v) => {
        const data = v as {
          items?: { provider: Provider; linked_at: string }[];
        };
        if (
          !data ||
          Object.keys(data).join() !== "items" ||
          !Array.isArray(data.items) ||
          data.items.length > 4 ||
          data.items.some(
            (p) =>
              Object.keys(p).sort().join() !== "linked_at,provider" ||
              !providers.includes(p.provider) ||
              !Number.isFinite(Date.parse(p.linked_at)),
          )
        )
          throw new AuthFault("invalid_response");
        if (!c.signal.aborted) setLinked(data.items.map((p) => p.provider));
      })
      .catch(() => {});
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [demo, revision]);
  function leave(all = false) {
    void op.run(async (signal) => {
      if (
        all &&
        (await request("/api/v1/auth/reauth", signal, "POST", { password })) !==
          null
      )
        throw new AuthFault("invalid_response");
      if (
        (await request(
          `/api/v1/auth/${all ? "logout-all" : "logout"}`,
          signal,
          "POST",
        )) !== null
      )
        throw new AuthFault("invalid_response");
      if (!signal.aborted) {
        setPassword("");
        location.hash = "/auth/login";
        onIdentityChange();
      }
    });
  }
  function revoke(session: DeviceSession) {
    void op.run(async (signal) => {
      if (
        (await request(
          `/api/v1/auth/sessions/${session.id}`,
          signal,
          "DELETE",
        )) !== null
      )
        throw new AuthFault("invalid_response");
      if (signal.aborted) return;
      if (session.current) {
        location.hash = "/auth/login";
        onIdentityChange();
      } else {
        setSessions(null);
        setRevision((v) => v + 1);
      }
    });
  }
  function link(provider: Provider, unlink = false) {
    void op.run(async (signal) => {
      if (!password) throw new AuthFault("invalid_request");
      if (
        (await request("/api/v1/auth/reauth", signal, "POST", { password })) !==
        null
      )
        throw new AuthFault("invalid_response");
      if (unlink) {
        if (
          (await request(`/api/v1/me/oauth/${provider}`, signal, "DELETE", {
            password,
          })) !== null
        )
          throw new AuthFault("invalid_response");
        if (!signal.aborted) {
          setPassword("");
          location.hash = "/auth/login";
          onIdentityChange();
        }
      } else {
        const v = await request(
          `/api/v1/auth/oauth/${provider}/start`,
          signal,
          "POST",
          { intent: "link", password },
        );
        const target = authorization(v, provider);
        if (!signal.aborted) {
          setPassword("");
          location.assign(target);
        }
      }
    });
  }
  return (
    <section
      className="plain-card security-panel"
      aria-label="Безопасность аккаунта"
    >
      <span className="eyebrow">ТВОЙ АККАУНТ</span>
      <h2>Безопасность и вход</h2>
      {demo ? (
        <>
          <p className="muted">
            Просмотр интерфейса. Настоящих сессий и привязок здесь нет.
          </p>
          <LivingLink className="button orange" href="#/auth/login">
            Посмотреть Qubite Auth <Icon name="arrow" />
          </LivingLink>
          <LivingLink className="text-link" href="#/welcome">
            Посмотреть лендинг
          </LivingLink>
        </>
      ) : (
        <>
          <div className="security-actions">
            <LivingButton
              className="button orange"
              disabled={op.busy}
              onClick={() => leave()}
            >
              Выйти
            </LivingButton>
            <LivingButton
              className="button blue"
              disabled={op.busy}
              onClick={() => setConfirmAll(true)}
            >
              Выйти на всех устройствах
            </LivingButton>
          </div>
          {confirmAll && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                leave(true);
              }}
              className="security-linking"
              aria-label="Завершение всех сессий"
            >
              <label className="auth-field">
                Пароль для завершения всех сессий
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={op.busy}
                />
              </label>
              <div className="security-actions">
                <LivingButton
                  type="submit"
                  className="button orange"
                  disabled={op.busy}
                >
                  Подтвердить выход на всех устройствах
                </LivingButton>
                <LivingButton
                  className="button"
                  disabled={op.busy}
                  onClick={() => {
                    setConfirmAll(false);
                    setPassword("");
                  }}
                >
                  Отмена
                </LivingButton>
              </div>
            </form>
          )}
          <h3 className="security-linking">Активные сессии</h3>
          {sessions === null ? (
            <p className="muted">Список пока не загружен.</p>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="device-session">
                <div>
                  <strong>
                    {s.current ? "Этот браузер" : "Другая сессия"}
                  </strong>
                  <small>
                    Последняя активность:{" "}
                    {new Date(s.last_seen_at).toLocaleString("ru-RU")}
                  </small>
                </div>
                <LivingButton
                  className="button"
                  disabled={op.busy}
                  onClick={() => revoke(s)}
                >
                  Завершить {s.current ? "эту" : "другую"} сессию
                </LivingButton>
              </div>
            ))
          )}
          <div className="security-linking">
            <h3>Способы входа</h3>
            <p className="muted">
              Чтобы привязать или отключить сервис, подтверди действие своим
              паролем Qubite. После отключения потребуется войти снова.
            </p>
            <label className="auth-field">
              Пароль Qubite для привязки
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={op.busy}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <div className="security-actions">
              {available.map((p) => (
                <LivingButton
                  key={p.provider}
                  className="button"
                  disabled={
                    op.busy || (!linked.includes(p.provider) && !p.available)
                  }
                  onClick={() => link(p.provider, linked.includes(p.provider))}
                >
                  {linked.includes(p.provider) ? "Отключить" : "Привязать"}{" "}
                  {providerNames[p.provider]}
                </LivingButton>
              ))}
            </div>
          </div>
          {op.error && (
            <p className="auth-error" role="alert">
              {op.error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
