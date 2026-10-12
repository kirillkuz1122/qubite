import { useContext, useRef, useState } from "react";
import {
  LivingButton,
  LivingSlider,
  LivingSwitch,
  LivingTabs,
  ExpandingMenu,
} from "./Controls";
import { MotionContext } from "./motion";
import { Icon } from "../Icons";
export function ControlRoom() {
  const c = useContext(MotionContext)!;
  const [value, setValue] = useState(45),
    [tone, setTone] = useState(2);
  const [on, setOn] = useState(true),
    [silent, setSilent] = useState(false);
  const [tab, setTab] = useState("day"),
    [count, setCount] = useState(0);
  const [saved, setSaved] = useState(false),
    [message, setMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    card = useRef<HTMLDivElement>(null);
  const origin = useRef<DOMRect | null>(null),
    trigger = useRef<HTMLButtonElement | null>(null);
  const busy = useRef(false);
  function open(e: React.MouseEvent<HTMLButtonElement>) {
    trigger.current = e.currentTarget;
    origin.current = e.currentTarget.getBoundingClientRect();
    dialog.current?.showModal();
    const r = card.current?.getBoundingClientRect(),
      o = origin.current;
    if (r && o && !c.quiet)
      card.current?.animate(
        [
          {
            transform: `translate(${o.x + o.width / 2 - r.x - r.width / 2}px,${o.y + o.height / 2 - r.y - r.height / 2}px) scale(${o.width / r.width},${o.height / r.height})`,
            borderRadius: "50px",
            opacity: 0.8,
          },
          { transform: "none", borderRadius: "28px", opacity: 1 },
        ],
        { duration: 560, easing: "cubic-bezier(.18,.85,.24,1)" },
      );
  }
  async function close() {
    if (busy.current) return;
    busy.current = true;
    const r = card.current?.getBoundingClientRect(),
      o = trigger.current?.getBoundingClientRect();
    if (r && o && !c.quiet) {
      const a = card.current!.animate(
        [
          { transform: "none", opacity: 1 },
          {
            transform: `translate(${o.x + o.width / 2 - r.x - r.width / 2}px,${o.y + o.height / 2 - r.y - r.height / 2}px) scale(${o.width / r.width},${o.height / r.height})`,
            opacity: 0.5,
            borderRadius: "50px",
          },
        ],
        { duration: 340, easing: "cubic-bezier(.7,0,.9,.4)" },
      );
      try {
        await a.finished;
      } catch {
        /* interrupted animations still close */
      }
    }
    dialog.current?.close();
    trigger.current?.focus();
    busy.current = false;
  }
  return (
    <div className="control-room">
      <header className="control-intro">
        <div>
          <span className="eyebrow">MILO / {c.profile.name.toUpperCase()}</span>
          <h1>
            Не смотри.
            <br />
            <em>Потрогай.</em>
          </h1>
          <p>{c.profile.detail}</p>
        </div>
        <div className="touch-demo">
          <LivingButton
            className="drag-demo"
            aria-label="Потяни материал"
            onClick={() => setCount(count + 1)}
          >
            <span className="touch-grip">✳</span>
            <strong>Потяни меня</strong>
            <small>В стороны. Отпусти. Почувствуй возврат.</small>
            <span className="touch-count">
              {count ? `Нажатий: ${count}` : "Поддерживает палец и мышь"}
            </span>
          </LivingButton>
        </div>
      </header>
      <div className="control-grid">
        <section className="control-card">
          <span className="eyebrow">01 / КНОПКИ</span>
          <h2>Давление. Отдача.</h2>
          <p>Удерживай и тяни. Большое перемещение не запускает действие.</p>
          <div className="button-samples">
            <LivingButton
              className={`primary save-material ${saved ? "is-saved" : ""}`}
              onClick={() => {
                setSaved(!saved);
                setMessage(saved ? "Пример отменён" : "Сохранено в макете");
              }}
            >
              <Icon name={saved ? "check" : "plus"} />
              {saved ? "Готово" : "Сохранить мысль"}
            </LivingButton>
            <LivingButton
              className="secondary"
              onClick={() => setMessage("Пример отмены")}
            >
              Отменить
            </LivingButton>
            <LivingButton
              className="sample-round"
              aria-label="Добавить пример"
              onClick={() => setCount(count + 1)}
            >
              <Icon name="plus" />
            </LivingButton>
          </div>
        </section>
        <section className="control-card">
          <span className="eyebrow">02 / ПОЛЗУНОК</span>
          <h2>Следует за пальцем.</h2>
          <p>
            Головка тянется по направлению движения. Значение точное, возврат с
            характером.
          </p>
          <LivingSlider
            label="Интенсивность"
            value={value}
            onChange={setValue}
          />
          <LivingSlider
            label="Глубина"
            min={0}
            max={5}
            suffix=""
            value={tone}
            onChange={setTone}
          />
        </section>
        <section className="control-card">
          <span className="eyebrow">03 / ПЕРЕКЛЮЧАТЕЛЬ</span>
          <h2>Включи движением.</h2>
          <p>
            Перетащи головку или нажми. Форму можно менять, смысл остаётся
            понятным.
          </p>
          <LivingSwitch
            label="Мягкие подсказки"
            checked={on}
            onChange={setOn}
          />
          <LivingSwitch
            label="Тихий вечер"
            checked={silent}
            onChange={setSilent}
          />
        </section>
        <section className="control-card">
          <span className="eyebrow">04 / ВЫБОР</span>
          <h2>Одна форма, три места.</h2>
          <p>
            Нажми пункт или протяни выделение между ними. Оно движется
            непрерывно.
          </p>
          <LivingTabs
            label="Период"
            items={[
              { id: "day", label: "День" },
              { id: "week", label: "Неделя" },
              { id: "month", label: "Месяц" },
            ]}
            value={tab}
            onChange={setTab}
          />
          <div className="period-visual" data-period={tab}>
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <span>
              {tab === "day"
                ? "Один маленький шаг"
                : tab === "week"
                  ? "Видно направление"
                  : "Складывается картина"}
            </span>
          </div>
        </section>
        <section className="control-card">
          <span className="eyebrow">05 / РАСКРЫТИЕ</span>
          <h2>Кнопка становится меню.</h2>
          <p>Форма остаётся на своём месте и раскрывает содержимое.</p>
          <ExpandingMenu />
        </section>
        <section className="control-card">
          <span className="eyebrow">06 / ПЕРЕХОД</span>
          <h2>От действия к пространству.</h2>
          <p>
            Окно вырастает из точки нажатия. Закрытие возвращает его туда же.
          </p>
          <LivingButton className="primary" onClick={open}>
            Открыть пространство <Icon name="arrow" />
          </LivingButton>
        </section>
      </div>
      <div role="status" className="control-feedback">
        {message || "Все действия — локальные примеры. Данные не отправляются."}
      </div>
      <dialog
        ref={dialog}
        className="material-dialog"
        aria-labelledby="material-dialog-title"
        onCancel={(e) => {
          e.preventDefault();
          void close();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) void close();
        }}
      >
        <div className="material-dialog-card" ref={card}>
          <span className="eyebrow">ПРОДОЛЖЕНИЕ ТОГО ЖЕ МАТЕРИАЛА</span>
          <h2 id="material-dialog-title">Мы уже внутри.</h2>
          <p>
            Кнопка не исчезла без следа: она дала начало этому пространству.
            Здесь можно продолжить мысль.
          </p>
          <label>
            Черновик
            <input placeholder="Одна мысль — уже начало" />
          </label>
          <LivingButton className="primary" onClick={() => void close()}>
            Вернуться <Icon name="arrow" />
          </LivingButton>
        </div>
      </dialog>
    </div>
  );
}
