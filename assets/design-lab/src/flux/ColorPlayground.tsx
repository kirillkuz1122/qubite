import { useState } from "react";
import {
  LivingButton,
  LivingSlider,
  LivingSwitch,
  LivingTabs,
} from "../milo/Controls";
import { Icon } from "../Icons";
import { plasticPalettes } from "./preferences";
export function ColorPlayground({
  palette,
}: {
  palette: (typeof plasticPalettes)[number];
}) {
  const [view, setView] = useState("ideas"),
    [saved, setSaved] = useState(false),
    [connected, setConnected] = useState(true),
    [progress, setProgress] = useState(35),
    [error, setError] = useState(false);
  const roles = [
    [
      "action",
      "01",
      "Действие",
      "Одна главная кнопка в контексте. Луми: тёплая инициатива.",
    ],
    [
      "select",
      "02",
      "Выбор",
      "Навигация, активный пункт, поиск. Пип: любопытство.",
    ],
    [
      "idea",
      "03",
      "Черновик",
      "Мысль ещё собирается. Цвет не означает ошибку.",
    ],
    [
      "success",
      "04",
      "Готово",
      "Подтверждённый результат, включённый режим. Сэйдж: спокойствие.",
    ],
  ] as const;
  return (
    <section className="plastic-playground" aria-labelledby="plastic-title">
      <div className="choice-title">
        <div>
          <span className="eyebrow">ЦВЕТ УМЕЕТ ОБЪЯСНЯТЬ</span>
          <h2 id="plastic-title">{palette.name} в деле.</h2>
        </div>
        <span>Попробуй элементы</span>
      </div>
      <p className="plastic-hierarchy">
        {palette.hierarchy}. Цвета чередуются по смыслу, а текст и контуры
        держат всё вместе.
      </p>
      <div className="plastic-role-key" aria-label="Иерархия цветов">
        {roles.map(([id, n, title, detail]) => (
          <div key={id} data-color-role={id}>
            <span className="role-number">{n}</span>
            <b>{title}</b>
            <p>{detail}</p>
          </div>
        ))}
      </div>
      <div className="plastic-workbench">
        <div className="plastic-workbench-heading">
          <span className="plastic-stamp">
            <Icon name="spark" />
            Твой маленький мир
          </span>
          <span>Пластик / {palette.name}</span>
        </div>
        <LivingTabs
          label="Цветовой пример"
          value={view}
          onChange={setView}
          items={[
            { id: "ideas", label: "Мысли" },
            { id: "projects", label: "Проекты" },
            { id: "diary", label: "Дневник" },
          ]}
        />
        <div className="plastic-play-cards">
          <article className="plastic-play-card" data-color-role="idea">
            <div className="plastic-card-cap">
              <Icon name="writing" />
              <span>
                {view === "diary"
                  ? "Запись для себя"
                  : view === "projects"
                    ? "Черновик плана"
                    : "Новая мысль"}
              </span>
              <span className="plastic-tag">Черновик</span>
            </div>
            <h3>Начни с пары слов.</h3>
            <p>Здесь спокойно можно быть неидеальным.</p>
            <label>
              Твоя мысль
              <input placeholder="А что, если…" />
            </label>
            <LivingButton
              className={`primary plastic-save ${saved ? "is-saved" : ""}`}
              onClick={() => {
                setSaved(!saved);
                setError(false);
              }}
            >
              <Icon name={saved ? "check" : "plus"} />
              {saved ? "Мысль сохранена" : "Положить в заметки"}
            </LivingButton>
          </article>
          <article className="plastic-play-card" data-color-role="select">
            <div className="plastic-card-cap">
              <Icon name="modules" />
              <span>Маленький проект</span>
              <span className="plastic-tag">В работе</span>
            </div>
            <h3>Шаг за шагом.</h3>
            <p>
              Цвет дорожки говорит о движении, зелёный — только о результате.
            </p>
            <LivingSlider
              label="Прогресс примера"
              value={progress}
              onChange={setProgress}
            />
            <LivingSwitch
              label="Соединение в примере"
              checked={connected}
              onChange={setConnected}
            />
            <div className="plastic-status" data-ready={connected}>
              <Icon name={connected ? "check" : "lock"} />
              {connected ? "Подключено в примере" : "Выключено в примере"}
            </div>
          </article>
        </div>
        <div className="plastic-result-row">
          <span role="status">
            {saved
              ? "Готово в макете. Никакой записи на сервер."
              : "Текст, значок и цвет работают вместе."}
          </span>
          <LivingButton
            className="plastic-error-trigger"
            onClick={() => setError(!error)}
          >
            {error ? "Закрыть пример ошибки" : "Посмотреть ошибку"}
          </LivingButton>
        </div>
        {error && (
          <div className="plastic-error" role="alert">
            <Icon name="close" />
            <div>
              <b>Не получилось в примере</b>
              <p>Черновик остался на месте. Можно повторить действие.</p>
            </div>
          </div>
        )}
      </div>
      <p className="plastic-reading-rule">
        Кип держит структуру: тёмные контуры и понятный текст. Основной цвет не
        заливает всю страницу. У ошибки — знак и объяснение; недоступное
        действие остаётся нейтральным.
      </p>
    </section>
  );
}
