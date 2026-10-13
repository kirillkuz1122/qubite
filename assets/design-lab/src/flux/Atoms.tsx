import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icons";
import { LivingButton } from "../milo/Controls";
const glyphs = [
  ["today", "Сегодня"],
  ["docs", "Документы"],
  ["search", "Поиск"],
  ["writing", "Редактор"],
  ["vpn", "Соединение"],
  ["modules", "Модули"],
  ["settings", "Настройки"],
  ["check", "Готово"],
  ["close", "Закрыть"],
  ["eye", "Показать"],
  ["lock", "Защита"],
  ["sun", "Свет"],
  ["moon", "Темнота"],
  ["mic", "Голос"],
  ["spark", "Идея"],
  ["desktop", "Компьютер"],
  ["tablet", "Планшет"],
  ["phone", "Телефон"],
  ["undo", "Отменить"],
  ["mail", "Письмо"],
  ["arrow", "Дальше"],
  ["plus", "Добавить"],
];
export function Atoms() {
  const [icon, setIcon] = useState("spark"),
    [busy, setBusy] = useState(false),
    [complete, setComplete] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <section className="atoms-specimen" aria-labelledby="atoms-title">
      <div className="choice-title">
        <div>
          <span className="eyebrow">ДЕТАЛИ / ЕДИНЫЙ ЯЗЫК</span>
          <h2 id="atoms-title">Маленькие, но важные.</h2>
        </div>
        <span>Иконки / состояния / форма</span>
      </div>
      <div className="atoms-layout">
        <div className="icon-library">
          <div className="glyph-proof">
            <Icon name={icon} size={38} />
            <span>Мягкая линия. Один ритм.</span>
          </div>
          <div className="glyph-grid">
            {glyphs.map(([id, label]) => (
              <LivingButton
                key={id}
                aria-label={`Иконка: ${label}`}
                aria-pressed={icon === id}
                onClick={() => setIcon(id)}
              >
                <Icon name={id} />
              </LivingButton>
            ))}
          </div>
        </div>
        <div className="atoms-states">
          <span className="eyebrow">СОСТОЯНИЯ ДЕЙСТВИЯ</span>
          <div className="state-buttons">
            <LivingButton
              className="primary"
              aria-busy={busy}
              data-complete={complete}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setComplete(false);
                timer.current = setTimeout(() => {
                  setBusy(false);
                  setComplete(true);
                }, 800);
              }}
            >
              <Icon name={complete ? "check" : busy ? "spark" : "plus"} />
              {busy
                ? "Собирается…"
                : complete
                  ? "Сохранено"
                  : "Попробуй действие"}
            </LivingButton>
            <LivingButton className="secondary" disabled>
              Недоступно
            </LivingButton>
          </div>
          <p role="status">
            {complete
              ? "Готово в примере. Мысль осталась здесь."
              : "Недоступное действие спокойно ждёт своего момента."}
          </p>
          <label className="specimen-field">
            Название мысли
            <input placeholder="То, к чему хочется вернуться" />
          </label>
          <div className="field-message">
            <Icon name="lock" size={14} />
            <span>Пример поля. Ничего не отправляется.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
