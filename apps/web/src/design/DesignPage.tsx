/**
 * Витрина дизайн-системы «Частицы» (DS-001): токены обеих тем, точка, текст, одна физика,
 * компоненты из @qubite/ui и помощники. Всё живое: трогай, печатай, переключай тему.
 */
import { loop, MASS } from '@qubite/motion';
import {
  Button,
  COLOR_USAGE,
  Command,
  Companion,
  DotIcon,
  DotText,
  ICON_NAMES,
  RingCheck,
  Segmented,
  Switch,
  useLook,
  type CompanionHandle,
  type CompanionKind,
  type ColorName,
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
        <Morph />
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
