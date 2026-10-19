/**
 * Лендинг для гостя (DS-007) — перенос макета landing.html: «Мысль — это точка», история из шести шагов,
 * живая строка Command, учёба в Ink, принципы и финал. Всё из точек на движке @qubite/ui.
 */
import { loop, MASS, type Spring } from '@qubite/motion';
import {
  COMMAND_OWNER,
  DotGrid,
  DotText,
  caretPoint,
  focusOn,
  parseCommand,
  textCells,
  typewriter,
  useLook,
  usePress,
  useSpring,
  type CompanionKind,
  type ParsedCommand,
} from '@qubite/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ServerStatus } from '../ServerStatus';
import { api } from '../api';
import {
  final,
  hero,
  miniCrew,
  ruleIcon,
  story,
  study,
  type HeroApi,
  type MiniCrew,
  type RuleIcon,
  type Scroll,
} from './scenes';
import './landing.css';

const FONT_TEXT =
  'МЫСЛЬ ЭТО ТОЧКА qubite ОДНА СТРОКА НА ВСЁ ДЛЯ УЧЁБЫ ПО-ЧЕСТНОМУ НАЧНИ С ОДНОЙ ПН ВТ СР ЧТ ПТ СБ ВС Y=X²';

/** Пиксельный шрифт загружен: только после этого буквы раскладываются в точки. */
function useFontReady(): boolean {
  const [ok, setOk] = useState(() => typeof document === 'undefined' || !document.fonts);
  useEffect(() => {
    if (ok) return;
    let live = true;
    Promise.all([document.fonts.load("32px 'Qubite Tiny5'", FONT_TEXT), document.fonts.ready])
      .catch(() => undefined)
      .then(() => live && setOk(true));
    return () => {
      live = false;
    };
  }, [ok]);
  return ok;
}

/** Ширина окна; меняется, только если окно заметно стало другим (сцены пересобираются). */
function useWidth(): number {
  const [w, setW] = useState(() => (typeof innerWidth === 'number' ? innerWidth : 1024));
  useEffect(() => {
    const on = () => setW((cur) => (Math.abs(innerWidth - cur) > 40 ? innerWidth : cur));
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);
  return w;
}

/** Одно место для прокрутки: сцены читают scroll.y в общем цикле. */
const scroll: Scroll = { y: typeof scrollY === 'number' ? scrollY : 0 };

const CHAPTERS: { color: string; title: string; body: ReactNode }[] = [
  {
    color: 'ink',
    title: 'Сто мыслей в день',
    body: (
      <>
        Идея для проекта, домашка на завтра, подарок маме. Половина теряется по дороге — если её{' '}
        <b>некуда положить</b>.
      </>
    ),
  },
  {
    color: 'yellow',
    title: 'Элик ловит',
    body: (
      <>
        Напиши, скажи голосом или перешли из Telegram — мысль ляжет во <b>«Входящие»</b>. Разберёшь,
        когда будет минутка.
      </>
    ),
  },
  {
    color: 'ink',
    title: 'Прото раскладывает',
    body: (
      <>
        Мысль становится делом со сроком. Прото раскладывает дела <b>по дням недели</b>, чтобы к
        пятнице не копился завал.
      </>
    ),
  },
  {
    color: 'sky',
    title: 'Нейт помнит',
    body: (
      <>
        Заметки из Docs и рукописные страницы из Ink — <b>в одном месте</b>. Нейт свяжет их с делами
        и напомнит повторить перед контрольной.
      </>
    ),
  },
  {
    color: 'orange',
    title: 'Фоти бережёт личное',
    body: (
      <>
        Дневник, здоровье, деньги — отдельно от всего остального. Помощники <b>закрывают глаза</b>,
        а в общий доступ личное само не попадает.
      </>
    ),
  },
  {
    color: 'orange',
    title: 'Ты — ядро',
    body: (
      <>
        Мысли, дела, знания и личное вращаются вокруг тебя, а помощники держат орбиты. Отсюда и
        имена: <b>электрон, протон, нейтрон, фотон</b>.
      </>
    ),
  },
];

const RULES: { icon: RuleIcon; title: string; text: string }[] = [
  {
    icon: 'offline',
    title: 'Работает без интернета',
    text: 'Заметки, дела и конспекты живут на устройстве и синхронизируются, когда появится сеть. В метро и в школе с закрытым Wi-Fi — тоже.',
  },
  {
    icon: 'hand',
    title: 'Руками или с AI',
    text: 'Любое действие можно сделать самому. AI — удобный способ, а не обязательный, и платный AI сам не включится.',
  },
  {
    icon: 'lock',
    title: 'Личное — отдельно',
    text: 'Дневник, личная память и ключи не попадают в общий доступ сами — даже в командных проектах.',
  },
  {
    icon: 'server',
    title: 'Свой сервер',
    text: 'Qubite ставится на свой компьютер или Raspberry Pi. Данные остаются у тебя: экспорт, бэкапы, журнал действий AI.',
  },
];

const HERO_PHRASES = [
  'завтра в 16:00 отбор по информатике',
  'идея: бот, который напоминает про дз',
  'прочитать главу 3 по физике',
  'позвонить бабушке в воскресенье',
];
const DEMO_PHRASES = [
  'завтра в 16:00 отбор по информатике',
  'идея: бот, который напоминает про дз',
  'найти конспект про дерево Фенвика',
  'в дневник: сегодня решил задачу, которую не мог неделю',
];
const CHIPS: [string, string][] = [
  ['дело со сроком', 'завтра в 16:00 отбор по информатике'],
  ['мысль', 'идея: бот, который напоминает про дз'],
  ['поиск', 'найти конспект про дерево Фенвика'],
  ['дневник', 'в дневник: сегодня решил задачу, которую не мог неделю'],
];
const WHO_SAYS: Record<CompanionKind, string> = {
  elik: 'Элик поймал',
  proto: 'Прото разложит',
  neit: 'Нейт ищет',
  foti: 'Фоти бережёт',
};

export function Landing() {
  const ready = useFontReady();
  const width = useWidth();
  const { palette } = useLook();
  const pal = useRef(palette);
  useEffect(() => {
    pal.current = palette;
  }, [palette]);

  useEffect(() => {
    document.title = 'Qubite — мысль это точка';
    const on = () => (scroll.y = scrollY);
    on();
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);

  return (
    <div className="ld">
      <DotGrid />
      <Top />
      <main>
        <Hero ready={ready} width={width} pal={pal} />
        <Story ready={ready} width={width} pal={pal} />
        <CommandDemo ready={ready} width={width} pal={pal} />
        <Study ready={ready} width={width} pal={pal} />
        <Rules ready={ready} width={width} pal={pal} />
        <Final ready={ready} width={width} pal={pal} />
        <footer className="ld-foot">
          <DotText text="qubite" pitch={2.6} assemble={false} repel={0} label="Qubite" />
          <nav>
            <a href="#story">Как устроено</a>
            <a href="#command">Command</a>
            <a href="#study">Для учёбы</a>
            <Link to="/today">Приложение</Link>
            <Link to="/design">Дизайн-система</Link>
          </nav>
          <span className="c">
            © 2026 Qubite · <ServerStatus client={api} />
          </span>
        </footer>
      </main>
    </div>
  );
}

interface SceneProps {
  ready: boolean;
  width: number;
  pal: { current: ReturnType<typeof useLook>['palette'] };
}

/* ---------------------------------------------------------------- шапка */

function Top() {
  const { theme, set } = useLook();
  const bg = useRef<HTMLDivElement>(null);
  const press = usePress(0.86);
  const tb = useSpring(0, MASS.dot + 0.05, (x) => {
    if (bg.current) bg.current.style.opacity = Math.min(1, Math.max(0, x)).toFixed(3);
  });
  useEffect(
    () =>
      loop().tick(() => {
        const on = scroll.y > 40 ? 1 : 0;
        if (tb.goal !== on) loop().to(tb, on);
      }),
    [tb],
  );
  return (
    <header className="ld-top">
      <div className="ld-top-bg" ref={bg} />
      <a className="ld-mark" href="#" aria-label="Qubite">
        <DotText text="qubite" pitch={3.4} assemble={false} repel={0} label="Qubite" />
        <span className="q-dot" />
      </a>
      <nav className="ld-nav">
        <a href="#story">Как устроено</a>
        <a href="#command">Command</a>
        <a href="#study">Для учёбы</a>
      </nav>
      <div className="ld-auth">
        <button
          {...press}
          className="ld-theme"
          type="button"
          aria-label="Сменить тему"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            set('theme', theme === 'dark' ? 'light' : 'dark', {
              x: r.left + r.width / 2,
              y: r.top + r.height / 2,
            });
          }}
        >
          <i />
        </button>
        <Link className="ld-in" to="/auth">
          Войти
        </Link>
        <Link className="q-btn" to="/today">
          <span className="q-dot" />
          Начать
        </Link>
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------- первый экран */

const HINT = 'Проведи пальцем по буквам. А потом напиши что-нибудь и нажми Enter.';

function Hero({ ready, width, pal }: SceneProps) {
  const field = useRef<HTMLCanvasElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const legend = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const scene = useRef<HeroApi | null>(null);
  const [hint, setHint] = useState<ReactNode>(HINT);
  const shy = useRef(false);
  const send = usePress(0.84);

  useEffect(() => {
    if (!ready || !field.current || !copy.current || !legend.current) return;
    const s = hero(field.current, pal.current, scroll, {
      copy: copy.current,
      legend: legend.current,
    });
    scene.current = s;
    return () => {
      s.stop();
      scene.current = null;
    };
  }, [ready, width, pal]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    return typewriter(el, HERO_PHRASES, { reduced: loop().reduced });
  }, []);

  function onType() {
    const el = input.current;
    if (!el) return;
    focusOn(() => caretPoint(el));
    const secret = /парол/i.test(el.value);
    if (secret !== shy.current) {
      shy.current = secret;
      scene.current?.shy(secret);
      setHint(secret ? 'Помощники закрыли глаза — пароли не подсматривают.' : HINT);
    }
  }

  return (
    <section className="ld-hero">
      <canvas ref={field} className="ld-field" aria-hidden="true" />
      <h1 className="q-sr">Мысль — это точка.</h1>
      <div className="ld-copy" ref={copy}>
        <p className="ld-lead">
          Запиши её в Qubite. Из точек сложатся дела, конспекты и планы, а четыре помощника
          проследят, чтобы <b>ни одна не потерялась</b>.
        </p>
        <form
          className="q-command"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            const el = input.current;
            if (!el) return;
            const ph = (el.getAttribute('placeholder') ?? '').replace('▍', '').trim();
            const text = (el.value.trim() || ph || 'новая мысль').slice(0, 40);
            if (shy.current) {
              shy.current = false;
              scene.current?.shy(false);
            }
            const r = el.getBoundingClientRect();
            el.value = '';
            focusOn(null);
            el.blur();
            scene.current?.catchThought(text, { x: r.left, y: r.top }, () => {
              setHint(
                <>
                  <b>Элик поймал мысль</b> — одна точка во «Входящих».
                </>,
              );
              setTimeout(() => setHint(HINT), 4000);
            });
          }}
        >
          <span className="q-caret" aria-hidden="true" />
          <input
            ref={input}
            type="text"
            aria-label="Строка Command"
            placeholder="Запиши точку"
            onFocus={onType}
            onInput={onType}
            onKeyUp={onType}
            onBlur={() => focusOn(null)}
          />
          <button {...send} className="q-send" type="submit" aria-label="Отправить">
            <SendIcon />
          </button>
        </form>
        <p className="ld-hint" aria-live="polite">
          {hint}
        </p>
      </div>
      <div className="ld-legend" ref={legend}>
        <span>
          <i className="q-dot" style={{ background: 'var(--q-yellow)' }} />
          Элик ловит мысли
        </span>
        <span>
          <i className="q-dot" style={{ background: 'var(--q-ink)' }} />
          Прото ведёт дела
        </span>
        <span>
          <i className="q-dot" style={{ background: 'var(--q-sky)' }} />
          Нейт учит
        </span>
        <span>
          <i className="q-dot" style={{ background: 'var(--q-orange)' }} />
          Фоти бережёт личное
        </span>
      </div>
      <div className="ld-cue" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </section>
  );
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" className="q-ico" aria-hidden="true">
      {[
        [4, 10, 1.7],
        [8, 10, 1.7],
        [12, 10, 1.7],
        [16, 10, 1.7],
        [12, 6, 1.7],
        [12, 14, 1.7],
        [8.5, 3, 1.4],
        [8.5, 17, 1.4],
      ].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} />
      ))}
    </svg>
  );
}

/* ---------------------------------------------------------------- история */

function Story({ ready, width, pal }: SceneProps) {
  const sec = useRef<HTMLElement>(null);
  const field = useRef<HTMLCanvasElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const prev = useRef(-1);
  const springs = useRef<Spring[]>([]);
  /* полоска шагов: едет (translate) и тянется (scale) — две пружины, два свойства transform */
  const bx = useSpring(0, 0.9, (x) => {
    if (bar.current) bar.current.style.translate = `${x.toFixed(2)}px 0`;
  });
  const bw = useSpring(8, 0.9, (w) => {
    if (bar.current) bar.current.style.scale = `${(w / 8).toFixed(3)} 1`;
  });

  useEffect(() => {
    if (!ready || !field.current || !sec.current) return;
    prev.current = -1;
    return story(
      field.current,
      () => pal.current,
      sec.current,
      scroll,
      (s) => {
        const L = loop();
        const p = prev.current;
        const all = springs.current;
        if (p >= 0 && all[p]) L.to(all[p], s > p ? -1 : 1);
        if (all[s]) {
          L.set(all[s], s > p ? 1 : -1);
          L.to(all[s], 0);
        }
        L.kick(bw, 60);
        L.to(bx, s * 18);
        L.to(bw, 8);
        prev.current = s;
        setStep(s);
      },
    );
  }, [ready, width, pal, bx, bw]);

  return (
    <section className="ld-story" id="story" ref={sec} aria-label="Как устроен Qubite">
      <div className="ld-stage">
        <canvas ref={field} className="ld-field" aria-hidden="true" />
        <div className="ld-chapters">
          {CHAPTERS.map((c, i) => (
            <Chapter
              key={c.title}
              c={c}
              on={i === step}
              register={(s) => void (springs.current[i] = s)}
            />
          ))}
        </div>
        <div className="ld-steps" aria-hidden="true">
          <div className="ld-step-bar" ref={bar} />
          {CHAPTERS.map((c) => (
            <i key={c.title} />
          ))}
          <span>
            {step + 1} / {CHAPTERS.length}
          </span>
        </div>
      </div>
    </section>
  );
}

/** Текст шага: уезжает вверх или вниз и проявляется на месте. */
function Chapter({
  c,
  on,
  register,
}: {
  c: (typeof CHAPTERS)[number];
  on: boolean;
  register: (s: Spring) => void;
}) {
  const el = useRef<HTMLElement>(null);
  const s = useSpring(1, MASS.row, (x) => {
    if (!el.current) return;
    el.current.style.opacity = Math.min(1, Math.max(0, 1 - Math.abs(x))).toFixed(3);
    el.current.style.transform = `translateY(${(x * 28).toFixed(2)}px)`;
  });
  useEffect(() => register(s), [register, s]);
  return (
    <article className="ld-chapter" ref={el} aria-hidden={!on}>
      <h3>
        <span className="q-dot" style={{ background: `var(--q-${c.color})` }} />
        {c.title}
      </h3>
      <p>{c.body}</p>
    </article>
  );
}

/* ---------------------------------------------------------------- заголовок раздела из точек */

/** Собирается, когда раздел появляется на экране. */
function SecTitle({ text, label, ready }: { text: string; label: string; ready: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || seen || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => es[0]?.isIntersecting && setSeen(true), {
      threshold: 0.4,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  const phone = typeof innerWidth === 'number' && innerWidth < 760;
  const cols = ready ? textCells(text, 'Qubite Tiny5', 8).cols : 40;
  const pitch = phone ? Math.min(7, (innerWidth - 40) / Math.max(1, cols)) : 9;
  return (
    <div
      className="ld-title"
      ref={box}
      style={{ minHeight: pitch * (text.split('\n').length * 8) + 8 }}
    >
      <h2 className="q-sr">{label}</h2>
      {ready && seen && <DotText text={text} pitch={pitch} repel={30} label={label} />}
    </div>
  );
}

/** Появление блока при прокрутке: та же пружина, сдвиг снизу и прозрачность. */
function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const s = useSpring(0, MASS.row, (x) => {
    if (!el.current) return;
    el.current.style.opacity = Math.min(1, Math.max(0, x)).toFixed(3);
    el.current.style.transform = x === 1 ? '' : `translateY(${((1 - x) * 26).toFixed(2)}px)`;
  });
  useEffect(() => {
    const d = el.current;
    if (!d || typeof IntersectionObserver === 'undefined') {
      loop().set(s, 1);
      return;
    }
    let t: ReturnType<typeof setTimeout>;
    const io = new IntersectionObserver(
      (es) => {
        if (!es[0]?.isIntersecting) return;
        io.disconnect();
        t = setTimeout(() => loop().to(s, 1), delay);
      },
      { threshold: 0.2 },
    );
    io.observe(d);
    return () => {
      io.disconnect();
      clearTimeout(t);
    };
  }, [s, delay]);
  return (
    <div ref={el} className={['ld-reveal', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- Command: строка сама понимает */

function CommandDemo({ ready, width, pal }: SceneProps) {
  const cv = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const crew = useRef<MiniCrew | null>(null);
  const bg = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState<ParsedCommand | null>(() => parseCommand(DEMO_PHRASES[0]!));
  const [saved, setSaved] = useState(false);
  const curRef = useRef(cur);
  const send = usePress(0.84);
  /* карточка: подложка вырастает, содержимое проявляется следом */
  const sx = useSpring(1, MASS.pill, (x) => {
    if (bg.current)
      bg.current.style.transform = `scale(${(0.92 + x * 0.08).toFixed(4)}, ${Math.min(1.2, Math.max(0.2, x)).toFixed(4)})`;
  });
  const so = useSpring(1, MASS.dot + 0.05, (x) => {
    if (!inner.current) return;
    inner.current.style.opacity = Math.min(1, Math.max(0, x)).toFixed(3);
    inner.current.style.transform = `translateY(${((1 - x) * 10).toFixed(2)}px)`;
  });

  useEffect(() => {
    if (!ready || !cv.current) return;
    const m = miniCrew(cv.current, pal.current);
    crew.current = m;
    const k = curRef.current ? COMMAND_OWNER[curRef.current.kind] : 'elik';
    m.show(k, false);
    return () => {
      m.stop();
      crew.current = null;
    };
  }, [ready, width, pal]);

  function show(text: string) {
    const r = parseCommand(text);
    if (!r) return;
    const old = curRef.current;
    if (old && old.kind === r.kind && old.when === r.when) return;
    const swap = !old || COMMAND_OWNER[old.kind] !== COMMAND_OWNER[r.kind];
    curRef.current = r;
    setCur(r);
    setSaved(false);
    if (swap) {
      const L = loop();
      L.set(sx, 0.35);
      L.to(sx, 1);
      L.set(so, 0);
      L.to(so, 1);
    }
    crew.current?.show(COMMAND_OWNER[r.kind], swap);
  }

  /* пока поле пустое, карточка следует за подсказкой, которая печатает сама себя */
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const stop = typewriter(el, DEMO_PHRASES, { delay: 400, reduced: loop().reduced });
    const t = setInterval(() => {
      if (el.value) return;
      const ph = (el.getAttribute('placeholder') ?? '').replace('▍', '');
      if (DEMO_PHRASES.includes(ph)) show(ph);
    }, 160);
    return () => {
      stop();
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const owner = cur ? COMMAND_OWNER[cur.kind] : 'elik';
  return (
    <section className="ld-sec ld-wrap" id="command">
      <SecTitle text={'ОДНА СТРОКА\nНА ВСЁ'} label="Одна строка на всё" ready={ready} />
      <Reveal>
        <p className="ld-sec-lead">
          Command — нижняя строка Qubite. Пиши как думаешь: она сама поймёт, что это —{' '}
          <b>дело, мысль, поиск или запись в дневник</b>. На ПК открывается по <kbd>Ctrl</kbd>{' '}
          <kbd>K</kbd>.
        </p>
      </Reveal>
      <Reveal className="ld-demo">
        <form
          className="q-command"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            if (!cur) return;
            crew.current?.jump(owner);
            setSaved(true);
            if (input.current) {
              input.current.value = '';
              input.current.blur();
            }
          }}
        >
          <span className="q-caret" aria-hidden="true" />
          <input
            ref={input}
            type="text"
            aria-label="Попробуй строку Command"
            placeholder="Напиши что-нибудь"
            onInput={(e) => e.currentTarget.value.trim() && show(e.currentTarget.value)}
          />
          <button {...send} className="q-send" type="submit" aria-label="Сохранить">
            <SendIcon />
          </button>
        </form>
        <div className="ld-chips">
          {CHIPS.map(([label, text]) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                if (input.current) {
                  input.current.value = text;
                  input.current.focus();
                }
                show(text);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ld-result">
          <div className="ld-result-bg" ref={bg} />
          <div className="ld-result-in" ref={inner} role="status">
            <canvas ref={cv} aria-hidden="true" />
            {cur && (
              <div>
                <div className="ld-kind">
                  <span
                    className="q-dot"
                    style={{ background: `var(--q-${KIND_COLOR[cur.kind]})` }}
                  />
                  {cur.title}
                </div>
                <div className="ld-where">
                  {saved ? '✓ сохранено: ' : '→ '}
                  {cur.where}
                  {cur.kind === 'task' && (
                    <>
                      {' · '}
                      <b>{cur.when ?? 'без срока'}</b>
                    </>
                  )}
                </div>
              </div>
            )}
            <div className="ld-who">{WHO_SAYS[owner]}</div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

const KIND_COLOR = {
  task: 'ink',
  thought: 'yellow',
  search: 'sky',
  journal: 'orange',
  note: 'sky',
} as const;

/* ---------------------------------------------------------------- учёба */

function Study({ ready, width, pal }: SceneProps) {
  const sec = useRef<HTMLElement>(null);
  const field = useRef<HTMLCanvasElement>(null);
  const springs = useRef<Spring[]>([]);
  useEffect(() => {
    if (!ready || !field.current || !sec.current) return;
    return study(field.current, pal.current, sec.current, scroll, (pr) =>
      springs.current.forEach((s, i) => {
        const g = pr > 0.72 + i * 0.08 ? 1 : 0;
        if (s.goal !== g) loop().to(s, g);
      }),
    );
  }, [ready, width, pal]);
  const CARDS: [string, string][] = [
    ['Что такое парабола?', 'повторить завтра'],
    ['Вершина y = x²', 'через 3 дня'],
    ['Ветви вверх, если…', 'через неделю'],
  ];
  return (
    <section className="ld-study" id="study" ref={sec} aria-label="Для учёбы">
      <div className="ld-stage ld-wrap">
        <canvas ref={field} className="ld-field" aria-hidden="true" />
        <div className="ld-study-copy">
          <SecTitle text="ДЛЯ УЧЁБЫ" label="Для учёбы" ready={ready} />
          <Reveal>
            <p className="ld-sec-lead" style={{ marginBottom: 0 }}>
              Пиши стилусом на планшете в <b>Ink</b> — как в тетради, только страница бесконечная.
              Qubite найдёт формулу поиском, а Нейт сделает из конспекта{' '}
              <b>карточки для повторения</b>.
            </p>
          </Reveal>
          <div className="ld-cards">
            {CARDS.map(([b, t], i) => (
              <Card
                key={b}
                i={i}
                title={b}
                text={t}
                register={(s) => void (springs.current[i] = s)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Карточка повторения: вылетает снизу с лёгким поворотом. */
function Card({
  i,
  title,
  text,
  register,
}: {
  i: number;
  title: string;
  text: string;
  register: (s: Spring) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const s = useSpring(0, MASS.row, (x) => {
    if (!el.current) return;
    el.current.style.opacity = Math.min(1, Math.max(0, x)).toFixed(3);
    el.current.style.transform = `translateY(${((1 - x) * 30).toFixed(1)}px) rotate(${((1 - x) * (i - 1) * 6).toFixed(2)}deg)`;
  });
  useEffect(() => register(s), [register, s]);
  return (
    <div className="ld-card" ref={el}>
      <span className="q-dot" />
      <b>{title}</b>
      {text}
    </div>
  );
}

/* ---------------------------------------------------------------- принципы */

function Rules({ ready, pal }: SceneProps) {
  return (
    <section className="ld-sec ld-wrap" id="rules">
      <SecTitle text="ПО-ЧЕСТНОМУ" label="По-честному" ready={ready} />
      <div className="ld-rules">
        {RULES.map((r, i) => (
          <Reveal key={r.icon} className="ld-rule" delay={i * 90}>
            <RuleCanvas icon={r.icon} pal={pal} ready={ready} />
            <div>
              <h4>{r.title}</h4>
              <p>{r.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function RuleCanvas({
  icon,
  pal,
  ready,
}: {
  icon: RuleIcon;
  pal: SceneProps['pal'];
  ready: boolean;
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current;
    if (!c || !ready || typeof IntersectionObserver === 'undefined') return;
    let stop: (() => void) | null = null;
    const io = new IntersectionObserver(
      (es) => {
        if (stop || !es[0]?.isIntersecting) return;
        io.disconnect();
        stop = ruleIcon(c, pal.current, icon);
      },
      { threshold: 0.5 },
    );
    io.observe(c);
    return () => {
      io.disconnect();
      stop?.();
    };
  }, [icon, pal, ready]);
  return <canvas ref={cv} aria-hidden="true" />;
}

/* ---------------------------------------------------------------- финал */

function Final({ ready, width, pal }: SceneProps) {
  const cv = useRef<HTMLCanvasElement>(null);
  const acts = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = cv.current;
    const a = acts.current;
    if (!c || !a || !ready || typeof IntersectionObserver === 'undefined') return;
    let stop: (() => void) | null = null;
    const io = new IntersectionObserver(
      (es) => {
        if (stop || !es[0]?.isIntersecting) return;
        io.disconnect();
        stop = final(c, pal.current, a);
      },
      { threshold: 0.35 },
    );
    io.observe(c);
    return () => {
      io.disconnect();
      stop?.();
    };
  }, [ready, width, pal]);
  return (
    <section className="ld-final">
      <canvas ref={cv} className="ld-field" aria-hidden="true" />
      <h2 className="q-sr">Начни с одной точки</h2>
      <div className="ld-final-acts" ref={acts}>
        <Link className="q-btn q-fill" to="/today">
          <span className="q-dot" />
          Начать
        </Link>
        <Link className="q-btn" to="/today">
          Посмотреть приложение
        </Link>
      </div>
    </section>
  );
}
