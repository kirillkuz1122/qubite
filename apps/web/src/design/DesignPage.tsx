/**
 * Витрина дизайн-системы «Частицы» (DS-001): токены обеих тем, точка, текст, одна физика,
 * компоненты из @qubite/ui и помощники. Всё живое: трогай, печатай, переключай тему.
 */
import { drag, loop, MASS, project, rubber } from '@qubite/motion';
import {
  Button,
  FEEL_LABEL,
  FEEL_NAMES,
  FEEL_PART_LABEL,
  feelOf,
  Range,
  COLOR_USAGE,
  Command,
  Companion,
  EdgeScroll,
  DotIcon,
  DotText,
  ICON_NAMES,
  RingCheck,
  Segmented,
  Switch,
  useLook,
  useSpring,
  type CompanionHandle,
  type CompanionKind,
  type ColorName,
  type FeelName,
  type FeelPart,
  type MotionChoice,
  type ThemeChoice,
} from '@qubite/ui';
import { useEffect, useRef, useState } from 'react';
import './design.css';

const WORDS = ['СЕГОДНЯ', 'ВХОДЯЩИЕ', 'PLANNER', 'DOCS'];
const CREW: { kind: CompanionKind; name: string; role: string }[] = [
  { kind: 'foti', name: 'Фоти', role: 'бережёт личное' },
  { kind: 'proto', name: 'Прото', role: 'ведёт дела' },
  { kind: 'elik', name: 'Элик', role: 'ловит мысли' },
  { kind: 'neit', name: 'Нейт', role: 'учит и помнит' },
];

export function DesignPage() {
  const { look, palette, set } = useLook();
  const phone = typeof innerWidth === 'number' && innerWidth < 700;
  return (
    <div className="ds">
      <EdgeScroll />
      <header className="ds-head">
        <h1 className="q-sr">Дизайн-система Qubite</h1>
        <DotText text="QUBITE" pitch={phone ? 7 : 11} label="Qubite" />
        <p className="ds-lead">
          Дизайн-система «Частицы»: мысль — это точка. Тёплый чёрный и тёплая бумага, текст — Fira
          Code, крупное — точками. Всё на странице живое: проведи по буквам, нажми на помощника,
          смени тему.
        </p>
        <Segmented<ThemeChoice>
          label="Тема"
          value={look.theme}
          onChange={(v, origin) => set('theme', v, origin)}
          options={[
            { value: 'dark', label: 'Тёмная' },
            { value: 'light', label: 'Светлая' },
            { value: 'auto', label: 'Авто' },
          ]}
        />
      </header>

      <Section
        title="ЦВЕТА"
        note="Одни имена в обеих темах. Переключи тему — значения поменяются на месте."
      >
        <ul className="ds-swatches">
          {(Object.keys(palette) as ColorName[]).map((name) => (
            <li key={name}>
              <span className="ds-swatch" style={{ background: `var(--q-${name})` }} />
              <b>{name}</b>
              <small>{COLOR_USAGE[name]}</small>
              <code>{palette[name]}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="ТОЧКА"
        note="Главный элемент. Форма точки скругляет всё: кнопки, строку Command, панели."
      >
        <div className="ds-dot">
          <label>
            <span>
              Скругление <b>{look.round}%</b>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={look.round}
              onChange={(e) => set('round', +e.target.value)}
            />
            <small>квадрат ← → круг</small>
          </label>
          <label>
            <span>
              Размер <b>{look.size}%</b>
            </span>
            <input
              type="range"
              min={60}
              max={125}
              value={look.size}
              onChange={(e) => set('size', +e.target.value)}
            />
            <small>мельче ← → крупнее</small>
          </label>
          <div className="ds-dot-row" aria-hidden="true">
            {(['ink', 'yellow', 'sky', 'orange', 'green'] as const).map((c) => (
              <i key={c} style={{ background: `var(--q-${c})` }} />
            ))}
          </div>
        </div>
      </Section>

      <Section
        title="ТЕКСТ"
        note="Fira Code — весь текст. Tiny5 точками — только крупные надписи и цифры."
      >
        <div className="ds-type">
          <DotText text="МЫСЛЬ — ЭТО ТОЧКА" pitch={phone ? 4 : 6} />
          <p className="ds-t-heading">Элик ловит мысли</p>
          <p className="ds-t-body">
            Напиши, скажи голосом или перешли из Telegram — мысль ляжет во «Входящие».
          </p>
          <p className="ds-t-caption">голосом · 9:12 · подписи — цветом dim</p>
        </div>
      </Section>

      <Section
        title="ДВИЖЕНИЕ"
        note="Одна пружина на всё: жёсткость 220, вязкость 20. Меняется только масса."
      >
        <Masses />
        <Throw />
        <Morph />
      </Section>

      <Section
        title="ХАРАКТЕРЫ"
        note="У каждого живого элемента три характера: тяжесть и упругость. Потрогай и выбери — выбор сразу работает во всём приложении."
      >
        <Characters />
        <FeelControls />
      </Section>

      <Section title="КОМПОНЕНТЫ" note="Из пакета @qubite/ui. Под пальцем всё пружинит.">
        <Components />
      </Section>

      <Section
        title="ПОМОЩНИКИ"
        note="Из точек, гнутся от основания, следят за курсором и кареткой. Нажми на любого."
      >
        <Crew />
      </Section>

      <Section
        title="ЛАБОРАТОРИЯ"
        note="Прототипы, которые ещё выбираем. Два редактора документов на одном сценарии (DOC-001)."
      >
        <a className="ds-lab" href="/lab/editor">
          Лаборатория редактора →
        </a>
      </Section>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ds-sec">
      <h2 className="q-sr">{title}</h2>
      <DotText text={title} pitch={3.4} repel={20} />
      <p className="ds-note">{note}</p>
      {children}
    </section>
  );
}

/** Четыре массы, один материал: толкни — и видно, как тяжёлое мягче лёгкого. */
const LANES = [
  { name: 'точка', m: MASS.dot },
  { name: 'подсветка', m: MASS.pill },
  { name: 'строка', m: MASS.row },
  { name: 'помощник', m: MASS.companion },
];
function Masses() {
  const runners = useRef<(HTMLElement | null)[]>([]);
  const [springs] = useState(() => LANES.map((l) => loop().spring(0, l.m)));
  const [right, setRight] = useState(false);
  useEffect(() => {
    springs.forEach((s, i) => {
      s.onChange = loop().render(() => {
        const el = runners.current[i];
        if (el) el.style.transform = `translateX(${(s.x * 100).toFixed(2)}%)`;
      });
    });
  }, [springs]);
  return (
    <div className="ds-masses">
      {LANES.map((l, i) => (
        <div key={l.name} className="ds-lane">
          <span>
            {l.name} <small>m = {l.m}</small>
          </span>
          <div className="ds-track">
            <span
              className="ds-runner"
              ref={(el) => {
                runners.current[i] = el;
              }}
            >
              <i />
            </span>
          </div>
        </div>
      ))}
      <Button
        variant="fill"
        onClick={() => {
          const L = loop();
          springs.forEach((sp) => L.to(sp, right ? 0 : 1));
          setRight(!right);
        }}
      >
        Толкнуть
      </Button>
    </div>
  );
}

/** Бросок: точку можно протащить и бросить к одной из трёх остановок; у краёв — резинка, Escape — назад. */
const STOPS = [0, 0.5, 1];
function Throw() {
  const track = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState(0);
  const s = useSpring(0, MASS.pill, (x) => {
    const w = track.current ? track.current.offsetWidth - 28 : 0;
    if (knob.current) knob.current.style.transform = `translateX(${(x * w).toFixed(2)}px)`;
  });
  useEffect(() => {
    const el = knob.current;
    const tr = track.current;
    if (!el || !tr) return;
    const L = loop();
    let from = 0;
    const width = () => Math.max(1, tr.offsetWidth - 28);
    const h = drag(el, {
      axis: 'x',
      onStart: () => (from = s.x),
      onMove: ({ dx }) => L.hold(s, rubber(from + dx / width(), 0, 1, 0.12)),
      onEnd: ({ vx }) => {
        const goal = project(s.x, vx / width(), 0.985);
        const i = STOPS.reduce(
          (best, p, j) => (Math.abs(p - goal) < Math.abs(STOPS[best]! - goal) ? j : best),
          0,
        );
        L.hold(s, s.x, vx / width());
        L.to(s, STOPS[i]!, feelOf('flow'));
        setAt(i);
      },
      onCancel: () => L.to(s, from, feelOf('flow')),
    });
    return () => h.destroy();
  }, [s]);
  return (
    <div className="ds-throw">
      <span>
        Бросок <small>тащи точку и бросай · у краёв резинка · Escape — назад</small>
      </span>
      <div className="ds-throw-track" ref={track}>
        {STOPS.map((p) => (
          <i key={p} style={{ left: `calc(${p * 100}% - ${p * 28}px + 11px)` }} />
        ))}
        <span
          className="ds-throw-knob"
          ref={knob}
          role="img"
          aria-label={`Точка на остановке ${at + 1} из 3`}
        />
      </div>
    </div>
  );
}

const PARTS: { part: FeelPart; hint: string }[] = [
  { part: 'button', hint: 'нажми, потяни, уведи палец — отмена' },
  { part: 'flow', hint: 'нажми дальний пункт, другой ряд или тащи подложку' },
  { part: 'switch', hint: 'нажми или тяни ручку пальцем' },
  { part: 'range', hint: 'тяни точку, уведи за край' },
];
const MODULES = ['Сегодня', 'Входящие', 'Planner', 'Docs', 'Учёба', 'Дневник', 'Деньги'];

function Characters() {
  const { look, set } = useLook();
  return (
    <div className="ds-chars">
      {PARTS.map(({ part, hint }) => (
        <div className="ds-char" key={part}>
          <p className="ds-char-head">
            <b>{FEEL_PART_LABEL[part]}</b>
            <small>{hint}</small>
          </p>
          <div className="ds-char-demo">
            <PartDemo part={part} />
          </div>
          <Segmented<FeelName>
            label={`Характер: ${FEEL_PART_LABEL[part]}`}
            value={look.feel[part]}
            onChange={(v) => set('feel', { ...look.feel, [part]: v })}
            options={FEEL_NAMES.map((n) => ({ value: n, label: FEEL_LABEL[n] }))}
          />
        </div>
      ))}
    </div>
  );
}

function PartDemo({ part }: { part: FeelPart }) {
  const [seg, setSeg] = useState('Сегодня');
  const [row, setRow] = useState('Сегодня');
  const [on, setOn] = useState(false);
  const [v, setV] = useState(40);
  if (part === 'button')
    return (
      <div className="ds-row">
        <Button variant="fill">Нажми и потяни</Button>
        <Button size="sm">Ещё</Button>
      </div>
    );
  if (part === 'flow')
    return (
      <>
        <Segmented
          label="Раздел"
          value={seg}
          onChange={setSeg}
          options={MODULES.slice(0, 4).map((m) => ({ value: m, label: m }))}
        />
        <Segmented
          label="Модуль"
          wrap
          value={row}
          onChange={setRow}
          options={MODULES.map((m) => ({ value: m, label: m }))}
        />
      </>
    );
  if (part === 'switch')
    return (
      <label className="ds-switch">
        <Switch checked={on} onChange={setOn} label="Пример переключателя" />
        {on ? 'Включено' : 'Выключено'}
      </label>
    );
  return <Range label="Пример ползунка" value={v} min={0} max={100} onChange={setV} />;
}

/** Ощущения целиком: живость, облегчённый режим, «меньше движения» — те же, что в Настройках. */
function FeelControls() {
  const { look, set } = useLook();
  return (
    <div className="ds-feel">
      <Range
        label="Живость"
        value={look.tempo}
        min={50}
        max={150}
        onChange={(v) => set('tempo', v)}
      />
      <label className="ds-switch">
        <Switch label="Облегчённый режим" checked={look.lite} onChange={(v) => set('lite', v)} />
        Облегчённый режим
      </label>
      <div className="ds-feel-row">
        <span>Меньше движения</span>
        <Segmented<MotionChoice>
          label="Меньше движения"
          value={look.motion}
          onChange={(v) => set('motion', v)}
          options={[
            { value: 'auto', label: 'Как в системе' },
            { value: 'less', label: 'Да' },
            { value: 'full', label: 'Нет' },
          ]}
        />
      </div>
    </div>
  );
}

/** Перестройка надписи: те же точки собираются в новое слово. */
function Morph() {
  const [i, setI] = useState(0);
  return (
    <div className="ds-morph">
      <DotText text={WORDS[i % WORDS.length] ?? ''} pitch={5} />
      <Button size="sm" onClick={() => setI(i + 1)}>
        Следующий раздел
      </Button>
    </div>
  );
}

function Components() {
  const [seg, setSeg] = useState<'week' | 'board'>('week');
  const [sw, setSw] = useState(true);
  const [tasks, setTasks] = useState([
    { t: 'Разобрать задачу на ДП с отбора', c: 'orange', time: '16:00', done: false },
    { t: 'Алгебра: № 214–220', c: 'sky', time: '18:00', done: false },
    { t: 'Сдать конспект по физике', c: 'sky', time: '9:00', done: true },
  ]);
  return (
    <div className="ds-comp">
      <div className="ds-row">
        <Button variant="fill">Начать</Button>
        <Button>Войти</Button>
        <Button size="sm">Позже</Button>
      </div>
      <div className="ds-row">
        <Segmented
          label="Вид"
          value={seg}
          onChange={setSeg}
          options={[
            { value: 'week', label: 'Неделя' },
            { value: 'board', label: 'Доска' },
          ]}
        />
        <label className="ds-switch">
          <Switch checked={sw} onChange={setSw} label="Подсказки Элика" />
          Подсказки Элика
        </label>
      </div>
      <ul className="ds-tasks">
        {tasks.map((task, i) => (
          <li key={task.t} className={task.done ? 'ds-done' : undefined}>
            <RingCheck
              done={task.done}
              label={`Готово: ${task.t}`}
              onToggle={(d) => setTasks(tasks.map((x, j) => (j === i ? { ...x, done: d } : x)))}
            />
            <span>
              {task.t}
              <small>
                <i className="q-dot" style={{ background: `var(--q-${task.c})` }} />
                {task.time}
              </small>
            </span>
          </li>
        ))}
      </ul>
      <div className="ds-icons" aria-label="Значки из точек">
        {ICON_NAMES.map((n) => (
          <span key={n} title={n}>
            <DotIcon name={n} />
            <small>{n}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Помощники смотрят на каретку Command и закрывают глаза на слово «пароль». */
function Crew() {
  const refs = useRef<(CompanionHandle | null)[]>([]);
  const shy = useRef(false);
  return (
    <div className="ds-crew">
      <div className="ds-crew-row">
        {CREW.map((c, i) => (
          <figure key={c.kind}>
            <Companion
              kind={c.kind}
              pitch={5}
              ref={(h) => {
                refs.current[i] = h;
              }}
            />
            <figcaption>
              <b>{c.name}</b>
              {c.role}
            </figcaption>
          </figure>
        ))}
      </div>
      <Command
        placeholder="Напиши что-нибудь — они посмотрят. А на «пароль» закроют глаза"
        onInput={(v) => {
          const secret = /парол/i.test(v);
          if (secret === shy.current) return;
          shy.current = secret;
          refs.current.forEach((r) => r?.turnAway(secret));
        }}
        onSave={() => refs.current.forEach((r) => r?.jump())}
      />
    </div>
  );
}
