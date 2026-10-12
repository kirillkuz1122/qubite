import { useState } from "react";
import { LivingButton, LivingTabs } from "../milo/Controls";
import { Pet, companions, type PetEvent } from "../milo/Pets";
export function ConversationSpecimen() {
  const [kind, setKind] = useState("quiet"),
    [id, setId] = useState("kip"),
    [event, setEvent] = useState<PetEvent>("focus"),
    [dismissed, setDismissed] = useState(false);
  const p = companions.find((p) => p.id === id)!;
  return (
    <section
      className="conversation-specimen"
      aria-labelledby="conversation-title"
    >
      <div className="choice-title">
        <div>
          <span className="eyebrow">ОБЩЕНИЕ / ТРИ РЕЖИМА</span>
          <h2 id="conversation-title">Появляется по делу.</h2>
        </div>
        <span>Один помощник · один контекст</span>
      </div>
      <p>
        Маленький знак у действия, короткая подсказка рядом с задачей или
        полноценный разговор по твоему запросу. Без захвата фокуса и без
        перекрытия кнопок.
      </p>
      <LivingTabs
        label="Режим общения"
        value={kind}
        items={[
          { id: "quiet", label: "Тихо" },
          { id: "advice", label: "Подсказка" },
          { id: "dialogue", label: "Диалог" },
        ]}
        onChange={(v) => {
          setKind(v);
          setDismissed(false);
        }}
      />
      <div className={`conversation-demo conversation-${kind}`}>
        <div className="conversation-context">
          <span className="eyebrow">ПРИМЕР КОНТЕКСТА</span>
          <h3>Собрать первую версию</h3>
          <p>
            Есть идея и несколько заметок.
            <br />
            Начнём с одного маленького шага.
          </p>
          <div>
            <span className="context-check">✓</span> Цель сформулирована
          </div>
          <div>
            <span className="context-check">○</span> Выбрать следующий шаг
          </div>
          <LivingButton
            className="secondary"
            onClick={() => {
              setEvent("agentError");
              setDismissed(false);
            }}
          >
            Промах помощника
          </LivingButton>
        </div>
        {!dismissed ? (
          <aside
            className="speech-example"
            aria-label="Пример сообщения помощника"
          >
            <div className="speech-pet">
              <Pet
                id={id}
                event={event}
                size={kind === "quiet" ? "small" : "normal"}
              />
            </div>
            <div className="speech-bubble" role="status">
              <span className="speech-byline">
                {p.name}
                <small>{p.domain}</small>
              </span>
              <p>
                {kind === "quiet" && event !== "agentError"
                  ? "Есть мысль о следующем шаге. Открыть?"
                  : p[event]}
              </p>
              {kind === "dialogue" && (
                <div className="conversation-reply">
                  <LivingButton
                    className="primary"
                    onClick={() => setEvent("thinking")}
                  >
                    Давай подумаем
                  </LivingButton>
                  <LivingButton
                    className="secondary"
                    onClick={() => setEvent("success")}
                  >
                    Шаг готов
                  </LivingButton>
                </div>
              )}
              <LivingButton
                className="dismiss-speech"
                aria-label="Скрыть пример подсказки"
                onClick={() => setDismissed(true)}
              >
                ×
              </LivingButton>
            </div>
          </aside>
        ) : (
          <LivingButton
            className="secondary"
            onClick={() => setDismissed(false)}
          >
            Вернуть помощника
          </LivingButton>
        )}
      </div>
      <div className="conversation-crew" role="group" aria-label="Кто говорит">
        {companions.map((p) => (
          <LivingButton
            key={p.id}
            aria-pressed={id === p.id}
            onClick={() => {
              setId(p.id);
              setEvent("focus");
              setDismissed(false);
            }}
          >
            {p.name}
          </LivingButton>
        ))}
      </div>
      <p className="specimen-footnote">
        Реплики здесь сценарные. В продукте инициатива зависит от характера,
        настройки и события; запись, исправление или платный вызов требуют
        соответствующих прав. Подсказку можно скрыть, диалог открывается по
        запросу.
      </p>
    </section>
  );
}
