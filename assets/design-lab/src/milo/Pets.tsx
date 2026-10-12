import { useContext, useEffect, useRef, useState } from "react";
import { MotionContext, usePhysics } from "./motion";
import { LivingButton, LivingTabs } from "./Controls";
export const companions = [
  {
    id: "lumi",
    listening: "Я слышу тебя. Можно не спешить.",
    thinking: "Подумаю вместе с тобой. Без гонки.",
    rest: "Небольшая пауза тоже помогает.",
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
    listening: "Слушаю. Сначала условие, потом решение.",
    thinking: "Сверяю шаги. Покажу, что нужно проверить.",
    rest: "Остановимся на минуту. План никуда не исчезнет.",
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
    listening: "Ловлю слова, даже если они пока не связаны.",
    thinking: "Проверяю одну неожиданную связь…",
    rest: "Оставлю идею дозревать. Вернёмся позже.",
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
    listening: "Я слушаю. Не обязательно сразу искать вывод.",
    thinking: "Дадим мысли немного места.",
    rest: "Можно просто побыть здесь. Без нового вопроса.",
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
export type PetEvent =
  | "idle"
  | "success"
  | "error"
  | "focus"
  | "agentError"
  | "listening"
  | "thinking"
  | "rest";
type GazeClient = (x: number, y: number, type: string) => void;
const gazeClients = new Set<GazeClient>();
let gazeAttached = false;
const gazePointer = (e: PointerEvent) => {
  for (const client of gazeClients) client(e.clientX, e.clientY, e.pointerType);
};
function attachGaze() {
  if (!gazeAttached) {
    document.addEventListener("pointermove", gazePointer, { passive: true });
    document.addEventListener("pointerdown", gazePointer, { passive: true });
    gazeAttached = true;
  }
}
function detachGaze() {
  if (gazeAttached && !gazeClients.size) {
    document.removeEventListener("pointermove", gazePointer);
    document.removeEventListener("pointerdown", gazePointer);
    gazeAttached = false;
  }
}
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
  const root = useRef<HTMLDivElement>(null),
    gesture = useRef<HTMLDivElement>(null);
  const pose = useRef("none");
  const gaze = usePhysics(root, { gazeX: 0, gazeY: 0 });
  const context = useContext(MotionContext);
  useEffect(() => {
    if (!context || context.quiet) {
      gaze.to({ gazeX: 0, gazeY: 0 }, true);
      return;
    }
    const el = root.current;
    if (!el) return;
    let visible = true,
      rect: DOMRect | null = null,
      measured = 0;
    const observer = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      el.dataset.visible = String(visible);
      rect = null;
    });
    observer.observe(el);
    const listener = (x: number, y: number, type: string) => {
      if (!visible) return;
      const now = performance.now();
      if (!rect || now - measured > 200) {
        rect = el.getBoundingClientRect();
        measured = now;
      }
      const cx = rect.left + rect.width / 2,
        cy = rect.top + rect.height / 2;
      gaze.to({
        gazeX: Math.tanh((x - cx) / 170) * 4.5,
        gazeY: Math.tanh((y - cy) / 170) * 3,
      });
      el.dataset.looking = type;
    };
    gazeClients.add(listener);
    attachGaze();
    const reset = () => {
      rect = null;
    };
    window.addEventListener("scroll", reset, { passive: true });
    window.addEventListener("resize", reset);
    return () => {
      observer.disconnect();
      gazeClients.delete(listener);
      detachGaze();
      window.removeEventListener("scroll", reset);
      window.removeEventListener("resize", reset);
    };
  }, [context?.quiet]);
  useEffect(() => {
    const el = gesture.current;
    if (!el || !context || context.quiet) return;
    const start = pose.current;
    const frames: Record<PetEvent, Keyframe[]> = {
      idle: [{ transform: "none" }],
      focus: [
        { transform: "translateY(-2px) rotate(-2deg)" },
        { transform: "none" },
      ],
      success: [
        { transform: "translateY(-9px) rotate(3deg) scale(1.025)" },
        { transform: "translateY(1px) scale(1.02,.98)" },
        { transform: "none" },
      ],
      error: [
        { transform: "rotate(-4deg) scale(.98)" },
        { transform: "rotate(2deg)" },
        { transform: "none" },
      ],
      agentError: [
        { transform: "translateY(3px) rotate(-5deg)" },
        { transform: "translateY(-1px) rotate(1deg)" },
        { transform: "none" },
      ],
      listening: [{ transform: "rotate(4deg)" }, { transform: "rotate(2deg)" }],
      thinking: [
        { transform: "translateY(-3px) rotate(-3deg)" },
        { transform: "rotate(-1deg)" },
      ],
      rest: [
        { transform: "translateY(4px) scale(1.02,.96)" },
        { transform: "translateY(2px)" },
      ],
    };
    const anim = el.animate([{ transform: start }, ...frames[event]], {
      duration: event === "success" ? 1100 : 800,
      easing: "cubic-bezier(.22,.65,.25,1)",
      fill: "forwards",
    });
    return () => {
      pose.current = getComputedStyle(el).transform;
      anim.cancel();
    };
  }, [event, context?.quiet]);
  return (
    <div
      className={`companion companion-${p.shape} companion-${p.id} pet-${size}`}
      ref={root}
      data-reaction={event}
      aria-hidden="true"
    >
      <div className="pet-gesture" ref={gesture}>
        <div className="pet-body">
          <div className="pet-brows">
            <i />
            <i />
          </div>
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
          <div className="pet-detail" />
        </div>
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
              { id: "listening", label: "Слушаю" },
              { id: "thinking", label: "Думаю" },
              { id: "rest", label: "Отдых" },
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
