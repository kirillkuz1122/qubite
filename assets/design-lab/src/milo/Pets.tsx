import { useState } from "react";
import { LivingButton, LivingTabs } from "./Controls";
export const companions = [
  {
    id: "lumi",
    agentError:
      "Я поспешил с подсказкой. Давай вернёмся на шаг назад — спокойно, я рядом.",
    name: "Луми",
    domain: "Личная жизнь",
    shape: "round",
    trait: "Заботливый оптимист",
    rhythm:
      "Мягкие покачивания, сначала замечает твоё настроение. Не торопит и не читает нотации.",
    success:
      "Ты сделал шаг. Теперь можно выдохнуть — и отметить это маленькой радостью.",
    error:
      "Похоже, что-то не получилось. Это нормально. Давай спокойно попробуем ещё раз?",
    focus: "Я рядом. Можно просто начать с одной мысли, без идеального плана.",
    idle: "Не каждую минуту нужно превращать в результат. Как ты сейчас?",
  },
  {
    id: "kip",
    agentError:
      "Мой промах. Предыдущий шаг отменяем. Проверю условие и предложу исправление.",
    name: "Кип",
    domain: "Проекты",
    shape: "square",
    trait: "Прямой, собранный практик",
    rhythm:
      "Короткие точные движения. Проверяет план, ловит пропущенный шаг, предлагает конкретное действие.",
    success: "Готово. Один пункт закрыт. Следующий шаг уже выглядит проще.",
    error:
      "Стоп. Здесь пропущено действие. Исправляем его — и идём дальше, без суеты.",
    focus: "Разложим задачу: цель, первый шаг, результат. С чего начнём?",
    idle: "Большой проект не обязан быть большой задачей. Давай найдём ближайший шаг.",
  },
  {
    id: "pip",
    agentError:
      "Ой, я увёл мысль не туда! Исходную оставим, попробую другой ход.",
    name: "Пип",
    domain: "Заметки и идеи",
    shape: "tall",
    trait: "Любопытный импровизатор",
    rhythm:
      "Смотрит по сторонам, тянется к новой мысли, реагирует с задержкой и перескакивает между ассоциациями.",
    success: "Поймали! О, а если связать эту мысль с другой идеей?",
    error:
      "Ой, мысль убежала раньше, чем мы её записали. Брось пару слов — я подхвачу.",
    focus: "Сырая мысль? Отлично. Красиво оформим потом, сначала поймаем её.",
    idle: "У меня назревает одно «а что если…». А у тебя?",
  },
  {
    id: "sage",
    agentError:
      "Я сделал вывод слишком рано. Отложим его. Ты можешь поправить меня или просто продолжить запись.",
    name: "Сэйдж",
    domain: "Личный дневник",
    shape: "sage",
    trait: "Вдумчивый наблюдатель",
    rhythm:
      "Поправляет очки, листает маленький блокнот, выдерживает паузу. Помогает вопросом, не ставит диагнозов.",
    success:
      "Запись сохранилась. Если захочешь, вернёмся к тому, что сегодня было важным.",
    error:
      "Кажется, запись ещё не завершена. Оставим её как есть или попробуем назвать главное?",
    focus:
      "Что в этом событии было важно именно для тебя? Можно ответить одной строкой.",
    idle: "Иногда смысл становится заметен после паузы. Я подожду.",
  },
] as const;
export type PetEvent = "idle" | "success" | "error" | "focus" | "agentError";
export function Pet({
  id,
  event = "idle",
  size = "normal",
}: {
  id: string;
  event?: PetEvent;
  size?: string;
}) {
  const p = companions.find((p) => p.id === id)!;
  return (
    <div
      className={`companion companion-${p.shape} companion-${p.id} pet-${size}`}
      data-reaction={event}
      aria-hidden="true"
    >
      <div className="pet-body">
        <div className="pet-eyes">
          <i />
          <i />
        </div>
        {p.shape === "sage" && (
          <>
            <div className="pet-glasses" />
            <div className="pet-book">
              <span />
            </div>
          </>
        )}
        <div className="pet-mouth" />
        <div className="pet-cheek" />
      </div>
      <span className="pet-floor" />
    </div>
  );
}
export function PetCrew() {
  const [selected, setSelected] = useState("lumi");
  const [event, setEvent] = useState<PetEvent>("idle");
  const p = companions.find((p) => p.id === selected)!;
  return (
    <div className="crew-page">
      <header>
        <span className="eyebrow">ОТДЕЛЬНЫЙ СЛОЙ · ПОМОЩНИКИ</span>
        <h1>
          Четыре характера.
          <br />
          На твоей стороне.
        </h1>
        <p>
          Олицетворяют будущих AI-агентов. У каждого своя область, манера речи и
          поведение. Сейчас это сценарии персонажей, без AI-запросов.
        </p>
      </header>
      <div className="crew-cards">
        {companions.map((x) => (
          <LivingButton
            className={`crew-card ${selected === x.id ? "chosen" : ""}`}
            key={x.id}
            aria-pressed={selected === x.id}
            onClick={() => {
              setSelected(x.id);
              setEvent("idle");
            }}
          >
            <Pet id={x.id} />
            <strong>{x.name}</strong>
            <span>{x.domain}</span>
          </LivingButton>
        ))}
      </div>
      <div className="crew-story">
        <div>
          <span className="eyebrow">{p.domain}</span>
          <h2>
            {p.name}. {p.trait}.
          </h2>
          <p>{p.rhythm}</p>
          <LivingTabs
            label="Событие для помощника"
            value={event}
            items={[
              { id: "idle", label: "Пауза" },
              { id: "focus", label: "Начинаю" },
              { id: "success", label: "Получилось" },
              { id: "error", label: "Ошибка" },
              { id: "agentError", label: "Мой промах" },
            ]}
            onChange={(id) => setEvent(id as PetEvent)}
          />
        </div>
        <div className="pet-dialogue" role="status">
          <Pet id={p.id} event={event} />
          <p key={`${selected}-${event}`}>{p[event]}</p>
        </div>
      </div>
    </div>
  );
}
export function CompanionHint({
  event,
  section,
  onDismiss,
}: {
  event: PetEvent;
  section: string;
  onDismiss: () => void;
}) {
  const id =
    section === "writing" || section === "docs"
      ? "pip"
      : section === "settings" || section === "console"
        ? "kip"
        : event === "error"
          ? "lumi"
          : "sage";
  const pet = companions.find((p) => p.id === id)!;
  return (
    <aside className="companion-hint" role="status">
      <Pet id={id} event={event} size="small" />
      <div>
        <strong>{pet.name}</strong>
        <p>{pet[event]}</p>
        <small>Сценарий персонажа · без AI</small>
      </div>
      <LivingButton
        aria-label="Закрыть подсказку помощника"
        onClick={onDismiss}
      >
        ×
      </LivingButton>
    </aside>
  );
}
