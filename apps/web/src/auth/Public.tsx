import { useEffect, useRef, useState } from "react";
import { useAppearance } from "../appearance";
import { MotionContext } from "../material/motion";
import {
  LivingButton,
  LivingLink,
  LivingSwitch,
  LivingTabs,
} from "../material/Controls";
import { MorphContent } from "../material/Transition";
import { Mark } from "../material/Marks";
import { Brand, Icon } from "../ui";
import { LegalPage, LegalLinks, legalVersion } from "../legal/Legal";
import {
  accepted,
  authorization,
  AuthFault,
  errorMessage,
  loginResult,
  parseProviders,
  parseRegistration,
  providerNames,
  providers,
  request,
  token,
  uuid,
  type Provider,
  type Registration,
} from "./api";
import { parseInvite, type AuthEntry } from "./routes";
import { useOperation } from "./operation";
import "./auth.css";

type Mode =
  | "login"
  | "register"
  | "reset"
  | "verify"
  | "verify-request"
  | "reset-confirm";
const headings: Record<Mode, string> = {
  login: "С возвращением.",
  register: "Начнём с тебя.",
  reset: "Вспомним пароль.",
  verify: "Подтверди почту.",
  "verify-request": "Ещё одно письмо.",
  "reset-confirm": "Новый пароль.",
};
const intro: Record<Mode, string> = {
  login: "Твоё пространство уже ждёт. Войди в аккаунт Qubite.",
  register: "Только email и пароль. Остальное — когда понадобится.",
  reset: "Укажи email аккаунта. Запросим ссылку для восстановления.",
  verify:
    "Подтверждение почты открывает аккаунт. Доступ к модулям владелец выдаёт отдельно.",
  "verify-request": "Запроси новую ссылку для подтверждения своего email.",
  "reset-confirm": "Придумай новый пароль. Все прежние сессии будут завершены.",
};
export function Public({
  route,
  entry,
  status,
  onAuthenticated,
  refresh,
  demo = false,
}: {
  route: string;
  entry: AuthEntry;
  status?: string;
  onAuthenticated: () => void;
  refresh?: () => void;
  demo?: boolean;
}) {
  const { prefs, setPrefs, stopped, motion } = useAppearance();
  const heading = useRef<HTMLHeadingElement>(null);
  const legal = route.startsWith("/legal/");
  const isAuth = route.startsWith("/auth/");
  const mode = route.slice(6) as Mode;
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    document.title = isAuth
      ? "Qubite Auth — твой аккаунт"
      : legal
        ? "Qubite — документы"
        : "Qubite — твоё пространство";
  }, [route, isAuth, legal]);
  return (
    <MotionContext.Provider value={motion}>
      <div
        className="public-shell qubite-material"
        data-theme={prefs.dark ? "dark" : "light"}
        data-quiet={stopped}
        data-material="flux"
        data-lite={prefs.lite}
        style={
          {
            "--selection-ms": `${prefs.duration}ms`,
            "--strength": prefs.strength / 100,
          } as React.CSSProperties
        }
      >
        <LivingLink
          className="skip-link"
          href="#content"
          onClick={(e) => {
            e.preventDefault();
            heading.current?.focus();
          }}
        >
          К содержимому
        </LivingLink>
        <header className="public-header">
          <LivingLink
            className="brand"
            href={demo ? "#/welcome" : "#/"}
            aria-label="Qubite — главная"
          >
            <Brand />
            <span>Qubite{isAuth && <small> Auth</small>}</span>
          </LivingLink>
          <div className="public-header-actions">
            <LivingButton
              className="icon-button"
              aria-label={prefs.dark ? "Светлая тема" : "Тёмная тема"}
              onClick={() => setPrefs({ ...prefs, dark: !prefs.dark })}
            >
              <Icon name="sun" />
            </LivingButton>
            <LivingButton
              className="icon-button"
              aria-label={
                prefs.quiet ? "Включить движение" : "Спокойное движение"
              }
              aria-pressed={prefs.quiet}
              onClick={() => setPrefs({ ...prefs, quiet: !prefs.quiet })}
            >
              <Icon name="orbit" />
            </LivingButton>
            {!isAuth && (
              <LivingLink className="button orange" href="#/auth/login">
                Войти <Icon name="arrow" />
              </LivingLink>
            )}
          </div>
        </header>
        {demo && (
          <div className="public-preview">
            Просмотр дизайна · данные не отправляются
            <LivingLink href="#/">
              К примеру приложения <Icon name="arrow" size={16} />
            </LivingLink>
          </div>
        )}
        <main
          className={legal ? "public-main legal-main" : "public-main"}
          id="content"
        >
          {legal ? (
            <LegalPage id={route.slice(7)} heading={heading} />
          ) : isAuth ? (
            <section className="auth-layout">
              <aside className="auth-story" aria-hidden="true">
                <span className="eyebrow">ОДНО ПРОСТРАНСТВО. ТВОЁ.</span>
                <div className="auth-plastic">
                  <div className="plastic-shape shape-blue">
                    <Mark />
                  </div>
                  <div className="plastic-shape shape-yellow">
                    <Icon name="document" size={60} />
                  </div>
                  <div className="plastic-shape shape-orange">
                    <Icon name="spark" size={64} />
                  </div>
                  <div className="plastic-shape shape-green">
                    <Icon name="layers" size={52} />
                  </div>
                </div>
                <h2>
                  Меньше шума.
                  <br />
                  Больше тебя.
                </h2>
                <p>
                  Мысли, планы и проекты.
                  <br />В своём ритме.
                </p>
              </aside>
              <div className="auth-card">
                <span className="eyebrow">QUBITE AUTH</span>
                {!["verify", "reset-confirm"].includes(mode) && (
                  <LivingTabs
                    label="Вход или регистрация"
                    value={mode === "register" ? "register" : "login"}
                    items={[
                      { id: "login", label: "Вход" },
                      { id: "register", label: "Регистрация" },
                    ]}
                    onChange={(v) => {
                      location.hash = "/auth/" + v;
                    }}
                  />
                )}
                <MorphContent identity={route} privateContent>
                  <div key={route}>
                    <h1 ref={heading} tabIndex={-1}>
                      {headings[mode] || "Завершаем вход."}
                    </h1>
                    <p className="auth-intro">
                      {intro[mode] ||
                        "Проверяем аккаунт и разрешения у Qubite."}
                    </p>
                    {mode in headings ? (
                      <AuthForm
                        key={entry.sequence || route}
                        mode={mode}
                        entry={entry.route === route ? entry : { route }}
                        demo={demo}
                        onAuthenticated={onAuthenticated}
                        onProofComplete={refresh}
                      />
                    ) : (
                      <>
                        <p className="auth-feedback" role="status">
                          {status === "loading"
                            ? "Проверяем сессию…"
                            : "Войди по email, если вход через сервис не завершился."}
                        </p>
                        <LivingLink
                          className="button orange"
                          href="#/auth/login"
                        >
                          Ко входу <Icon name="arrow" />
                        </LivingLink>
                      </>
                    )}
                  </div>
                </MorphContent>
                <div className="auth-cookie-note">
                  <Icon name="shield" size={18} />
                  <p>
                    Для входа используются технические cookies. Рекламных и
                    аналитических cookies в этом интерфейсе нет.{" "}
                    <LivingLink href="#/legal/cookies">Подробнее</LivingLink>
                  </p>
                </div>
              </div>
            </section>
          ) : (
            <>
              <section className="landing-hero">
                <div>
                  <span className="eyebrow">QUBITE · В СВОЁМ РИТМЕ</span>
                  <h1 ref={heading} tabIndex={-1}>
                    Твоя жизнь.
                    <br />
                    <span>Связно.</span>
                  </h1>
                  <p>
                    Мысли, дела и проекты — в одном пространстве. Собери свой
                    Qubite. Оставь место для нового.
                  </p>
                  <LivingLink
                    className="button orange landing-cta"
                    href="#/auth/login"
                  >
                    Войти в Qubite <Icon name="arrow" />
                  </LivingLink>
                  <LivingLink className="text-link" href="#/auth/register">
                    Ещё нет аккаунта? Начнём.
                  </LivingLink>
                </div>
                <div className="landing-art" aria-hidden="true">
                  <div className="landing-q blue">
                    <Mark />
                  </div>
                  <div className="landing-tile yellow">
                    <Icon name="document" size={46} />
                    <span>Мысль</span>
                  </div>
                  <div className="landing-tile green">
                    <Icon name="layers" size={46} />
                    <span>Проект</span>
                  </div>
                  <div className="landing-tile orange">
                    <Icon name="calendar" size={46} />
                    <span>План</span>
                  </div>
                  <span className="landing-orbit" />
                </div>
              </section>
              <section
                className="landing-principles"
                aria-label="Как устроен Qubite"
              >
                {[
                  {
                    color: "yellow",
                    icon: "inbox",
                    title: "Сначала — мысль",
                    text: "Текст, идея, план. Место, где можно начать с малого.",
                  },
                  {
                    color: "blue",
                    icon: "grid",
                    title: "Только нужное",
                    text: "Отдельные модули и отдельные разрешения. Пространство растёт вместе с тобой.",
                  },
                  {
                    color: "green",
                    icon: "shield",
                    title: "Твой аккаунт",
                    text: "Один вход. Управление сессиями. Доступ к модулям — по приглашению владельца.",
                  },
                ].map((x) => (
                  <article key={x.title}>
                    <span className={`note-icon ${x.color}`}>
                      <Icon name={x.icon} />
                    </span>
                    <h2>{x.title}</h2>
                    <p>{x.text}</p>
                  </article>
                ))}
              </section>
              {status === "unavailable" && (
                <section className="landing-connection" role="status">
                  <h2>Не удалось открыть пространство</h2>
                  <p>Подключение к аккаунту сейчас недоступно.</p>
                  <LivingButton className="button blue" onClick={refresh}>
                    Проверить снова
                  </LivingButton>
                </section>
              )}
            </>
          )}
        </main>
        <footer className="public-footer">
          <span>Qubite · место для твоего</span>
          <LegalLinks />
        </footer>
      </div>
    </MotionContext.Provider>
  );
}
function AuthForm({
  mode,
  entry,
  demo,
  onAuthenticated,
  onProofComplete,
}: {
  mode: Mode;
  entry: AuthEntry;
  demo: boolean;
  onAuthenticated: () => void;
  onProofComplete?: () => void;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [shown, setShown] = useState(false),
    [invite, setInvite] = useState(entry.invite || ""),
    [proofId, setProofId] = useState(entry.proof?.challenge_id || ""),
    [proofToken, setProofToken] = useState(entry.proof?.token || "");
  const [linkedProof, setLinkedProof] = useState(!!entry.proof);
  useEffect(() => {
    delete entry.invite;
    delete entry.proof;
  }, [entry]);
  const [terms, setTerms] = useState(false),
    [dataConsent, setDataConsent] = useState(false),
    [done, setDone] = useState("");
  const [registration, setRegistration] = useState<Registration | null>(
    demo
      ? { mode: "invite", revision: 1, consent_version: legalVersion }
      : null,
  );
  const [available, setAvailable] = useState<
    { provider: Provider; available: boolean }[]
  >(providers.map((provider) => ({ provider, available: false })));
  const [configError, setConfigError] = useState(false);
  const op = useOperation();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 8000);
    if (mode === "register")
      void request("/api/v1/auth/registration", controller.signal)
        .then((v) => {
          if (!controller.signal.aborted) setRegistration(parseRegistration(v));
        })
        .catch(() => {
          if (!controller.signal.aborted) setConfigError(true);
        });
    if (mode === "login")
      void request("/api/v1/auth/oauth/providers", controller.signal)
        .then((v) => {
          if (!controller.signal.aborted) setAvailable(parseProviders(v));
        })
        .catch(() => {});
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [demo, mode]);
  useEffect(() => {
    if (entry.error) op.setError(errorMessage(new AuthFault(entry.error)));
  }, [entry.error, op.setError]);
  const isProof = mode === "verify" || mode === "reset-confirm";
  const hasPassword = ["login", "register", "reset-confirm"].includes(mode);
  const clearSecrets = () => {
    setPassword("");
    setInvite("");
    setProofId("");
    setProofToken("");
    setShown(false);
    setLinkedProof(false);
  };
  const closed = mode === "register" && registration?.mode === "disabled";
  const consentMismatch =
    mode === "register" &&
    registration &&
    registration.consent_version !== legalVersion;
  async function submit() {
    op.setError("");
    if (
      hasPassword &&
      (Array.from(password).length < 12 ||
        Array.from(password).length > 256 ||
        new TextEncoder().encode(password).length > 1024)
    ) {
      op.setError("Пароль должен содержать от 12 до 256 символов.");
      return;
    }
    const parsedInvite = invite ? parseInvite(invite) : null;
    if (mode === "register" && (!terms || !dataConsent)) {
      op.setError(
        "Ознакомься с условиями и отдельно подтверди согласие на обработку данных.",
      );
      return;
    }
    if (
      mode === "register" &&
      ((invite && !parsedInvite) ||
        (registration?.mode === "invite" && !parsedInvite))
    ) {
      op.setError(
        "Вставь действительное приглашение или ссылку от владельца Qubite.",
      );
      return;
    }
    if (
      isProof &&
      (!uuid.test(proofId) ||
        !token(proofToken, mode === "verify" ? "qbt_ev_" : "qbt_er_"))
    ) {
      op.setError("Вставь данные подтверждения из письма.");
      return;
    }
    if (demo) {
      clearSecrets();
      op.setError(errorMessage(new AuthFault("preview")));
      return;
    }
    await op.run(async (signal) => {
      if (mode === "login") {
        const result = await request("/api/v1/auth/session", signal, "POST", {
          email,
          password,
        });
        loginResult(result);
        if (signal.aborted) return;
        clearSecrets();
        onAuthenticated();
        return;
      }
      if (mode === "register") {
        if (!registration || registration.consent_version !== legalVersion)
          throw new AuthFault("consent_changed");
        accepted(
          await request("/api/v1/auth/register", signal, "POST", {
            email,
            password,
            consent_version: registration.consent_version,
            consent_accepted: terms && dataConsent,
            ...(parsedInvite ? { invite_token: parsedInvite } : {}),
          }),
          "registration_accepted",
        );
        if (signal.aborted) return;
        clearSecrets();
        setDone(
          "Запрос принят. Если аккаунт может быть создан, на указанный email придёт ссылка. Подтверди почту, затем войди. Если письмо не приходит, запроси новое.",
        );
        return;
      }
      if (isProof) {
        const value = await request(
          `/api/v1/auth/email/${mode === "verify" ? "verify" : "reset"}/confirm`,
          signal,
          "POST",
          {
            challenge_id: proofId,
            token: proofToken,
            ...(mode === "reset-confirm" ? { password } : {}),
          },
        );
        if (value !== null) throw new AuthFault("invalid_response");
        if (signal.aborted) return;
        clearSecrets();
        onProofComplete?.();
        setDone(
          mode === "verify"
            ? "Почта подтверждена. Теперь можно войти."
            : "Пароль изменён. Прежние сессии завершены. Войди с новым паролем.",
        );
        return;
      }
      accepted(
        await request(
          `/api/v1/auth/email/${mode === "reset" ? "reset" : "verify"}/request`,
          signal,
          "POST",
          { email },
        ),
        "request_accepted",
      );
      if (!signal.aborted)
        setDone(
          "Запрос принят. Если адрес подходит для этого действия, на него придёт письмо. Доставка может занять время.",
        );
    });
  }
  function oauth(provider: Provider) {
    void op.run(async (signal) => {
      const v = await request(
        `/api/v1/auth/oauth/${provider}/start`,
        signal,
        "POST",
        { intent: "login" },
      );
      const target = authorization(v, provider);
      if (!signal.aborted) {
        clearSecrets();
        location.assign(target);
      }
    });
  }
  return (
    <>
      {done ? (
        <div className="auth-success">
          <span className="note-icon green">
            <Icon name="check" />
          </span>
          <p role="status">{done}</p>
          <LivingLink className="button orange" href="#/auth/login">
            Ко входу <Icon name="arrow" />
          </LivingLink>
          {mode === "register" && (
            <LivingLink className="text-link" href="#/auth/verify-request">
              Запросить письмо снова
            </LivingLink>
          )}
        </div>
      ) : (
        <form
          ref={form}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          aria-label={headings[mode]}
          aria-busy={op.busy}
        >
          {closed ? (
            <p role="status" className="auth-feedback">
              Создание аккаунтов сейчас выключено. В существующий аккаунт можно
              войти.
            </p>
          ) : (
            <>
              {!isProof && (
                <label className="auth-field">
                  Email
                  <input
                    type="email"
                    autoComplete="username"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    maxLength={320}
                    value={email}
                    disabled={op.busy}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              )}
              {isProof && !linkedProof && (
                <>
                  <label className="auth-field">
                    Номер подтверждения из письма
                    <input
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={proofId}
                      onChange={(e) => setProofId(e.target.value.trim())}
                      required
                      disabled={op.busy}
                    />
                  </label>
                  <label className="auth-field">
                    Токен подтверждения из письма
                    <input
                      type="password"
                      autoComplete="off"
                      value={proofToken}
                      onChange={(e) => setProofToken(e.target.value.trim())}
                      required
                      disabled={op.busy}
                    />
                  </label>
                </>
              )}
              {isProof && linkedProof && (
                <div className="auth-proof-note">
                  <Icon name="shield" />
                  <span>
                    Ссылка распознана. Подтверди действие кнопкой ниже.
                  </span>
                </div>
              )}
              {hasPassword && (
                <label className="auth-field">
                  {mode === "reset-confirm" ? "Новый пароль" : "Пароль"}
                  <span className="auth-password">
                    <input
                      aria-label={
                        mode === "reset-confirm" ? "Новый пароль" : "Пароль"
                      }
                      type={shown ? "text" : "password"}
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      required
                      value={password}
                      disabled={op.busy}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <LivingButton
                      className="password-toggle"
                      aria-label={shown ? "Скрыть пароль" : "Показать пароль"}
                      aria-pressed={shown}
                      onClick={() => setShown(!shown)}
                      disabled={op.busy}
                    >
                      {shown ? "Скрыть" : "Показать"}
                    </LivingButton>
                  </span>
                  {mode !== "login" && (
                    <small>От 12 символов. Пробелы тоже считаются.</small>
                  )}
                </label>
              )}
              {mode === "register" && (
                <>
                  <label className="auth-field">
                    Приглашение
                    {registration?.mode === "public" && " (необязательно)"}
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={invite}
                      onChange={(e) => setInvite(e.target.value)}
                      disabled={op.busy}
                      aria-label="Приглашение"
                      placeholder="Ссылка или приглашение владельца"
                    />
                    <small>
                      Приглашение нужно для регистрации, а не для входа.
                    </small>
                  </label>
                  <div className="auth-consents">
                    <LivingSwitch
                      disabled={op.busy}
                      label="Я принимаю условия использования"
                      checked={terms}
                      onChange={setTerms}
                    />
                    <LivingLink
                      className="text-link"
                      href="#/legal/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Прочитать условия <Icon name="arrow" size={16} />
                    </LivingLink>
                    <LivingSwitch
                      disabled={op.busy}
                      label="Я даю согласие на обработку данных аккаунта"
                      checked={dataConsent}
                      onChange={setDataConsent}
                    />
                    <LivingLink
                      className="text-link"
                      href="#/legal/consent"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Прочитать отдельное согласие{" "}
                      <Icon name="arrow" size={16} />
                    </LivingLink>
                    <LivingLink
                      className="text-link"
                      href="#/legal/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Политика приватности
                    </LivingLink>
                  </div>
                </>
              )}
              {(configError || consentMismatch) && (
                <p role="alert" className="auth-error">
                  {consentMismatch
                    ? "Версия документов не совпадает с сервером. Обнови страницу перед регистрацией."
                    : "Не удалось загрузить настройки регистрации. Обнови страницу."}
                </p>
              )}
              <LivingButton
                type="submit"
                className="button orange auth-submit"
                disabled={
                  op.busy ||
                  (mode === "register" && (!registration || !!consentMismatch))
                }
              >
                {op.busy
                  ? "Проверяем…"
                  : mode === "login"
                    ? "Войти"
                    : mode === "register"
                      ? "Создать аккаунт"
                      : mode === "verify"
                        ? "Подтвердить почту"
                        : mode === "reset-confirm"
                          ? "Изменить пароль"
                          : "Запросить письмо"}
                <Icon name="arrow" />
              </LivingButton>
            </>
          )}
          {op.error && (
            <p role="alert" className="auth-error">
              {op.error}
            </p>
          )}
        </form>
      )}
      <nav className="auth-links" aria-label="Помощь со входом">
        {mode === "login" && (
          <>
            <LivingLink href="#/auth/reset">Не помню пароль</LivingLink>
            <LivingLink href="#/auth/verify-request">
              Подтвердить почту
            </LivingLink>
          </>
        )}
        {mode !== "login" && (
          <LivingLink href="#/auth/login">Уже есть аккаунт? Войти</LivingLink>
        )}
        {mode === "reset" && (
          <LivingLink href="#/auth/reset-confirm">
            У меня есть письмо
          </LivingLink>
        )}
        {mode === "verify-request" && (
          <LivingLink href="#/auth/verify">У меня есть письмо</LivingLink>
        )}
      </nav>
      {mode === "login" && (
        <section className="auth-providers" aria-label="Другие способы входа">
          <span>Или через свой сервис</span>
          <div>
            {available.map((p) => (
              <LivingButton
                key={p.provider}
                className="provider-button"
                disabled={!p.available || op.busy}
                onClick={() => oauth(p.provider)}
              >
                {providerNames[p.provider]}
                {!p.available && <small>Пока недоступно</small>}
              </LivingButton>
            ))}
          </div>
          <p>Сначала привяжи сервис к своему аккаунту в профиле Qubite.</p>
        </section>
      )}
    </>
  );
}
