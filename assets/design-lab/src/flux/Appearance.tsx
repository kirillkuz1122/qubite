import type { CSSProperties } from "react";
import { LivingButton, LivingSlider, LivingSwitch } from "../milo/Controls";
import {
  plasticPalettes,
  legacyPalettes,
  fonts,
  bodyFonts,
  themeVariables,
} from "./preferences";
import { ColorPlayground } from "./ColorPlayground";
export function Appearance({
  palette,
  night,
  onPalette,
  heading,
  body,
  onHeading,
  onBody,
  strength,
  onStrength,
  duration,
  onDuration,
  lite,
  onLite,
  quiet,
  onQuiet,
  hints,
  onHints,
  systemQuiet,
}: {
  palette: string;
  night: boolean;
  onPalette: (v: string) => void;
  heading: string;
  body: string;
  onHeading: (v: string) => void;
  onBody: (v: string) => void;
  strength: number;
  onStrength: (v: number) => void;
  duration: number;
  onDuration: (v: number) => void;
  lite: boolean;
  onLite: (v: boolean) => void;
  quiet: boolean;
  onQuiet: (v: boolean) => void;
  hints: boolean;
  onHints: (v: boolean) => void;
  systemQuiet: boolean;
}) {
  const selected = plasticPalettes.find((p) => p.id === palette);
  return (
    <div className="specimen-section appearance-section">
      <header className="section-heading">
        <span className="eyebrow">02 / ОБРАЗ И ОЩУЩЕНИЯ</span>
        <h1>Собери свой поток.</h1>
        <p>
          Пять наборов цветного пластика. Выбранные тобой Unbounded, Manrope и
          «Лента» уже стоят по умолчанию. Нажми вариант: его правила сразу
          применятся ко всей витрине.
        </p>
      </header>
      <section className="choice-block" aria-labelledby="palette-title">
        <div className="choice-title">
          <h2 id="palette-title">Цветной пластик</h2>
          <span>Пять новых вариантов</span>
        </div>
        <div className="palette-choices plastic-palette-choices">
          {plasticPalettes.map((p, i) => (
            <LivingButton
              className="palette-choice plastic-palette-choice"
              aria-label={`Цветной пластик: ${p.name}`}
              aria-pressed={palette === p.id}
              key={p.id}
              onClick={() => onPalette(p.id)}
              style={themeVariables(p, night) as CSSProperties}
              data-choice={p.id}
            >
              <div className="plastic-choice-art" aria-hidden="true">
                <i style={{ background: p.roles.idea }} />
                <i style={{ background: p.roles.select }} />
                <i style={{ background: p.roles.action }} />
                <i style={{ background: p.roles.success }} />
                <span>Q</span>
              </div>
              <small>
                0{i + 1} / {palette === p.id ? "Выбран" : "Попробовать"}
              </small>
              <strong>{p.name}</strong>
              <span>{p.note}</span>
              <span className="plastic-choice-order">
                {["action", "select", "idea", "success"].map((r, i) => (
                  <span key={r}>
                    <i
                      style={{ background: p.roles[r as keyof typeof p.roles] }}
                    />
                    {["Действие", "Выбор", "Мысль", "Готово"][i]}
                  </span>
                ))}
              </span>
            </LivingButton>
          ))}
        </div>
        <details className="legacy-palettes">
          <summary>Прежние спокойные палитры</summary>
          <div className="palette-choices">
            {legacyPalettes.map((p, i) => (
              <LivingButton
                className="palette-choice"
                aria-pressed={palette === p.id}
                key={p.id}
                onClick={() => onPalette(p.id)}
              >
                <div className="palette-swatches">
                  {p.colors.map((c) => (
                    <i key={c} style={{ background: c }} />
                  ))}
                </div>
                <small>0{i + 1}</small>
                <strong>{p.name}</strong>
                <span>{p.note}</span>
              </LivingButton>
            ))}
          </div>
        </details>
      </section>
      {selected && <ColorPlayground palette={selected} />}
      <div className="font-groups">
        {[
          {
            id: "heading",
            title: "Шрифт заголовков",
            list: fonts,
            value: heading,
            onChange: onHeading,
          },
          {
            id: "body",
            title: "Шрифт текста",
            list: bodyFonts,
            value: body,
            onChange: onBody,
          },
        ].map((group) => (
          <section
            className="choice-block"
            key={group.id}
            aria-labelledby={`${group.id}-font-title`}
          >
            <div className="choice-title">
              <h2 id={`${group.id}-font-title`}>{group.title}</h2>
              <span>Независимый выбор</span>
            </div>
            <div className="font-choices">
              {group.list.map((f) => (
                <LivingButton
                  className={`font-choice font-choice-${group.id}`}
                  key={f.id}
                  aria-pressed={group.value === f.id}
                  onClick={() => group.onChange(f.id)}
                >
                  <span>
                    <b>{f.name}</b>
                    <small>{f.character}</small>
                  </span>
                  <em style={{ fontFamily: f.family }}>
                    {group.id === "heading"
                      ? "Живи. Создавай."
                      : "Хорошая мысль начинается с простых слов."}
                  </em>
                </LivingButton>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="type-proof">
        <span className="eyebrow">ТВОЯ ПАРА В РАБОТЕ</span>
        <h2>
          У каждой мысли
          <br />
          есть продолжение<span>.</span>
        </h2>
        <p>
          Пространство, в котором можно собирать идеи, двигать проекты и
          возвращаться к себе. Не нужно заранее знать, куда положить мысль.
          Просто начни.
        </p>
        <div>
          <LivingButton className="primary">Сохранить мысль ↗</LivingButton>
          <span>Аа Бб · 0123456789 · № 42</span>
        </div>
      </div>
      <section className="motion-choice-block">
        <div className="choice-title">
          <h2>Ритм материала</h2>
          <span>Настройки движения</span>
        </div>
        <div className="motion-choice-grid">
          <LivingSlider
            label="Податливость интерфейса"
            value={strength}
            onChange={onStrength}
          />
          <LivingSlider
            label="Перетекание выбора"
            min={250}
            max={900}
            value={duration}
            suffix=" мс"
            onChange={onDuration}
          />
          <LivingSwitch
            label="Лёгкий рендеринг"
            checked={lite}
            onChange={onLite}
          />
          <LivingSwitch
            label="Спокойный режим"
            checked={quiet || systemQuiet}
            onChange={(v) => {
              if (!systemQuiet) onQuiet(v);
            }}
          />
          <LivingSwitch
            label="Подсказки персонажей"
            checked={hints}
            onChange={onHints}
          />
        </div>
        <p>
          {systemQuiet ? "Уменьшение движения включено в системе. " : ""}На
          сенсорном экране лёгкий рендеринг включён автоматически: сохраняет
          движение и растяжение, упрощает свет и края. Все настройки живут в
          этом просмотре и сбрасываются после перезагрузки.
        </p>
      </section>
    </div>
  );
}
