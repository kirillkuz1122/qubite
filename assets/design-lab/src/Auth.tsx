import { MorphContent } from "./milo/Transition";
import { LivingButton } from "./milo/Controls";
import { useEffect, useRef, useState } from "react";
import { Material } from "./Materials";
import { Icon } from "./Icons";
import { BrandNav } from "./pages/LandingParts";
import type { PageProps } from "./types";
export function Auth(p: PageProps) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [shown, setShown] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function switchMode(next: typeof mode) {
    if (timer.current) clearTimeout(timer.current);
    setBusy(false);
    setMode(next);
    setError("");
    setComplete(false);
    setShown(false);
    p.react("idle");
  }
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    if (!String(data.get("email") || "").includes("@")) {
      setError("Проверь адрес почты. Например, hello@example.com.");
      p.react("error");
      return;
    }
    if (mode !== "reset" && String(data.get("password") || "").length < 8) {
      setError("В этом макете пароль должен быть не короче 8 символов.");
      p.react("error");
      return;
    }
    if (mode === "register" && !data.get("consent")) {
      setError("Нужно принять условия и политику конфиденциальности.");
      p.react("error");
      return;
    }
    setError("");
    setBusy(true);
    p.react("focus");
    timer.current = setTimeout(() => {
      setBusy(false);
      setComplete(true);
      p.react("success");
    }, 650);
  }
  return (
    <div className="auth-page">
      <BrandNav open={p.open} />
      <div className="auth-layout">
        <aside className="auth-art">
          <span className="eyebrow">{p.concept.russian}</span>
          <Material direction={p.concept.id} mood={p.mood} event={p.event} />
          <h2>{p.concept.tagline}</h2>
          <p>
            Попробуй ввод, ошибку и показ пароля.
            <br />
            Материал рядом замечает каждое действие.
          </p>
        </aside>
        <section className="auth-form-panel">
          <span className="eyebrow">ТВОЁ ЛИЧНОЕ ПРОСТРАНСТВО</span>
          <MorphContent
            identity={`${mode}-${complete}`}
            className="auth-state-morph"
          >
            <h1>
              {mode === "login"
                ? "С возвращением."
                : mode === "register"
                  ? "Начнём с тебя."
                  : "Вернём доступ."}
            </h1>
            <p className="muted">
              {mode === "login"
                ? "Хорошие мысли уже ждут тебя."
                : mode === "register"
                  ? "Почта, пароль — и место для твоих идей."
                  : "Отправим ссылку для восстановления на почту."}
            </p>
            <div className="auth-tabs">
              <LivingButton
                aria-pressed={mode === "login"}
                onClick={() => switchMode("login")}
              >
                Вход
              </LivingButton>
              <LivingButton
                aria-pressed={mode === "register"}
                onClick={() => switchMode("register")}
              >
                Регистрация
              </LivingButton>
            </div>
            {complete ? (
              <div className="auth-complete" role="status">
                <span className="success-icon">
                  <Icon name="check" size={30} />
                </span>
                <h3>
                  {mode === "reset"
                    ? "Так выглядит подтверждение отправки."
                    : "Так выглядит успешное действие."}
                </h3>
                <p>
                  Это дизайн-макет: аккаунт не создан, письмо не отправлено.
                  Используй только выдуманные данные.
                </p>
                <LivingButton
                  className="primary"
                  onClick={() => p.open("workspace")}
                >
                  Посмотреть интерфейс <Icon name="arrow" />
                </LivingButton>
                <LivingButton
                  className="text-action"
                  onClick={() => setComplete(false)}
                >
                  Повторить
                </LivingButton>
              </div>
            ) : (
              <form onSubmit={submit} noValidate>
                <label>
                  Почта
                  <input
                    name="email"
                    type="email"
                    autoComplete="off"
                    placeholder="hello@example.com"
                    onFocus={() => p.react("focus")}
                    onInput={() => {
                      p.react("capture");
                      setError("");
                    }}
                    aria-describedby="auth-demo-note auth-error"
                  />
                </label>
                {mode !== "reset" && (
                  <label>
                    Пароль
                    <div className="password-field">
                      <input
                        name="password"
                        type={shown ? "text" : "password"}
                        autoComplete="off"
                        placeholder="Не меньше 8 символов"
                        onFocus={() => p.react(shown ? "private" : "focus")}
                        onInput={() => p.react(shown ? "private" : "capture")}
                        aria-describedby="auth-demo-note auth-error"
                      />
                      <LivingButton
                        type="button"
                        className="icon-button"
                        aria-label={shown ? "Скрыть пароль" : "Показать пароль"}
                        aria-pressed={shown}
                        onClick={() => {
                          setShown(!shown);
                          p.react(!shown ? "private" : "focus");
                        }}
                      >
                        <Icon name={shown ? "lock" : "eye"} />
                      </LivingButton>
                    </div>
                  </label>
                )}
                {mode === "register" && (
                  <label className="consent">
                    <input name="consent" type="checkbox" />{" "}
                    <span>
                      Принимаю условия использования и политику
                      конфиденциальности демо
                    </span>
                  </label>
                )}
                {mode === "login" && (
                  <LivingButton
                    type="button"
                    className="forgot"
                    onClick={() => switchMode("reset")}
                  >
                    Не помню пароль
                  </LivingButton>
                )}
                <div id="auth-error" className="form-error" role="alert">
                  {error}
                </div>
                <LivingButton className="primary auth-submit" disabled={busy}>
                  {busy ? (
                    <>
                      <span className="spinner" /> Проверяем…
                    </>
                  ) : (
                    <>
                      {mode === "login"
                        ? "Войти"
                        : mode === "register"
                          ? "Создать пространство"
                          : "Получить ссылку"}
                      <Icon name="arrow" />
                    </>
                  )}
                </LivingButton>
                {mode !== "reset" && (
                  <>
                    <div className="auth-separator">
                      <span />
                      или
                      <span />
                    </div>
                    <div className="oauth-options">
                      {["Google", "Яндекс", "Telegram"].map((name) => (
                        <LivingButton
                          type="button"
                          key={name}
                          onClick={() => {
                            setError(
                              `${name}: демонстрация недоступного провайдера. Внешний запрос не выполняется.`,
                            );
                            p.react("error");
                          }}
                        >
                          {name}
                        </LivingButton>
                      ))}
                    </div>
                  </>
                )}
                <p className="demo-note" id="auth-demo-note">
                  <Icon name="lock" size={13} /> Демо. Ввод не отправляется и не
                  сохраняется.
                </p>
              </form>
            )}
          </MorphContent>
        </section>
      </div>
    </div>
  );
}
