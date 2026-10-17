import { useEffect, useState, type ReactNode } from 'react';
import {
  BACKGROUNDS,
  Button,
  Card,
  FAMILIES,
  GLASS_MODES,
  MODULES,
  MODULE_SCHEMES,
  ModuleTile,
  SIZES,
  STYLES,
  Segmented,
  Slider,
  Switch,
  TextField,
  contrast,
  type Family,
} from '@qubite/ui';
import type { LabSearch } from './search';
import './lab.css';

const FONT_SIZE = { s: '15px', m: '16px', l: '17.5px' } as const;

const SWATCHES = [
  { token: '--plastic-action', name: 'Действие', hex: '#ff9852', use: 'Одна главная кнопка' },
  { token: '--plastic-select', name: 'Выбор', hex: '#71cfff', use: 'Выделение, вкладки' },
  { token: '--plastic-idea', name: 'Мысль', hex: '#ffe163', use: 'Черновики, Inbox' },
  { token: '--plastic-success', name: 'Успех', hex: '#90dea5', use: 'Готово, сохранено' },
  { token: '--plastic-error', name: 'Ошибка', hex: '#ff8a7a', use: 'Всегда со значком и текстом' },
];
const INK = '#1d1b19';

interface Props {
  search: LabSearch;
  onChange: (next: Partial<LabSearch>) => void;
}

export function DesignLab({ search, onChange }: Props) {
  const { style, glass, bg, modules, size } = search;
  const isGlass = style === 'liquid' || style === 'glass';
  const styleInfo = STYLES.find((s) => s.id === style);

  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.fontSize;
    root.style.fontSize = FONT_SIZE[size];
    return () => {
      root.style.fontSize = prev;
    };
  }, [size]);

  return (
    <div
      className="q-app lab"
      data-style={style}
      data-glass={glass}
      data-bg={bg}
      data-modules={modules}
    >
      <header className="lab-panel">
        <div className="lab-panel__row">
          <strong className="lab-panel__title">Стиль</strong>
          <div className="lab-chips" role="radiogroup" aria-label="Стиль">
            {STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={s.id === style}
                className="lab-chip"
                onClick={() => onChange({ style: s.id })}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
        <div className="lab-panel__grid">
          {isGlass && (
            <Segmented
              label="Стекло"
              options={GLASS_MODES}
              value={glass}
              onChange={(v) => onChange({ glass: v })}
            />
          )}
          <Segmented
            label="Фон"
            options={BACKGROUNDS}
            value={bg}
            onChange={(v) => onChange({ bg: v })}
          />
          <Segmented
            label="Цвета модулей"
            options={MODULE_SCHEMES}
            value={modules}
            onChange={(v) => onChange({ modules: v })}
          />
          <Segmented
            label="Крупность"
            options={SIZES}
            value={size}
            onChange={(v) => onChange({ size: v })}
          />
        </div>
      </header>

      <main className="lab-main">
        <section className="lab-hero">
          <p className="q-eyebrow">Qubite · дизайн-лаборатория · {styleInfo?.name}</p>
          <h1 className="q-display">
            Мысль <span className="lab-arrow">→</span> дело.
          </h1>
          <p className="q-text-2 lab-lead">{styleInfo?.hint}</p>
          <div className="lab-row">
            <Button variant="action">Записать мысль</Button>
            <Button>Открыть Planner</Button>
          </div>
        </section>

        <Section eyebrow="01 · Цвет" title="Палитра «Игрушечная»">
          <div className="lab-swatches">
            {SWATCHES.map((s) => (
              <Card key={s.token} className="lab-swatch">
                <span
                  className="lab-swatch__chip"
                  style={{ background: `var(${s.token})` }}
                  aria-hidden="true"
                >
                  Аа
                </span>
                <strong>{s.name}</strong>
                <span className="q-text-2">{s.use}</span>
                <code>текст {contrast(s.hex, INK).toFixed(1)} : 1</code>
              </Card>
            ))}
          </div>
        </Section>

        <Section eyebrow="02 · Шрифты" title="Заголовки и текст">
          <Card>
            <p className="q-display lab-type-sample">Qubite 2.0</p>
            <h2 className="q-h1">Крупный заголовок</h2>
            <h3 className="q-h2">Заголовок раздела</h3>
            <h4 className="q-h3">Заголовок карточки</h4>
            <p>
              Обычный текст для чтения. Интерфейс живой, а текст спокойный: читать удобно и на
              телефоне, и на планшете. 0123456789
            </p>
            <p className="q-text-2">Второстепенный текст — подписи, подсказки, даты.</p>
          </Card>
        </Section>

        <Section eyebrow="03 · Элементы" title="Кнопки, выбор, поля">
          <Controls />
        </Section>

        <Section eyebrow="04 · Модули" title="Цвета модулей">
          <Modules />
        </Section>

        <Section eyebrow="05 · Пример" title="Экран «Сегодня»">
          <TodayExample />
        </Section>

        <p className="q-text-2 lab-footnote">
          Это шаг 1 (DS-001): материал, цвет, шрифты и форма. Живая физика — пружины, перетекание,
          растяжение — появится в DS-002 и будет общей для всех стилей.
        </p>
      </main>
    </div>
  );
}

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="lab-section">
      <p className="q-eyebrow">{eyebrow}</p>
      <h2 className="q-h2">{title}</h2>
      {children}
    </section>
  );
}

function Controls() {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week');
  const [hints, setHints] = useState(true);
  const [night, setNight] = useState(false);
  const [pliancy, setPliancy] = useState(70);
  const [duration, setDuration] = useState(503);
  return (
    <div className="lab-controls">
      <Card tone="action">
        <h3 className="q-h3">Кнопки</h3>
        <div className="lab-row">
          <Button variant="action">Сохранить</Button>
          <Button>Отменить</Button>
          <Button variant="ghost">Позже</Button>
        </div>
        <div className="lab-row">
          <Button variant="success">✓ Сохранено</Button>
          <Button disabled>Недоступно</Button>
        </div>
      </Card>
      <Card tone="select">
        <h3 className="q-h3">Выбор и ползунки</h3>
        <Segmented
          label="Период"
          options={[
            { id: 'day', name: 'День' },
            { id: 'week', name: 'Неделя' },
            { id: 'month', name: 'Месяц' },
          ]}
          value={period}
          onChange={setPeriod}
        />
        <Slider label="Податливость" value={pliancy} onChange={setPliancy} unit="%" />
        <Slider
          label="Длительность"
          value={duration}
          min={150}
          max={900}
          onChange={setDuration}
          unit=" мс"
        />
      </Card>
      <Card tone="success">
        <h3 className="q-h3">Переключатели</h3>
        <Switch label="Подсказки помощников" checked={hints} onChange={setHints} />
        <Switch label="Тихий вечер" checked={night} onChange={setNight} />
      </Card>
      <Card tone="idea">
        <h3 className="q-h3">Поля</h3>
        <TextField
          label="Новая мысль"
          placeholder="Что пришло в голову?"
          hint="Элик сам разберёт во «Входящие»"
        />
        <TextField label="Почта" defaultValue="kirill@" error="Не хватает адреса после @" />
      </Card>
    </div>
  );
}

function Modules() {
  const [active, setActive] = useState('planner');
  return (
    <Card>
      <div className="lab-tiles">
        {MODULES.map((m) => (
          <ModuleTile
            key={m.id}
            module={m}
            active={m.id === active}
            onClick={() => setActive(m.id)}
          />
        ))}
      </div>
      <ul className="lab-legend">
        {(Object.keys(FAMILIES) as Family[]).map((f) => (
          <li key={f}>
            <span
              className="lab-legend__dot"
              style={{ background: `var(--fam-${f})` }}
              aria-hidden="true"
            />
            <strong>{FAMILIES[f].companion}</strong>{' '}
            <span className="q-text-2">— {FAMILIES[f].role}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TodayExample() {
  const [done, setDone] = useState<Record<string, boolean>>({ t2: true });
  const tasks = [
    { id: 't1', title: 'Доделать конспект по физике', meta: 'Learn · до 18:00' },
    { id: 't2', title: 'Ответить Мише про турнир', meta: 'Входящие' },
    { id: 't3', title: 'Задача 4 из олимпиадного листка', meta: 'Planner · важно' },
  ];
  return (
    <div className="lab-phone">
      <Card className="lab-phone__screen">
        <p className="q-eyebrow">Пятница, 17 октября</p>
        <h3 className="q-h1">Сегодня</h3>
        <ul className="lab-tasks">
          {tasks.map((t) => (
            <li key={t.id}>
              <Switch
                label={t.title}
                checked={done[t.id] ?? false}
                onChange={(v) => setDone((d) => ({ ...d, [t.id]: v }))}
              />
              <span className="q-text-2 lab-tasks__meta">{t.meta}</span>
            </li>
          ))}
        </ul>
        <Card tone="idea" className="lab-inbox">
          <strong>Во «Входящих» 3 мысли</strong>
          <span className="q-text-2">Элик предлагает сделать из двух задачи</span>
          <Button variant="action">Разобрать</Button>
        </Card>
        <div className="lab-command" role="search">
          <span aria-hidden="true">✳</span>
          <span className="q-text-2">Спроси или запиши мысль…</span>
        </div>
      </Card>
    </div>
  );
}
