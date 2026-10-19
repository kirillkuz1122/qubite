/**
 * Разбор строки Command без AI (CMD-003) — тот же, что на сервере.
 *
 * **Источник правды — Rust:** `crates/qubite-parse/src/lib.rs`. Этот файл — его перевод слово в слово,
 * чтобы подсказка «куда ляжет» работала без сети. Расхождения ловят общие файлы
 * `crates/qubite-parse/fixtures/examples.json` (фразы и ожидаемый результат) и `golden.json`
 * (сотни сочетаний и ответ Rust) — их проверяет `parse.test.ts`. Меняешь правило — меняй в обоих.
 */

/* ---------------------------------------------------------------- календарь */

const div = (a: number, b: number) => Math.floor(a / b);
const mod = (a: number, b: number) => ((a % b) + b) % b;
/** Деление с отбрасыванием к нулю — как `/` для целых в Rust. */
const quot = (a: number, b: number) => Math.trunc(a / b);

/** Номер дня от 1970-01-01. */
function daysFromCivil(y0: number, m: number, d: number): number {
  const y = m <= 2 ? y0 - 1 : y0;
  const era = quot(y >= 0 ? y : y - 399, 400);
  const yoe = y - era * 400;
  const mp = (m + 9) % 12;
  const doy = quot(153 * mp + 2, 5) + d - 1;
  const doe = yoe * 365 + quot(yoe, 4) - quot(yoe, 100) + doy;
  return era * 146_097 + doe - 719_468;
}

function civilFromDays(z0: number): [number, number, number] {
  const z = z0 + 719_468;
  const era = quot(z >= 0 ? z : z - 146_096, 146_097);
  const doe = z - era * 146_097;
  const yoe = quot(doe - quot(doe, 1460) + quot(doe, 36_524) - quot(doe, 146_096), 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + quot(yoe, 4) - quot(yoe, 100));
  const mp = quot(5 * doy + 2, 153);
  const d = doy - quot(153 * mp + 2, 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [m <= 2 ? y + 1 : y, m, d];
}

/** 1 — понедельник … 7 — воскресенье. */
const weekday = (day: number) => (((day % 7) + 7 + 3) % 7) + 1;

function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function addMonths(day: number, n: number): number {
  const [y, m, d] = civilFromDays(day);
  const total = y * 12 + (m - 1) + n;
  const ny = div(total, 12);
  const nm = mod(total, 12) + 1;
  return daysFromCivil(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** «Сейчас» у человека: местные дата и время. */
export interface LocalNow {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** `2026-10-19T13:05` → время для разбора; неверная строка — null. */
export function localNowFromIso(s: string): LocalNow | null {
  const num = (a: number, b: number) => {
    const part = s.slice(a, b);
    return /^\d+$/.test(part) ? Number(part) : NaN;
  };
  const now = {
    year: num(0, 4),
    month: num(5, 7),
    day: num(8, 10),
    hour: num(11, 13),
    minute: num(14, 16),
  };
  if (Object.values(now).some(Number.isNaN)) return null;
  const ok =
    now.month >= 1 &&
    now.month <= 12 &&
    now.day >= 1 &&
    now.day <= daysInMonth(now.year, now.month) &&
    now.hour < 24 &&
    now.minute < 60;
  return ok ? now : null;
}

/** Местное время устройства. */
export function localNow(d = new Date()): LocalNow {
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
  };
}

const nowDay = (n: LocalNow) => daysFromCivil(n.year, n.month, n.day);
const nowMinutes = (n: LocalNow) => n.hour * 60 + n.minute;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function isoDate(day: number): string {
  const [y, m, d] = civilFromDays(day);
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}
const hhmm = (minutes: number) => `${pad(div(minutes, 60))}:${pad(minutes % 60)}`;

/* ---------------------------------------------------------------- результат */

export type ParseKind = 'task' | 'note' | 'thought' | 'search' | 'journal' | 'bookmark';
export type ParseCommandWord =
  'task' | 'thought' | 'note' | 'summary' | 'journal' | 'search' | 'remind';
export type Every = 'day' | 'week' | 'month' | 'year';

export interface Due {
  /** `2026-10-23` */
  date: string;
  /** `18:00`; null — весь день */
  time: string | null;
}

export interface Repeat {
  every: Every;
  interval: number;
  /** дни недели 1…7 (только для `week`) */
  days: number[];
}

/** Результат разбора — те же поля и значения, что у Rust (`qubite_parse::Parsed`). */
export interface Parsed {
  kind: ParseKind;
  command: ParseCommandWord | null;
  title: string;
  due: Due | null;
  repeat: Repeat | null;
  duration_min: number | null;
  project: string | null;
  /** 0 — обычное, 1 — `!`, 2 — `!!` или «срочно» */
  priority: number;
  remind: boolean;
  shopping: boolean;
  url: string | null;
  /** нашлось ли хоть что-то; нет — просто мысль */
  recognized: boolean;
  /** 0…1; ниже 0,7 — «посмотри сам» (D-199) */
  confidence: number;
  review: string | null;
  /** «завтра, 18:00», «каждый вт, 18:00» */
  when: string | null;
  /** «Дело: повторить графы · завтра, 18:00 · #алгебра» */
  summary: string;
}

/* ---------------------------------------------------------------- словарь */

const MONTHS: string[][] = [
  ['января', 'янв'],
  ['февраля', 'фев'],
  ['марта', 'мар'],
  ['апреля', 'апр'],
  ['мая'],
  ['июня', 'июн'],
  ['июля', 'июл'],
  ['августа', 'авг'],
  ['сентября', 'сен', 'сент'],
  ['октября', 'окт'],
  ['ноября', 'ноя', 'нояб'],
  ['декабря', 'дек'],
];
const MONTH_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];
const WEEKDAYS: string[][] = [
  ['понедельник'],
  ['вторник'],
  ['среда', 'среду'],
  ['четверг'],
  ['пятница', 'пятницу'],
  ['суббота', 'субботу'],
  ['воскресенье'],
];
const WEEKDAYS_GEN = [
  'понедельника',
  'вторника',
  'среды',
  'четверга',
  'пятницы',
  'субботы',
  'воскресенья',
];
const WEEKDAYS_DAT = [
  'понедельнику',
  'вторнику',
  'среде',
  'четвергу',
  'пятнице',
  'субботе',
  'воскресенью',
];
const WEEKDAYS_PLURAL = [
  'понедельникам',
  'вторникам',
  'средам',
  'четвергам',
  'пятницам',
  'субботам',
  'воскресеньям',
];
const WEEKDAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const EVERY_WEEKDAY = ['каждый', 'каждый', 'каждую', 'каждый', 'каждую', 'каждую', 'каждое'];

const NUMBERS: Record<string, number> = {
  один: 1,
  одна: 1,
  одну: 1,
  одного: 1,
  два: 2,
  две: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
  пятнадцать: 15,
  двадцать: 20,
  тридцать: 30,
  сорок: 40,
  пару: 2,
  пара: 2,
};

const TASK_VERBS = new Set([
  'сделать',
  'сделай',
  'купить',
  'купи',
  'позвонить',
  'позвони',
  'написать',
  'напиши',
  'прочитать',
  'прочитай',
  'сдать',
  'сдай',
  'решить',
  'реши',
  'повторить',
  'повтори',
  'отправить',
  'отправь',
  'подготовить',
  'подготовь',
  'выучить',
  'выучи',
  'починить',
  'оплатить',
  'оплати',
  'записаться',
  'забрать',
  'забери',
  'заказать',
  'закажи',
  'убрать',
  'помыть',
  'проверить',
  'проверь',
  'спросить',
  'спроси',
  'договориться',
  'встретить',
  'доделать',
  'посмотреть',
]);

const NOT_TIME = ['класс', 'кабинет', 'лет', 'год', 'раз', 'шт', 'рубл', '%'];
const PREP_DATE = ['в', 'во', 'на', 'к', 'до', 'с'];
const PREP_TIME = ['в', 'к', 'до', 'с'];

type Unit = 'min' | 'hour' | 'day' | 'week' | 'month' | 'year';

const UNITS: Record<string, Unit> = {
  мин: 'min',
  минута: 'min',
  минуту: 'min',
  минуты: 'min',
  минут: 'min',
  ч: 'hour',
  час: 'hour',
  часа: 'hour',
  часов: 'hour',
  день: 'day',
  дня: 'day',
  дней: 'day',
  сутки: 'day',
  суток: 'day',
  неделя: 'week',
  неделю: 'week',
  недели: 'week',
  недель: 'week',
  нед: 'week',
  месяц: 'month',
  месяца: 'month',
  месяцев: 'month',
  мес: 'month',
  год: 'year',
  года: 'year',
  лет: 'year',
};
const unit = (w: string): Unit | null => (Object.hasOwn(UNITS, w) ? UNITS[w]! : null);

function int(w: string): number | null {
  if (!w || w.length > 4 || !/^[0-9]+$/.test(w)) return null;
  return Number(w);
}

const number = (w: string): number | null =>
  int(w) ?? (Object.hasOwn(NUMBERS, w) ? NUMBERS[w]! : null);

function monthOf(w: string): number | null {
  const i = MONTHS.findIndex((forms) => forms.includes(w));
  return i >= 0 ? i + 1 : null;
}

function weekdayOf(w: string, prep: string): number | null {
  const at = (list: string[]) => {
    const i = list.indexOf(w);
    return i >= 0 ? i + 1 : null;
  };
  const i = WEEKDAYS.findIndex((forms) => forms.includes(w));
  if (i >= 0) return i + 1;
  if (prep === 'до' || prep === 'с') return at(WEEKDAYS_GEN) ?? at(WEEKDAY_SHORT);
  if (prep === 'к') return at(WEEKDAYS_DAT) ?? at(WEEKDAY_SHORT);
  if (prep === '') return null;
  return at(WEEKDAY_SHORT);
}

/** «18:30» → минуты от полуночи. */
function clock(w: string, sep: string): number | null {
  const k = w.indexOf(sep);
  if (k < 0) return null;
  const h = int(w.slice(0, k));
  const m = int(w.slice(k + 1));
  if (h === null || m === null || h > 24 || m > 59 || w.length - k !== 3) return null;
  return (h % 24) * 60 + m;
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word =
    m10 === 1 && m100 !== 11
      ? one
      : m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)
        ? few
        : many;
  return `${n} ${word}`;
}

const EDGE = new Set([',', '.', ';', ':', '!', '?', '(', ')', '«', '»', '"', "'", '—', '–']);
const TITLE_EDGE = new Set([',', '.', ';', ':', '—', '-', '–', '?', '!']);

function trimBy(s: string, drop: (c: string) => boolean): string {
  const cs = Array.from(s);
  let a = 0;
  let b = cs.length;
  while (a < b && drop(cs[a]!)) a++;
  while (b > a && drop(cs[b - 1]!)) b--;
  return cs.slice(a, b).join('');
}
const trimEdge = (s: string) => trimBy(s, (c) => EDGE.has(c));
const lowWord = (s: string) => trimEdge(s).toLowerCase().replace(/ё/g, 'е');

/* ---------------------------------------------------------------- разбор */

interface Token {
  orig: string;
  low: string;
}

class Parser {
  used: boolean[];
  dates: number[] = [];
  times: [number, boolean][] = [];
  guessed = false;
  part: number | null = null;
  past = false;
  repeat: Repeat | null = null;
  duration: number | null = null;
  projects: string[] = [];
  priority = 0;
  url: string | null = null;

  constructor(
    readonly toks: Token[],
    readonly now: LocalNow,
  ) {
    this.used = toks.map(() => false);
  }

  w(i: number): string {
    const t = this.toks[i];
    return t && !this.used[i] ? t.low : '';
  }

  date(day: number) {
    if (!this.dates.includes(day)) this.dates.push(day);
  }

  nextWeekday(wd: number): number {
    let d = nowDay(this.now) + 1;
    while (weekday(d) !== wd) d++;
    return d;
  }

  tryAt(i: number): number {
    const matchers = [
      this.mUrl,
      this.mProject,
      this.mPriority,
      this.mRepeat,
      this.mAfter,
      this.mDuration,
      this.mDayWord,
      this.mWeekend,
      this.mWeekday,
      this.mDayMonth,
      this.mNumericDate,
      this.mTime,
      this.mPartOfDay,
    ];
    for (const m of matchers) {
      const n = m.call(this, i);
      if (n > 0) return n;
    }
    return 0;
  }

  mUrl(i: number): number {
    const orig = this.toks[i]!.orig;
    if (
      !(orig.startsWith('https://') || orig.startsWith('http://')) ||
      Array.from(orig).length < 10
    )
      return 0;
    const url = orig.replace(/[,.;)!?]+$/, '');
    this.url ??= url;
    return 1;
  }

  mProject(i: number): number {
    const orig = this.toks[i]!.orig;
    if (!orig.startsWith('#')) return 0;
    const name = trimEdge(orig.slice(1)).toLowerCase().replace(/ё/g, 'е');
    if (!name || name.startsWith('#')) return 0;
    if (!this.projects.includes(name)) this.projects.push(name);
    return 1;
  }

  mPriority(i: number): number {
    const orig = this.toks[i]!.orig;
    if (orig && /^!+$/.test(orig)) {
      this.priority = Math.max(this.priority, orig.length === 1 ? 1 : 2);
      return 1;
    }
    if (this.w(i) === 'срочно') {
      this.priority = 2;
      return 1;
    }
    return 0;
  }

  mRepeat(i: number): number {
    const w = this.w(i);
    const simple = (every: Every): Repeat => ({ every, interval: 1, days: [] });
    let repeat: Repeat;
    let n: number;
    if (w === 'ежедневно') [repeat, n] = [simple('day'), 1];
    else if (w === 'еженедельно') [repeat, n] = [simple('week'), 1];
    else if (w === 'ежемесячно') [repeat, n] = [simple('month'), 1];
    else if (w === 'по') {
      const next = this.w(i + 1);
      let days: number[];
      if (next === 'будням') days = [1, 2, 3, 4, 5];
      else if (next === 'выходным') days = [6, 7];
      else {
        const d = WEEKDAYS_PLURAL.indexOf(next);
        if (d < 0) return 0;
        days = [d + 1];
      }
      repeat = { every: 'week', interval: 1, days };
      n = 2;
      n += this.moreWeekdays(i + n, repeat.days, true);
    } else if (['каждый', 'каждую', 'каждое', 'каждые', 'каждого'].includes(w)) {
      const next = this.w(i + 1);
      const count = number(next);
      const wd = weekdayOf(next, 'в');
      if (count !== null) {
        const u = unit(this.w(i + 2));
        if (u !== 'day' && u !== 'week' && u !== 'month' && u !== 'year') return 0;
        repeat = { every: u, interval: Math.max(count, 1), days: [] };
        n = 3;
      } else if (next === 'будний' && this.w(i + 2) === 'день') {
        repeat = { every: 'week', interval: 1, days: [1, 2, 3, 4, 5] };
        n = 3;
      } else if (next === 'утро' || next === 'вечер') {
        this.part ??= next === 'утро' ? 9 * 60 : 19 * 60;
        repeat = simple('day');
        n = 2;
      } else if (wd !== null) {
        repeat = { every: 'week', interval: 1, days: [wd] };
        n = 2;
        n += this.moreWeekdays(i + n, repeat.days, false);
      } else {
        const u = unit(next);
        if (u !== 'day' && u !== 'week' && u !== 'month' && u !== 'year') return 0;
        repeat = simple(u);
        n = 2;
      }
    } else return 0;
    if (!this.repeat) {
      repeat.days = [...new Set(repeat.days)].sort((a, b) => a - b);
      this.repeat = repeat;
    }
    return n;
  }

  moreWeekdays(i0: number, days: number[], pluralForm: boolean): number {
    let i = i0;
    for (;;) {
      const joined = this.w(i) === 'и';
      const at = joined ? i + 1 : i;
      const w = this.w(at);
      let day: number | null;
      if (pluralForm) {
        const d = WEEKDAYS_PLURAL.indexOf(w);
        day = d >= 0 ? d + 1 : null;
      } else day = weekdayOf(w, 'в');
      const comma = at > 0 && (this.toks[at - 1]?.orig.endsWith(',') ?? false);
      if (day !== null && (joined || comma)) {
        days.push(day);
        i = at + 1;
      } else return i - i0;
    }
  }

  /** Сколько: число, слово, «полтора»; без числа — один («через час»). */
  amount(i: number): [number, boolean, number] | null {
    const w = this.w(i);
    const n = number(w);
    if (n !== null) return [n, false, 1];
    if (w === 'полтора' || w === 'полторы') return [1, true, 1];
    return unit(w) ? [1, false, 0] : null;
  }

  mAfter(i: number): number {
    if (this.w(i) !== 'через') return 0;
    if (this.w(i + 1) === 'полчаса') {
      this.relativeMinutes(30);
      return 2;
    }
    const a = this.amount(i + 1);
    if (!a) return 0;
    const [n, half, used] = a;
    const u = unit(this.w(i + 1 + used));
    if (!u) return 0;
    const today = nowDay(this.now);
    if (u === 'min') this.relativeMinutes(n);
    else if (u === 'hour') this.relativeMinutes(n * 60 + (half ? 30 : 0));
    else if (u === 'day') this.date(today + n);
    else if (u === 'week') this.date(today + 7 * n);
    else if (u === 'month') this.date(addMonths(today, n));
    else this.date(addMonths(today, 12 * n));
    return 2 + used;
  }

  relativeMinutes(n: number) {
    const total = nowMinutes(this.now) + n;
    this.date(nowDay(this.now) + div(total, 1440));
    this.times.push([mod(total, 1440), false]);
  }

  mDuration(i: number): number {
    if (this.w(i) !== 'на') return 0;
    if (this.w(i + 1) === 'полчаса') {
      this.duration = 30;
      return 2;
    }
    const a = this.amount(i + 1);
    if (!a) return 0;
    const [n, half, used] = a;
    const u = unit(this.w(i + 1 + used));
    let minutes: number;
    if (u === 'min' && !half) minutes = n;
    else if (u === 'hour') minutes = n * 60 + (half ? 30 : 0);
    else return 0;
    if (minutes <= 0) return 0;
    this.duration = minutes;
    return 2 + used;
  }

  prep(i: number, set: string[]): number {
    return set.includes(this.w(i)) ? 1 : 0;
  }

  mDayWord(i: number): number {
    const p = this.prep(i, PREP_DATE);
    const w = this.w(i + p);
    const shift = w === 'сегодня' ? 0 : w === 'завтра' ? 1 : w === 'послезавтра' ? 2 : -1;
    if (shift < 0) return 0;
    this.date(nowDay(this.now) + shift);
    return p + 1;
  }

  mWeekend(i: number): number {
    const [a, b, c] = [this.w(i), this.w(i + 1), this.w(i + 2)];
    const today = nowDay(this.now);
    if ((a === 'на' && b === 'выходных') || (a === 'в' && b === 'выходные')) {
      this.date(weekday(today) >= 6 ? today : this.nextWeekday(6));
      return 2;
    }
    if (a === 'на' && b === 'следующей' && c === 'неделе') {
      this.date(today + 8 - weekday(today));
      return 3;
    }
    return 0;
  }

  mWeekday(i: number): number {
    const p = this.prep(i, PREP_DATE);
    const prep = p > 0 ? this.w(i) : '';
    let at = i + p;
    const next = ['следующий', 'следующую', 'следующее', 'следующей', 'следующего'].includes(
      this.w(at),
    );
    const isThis = ['этот', 'эту', 'это', 'этой', 'этого'].includes(this.w(at));
    if (next || isThis) at++;
    const wd = weekdayOf(this.w(at), prep);
    if (wd === null) return 0;
    const today = nowDay(this.now);
    let d = this.nextWeekday(wd);
    if (isThis && weekday(today) === wd) d = today;
    if (next && d - today < 8 - weekday(today)) d += 7;
    this.date(d);
    return at + 1 - i;
  }

  upcoming(y: number | null, m: number, d: number): boolean {
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const today = nowDay(this.now);
    let day: number;
    if (y !== null) {
      if (d > daysInMonth(y, m)) return false;
      day = daysFromCivil(y, m, d);
    } else {
      let found: number | null = null;
      for (let year = this.now.year; year < this.now.year + 8; year++) {
        if (d > daysInMonth(year, m)) continue;
        const cand = daysFromCivil(year, m, d);
        if (cand >= today) {
          found = cand;
          break;
        }
      }
      if (found === null) return false;
      day = found;
    }
    if (day < today) this.past = true;
    this.date(day);
    return true;
  }

  mDayMonth(i: number): number {
    const p = this.prep(i, PREP_DATE);
    const d = int(this.w(i + p));
    if (d === null) return 0;
    const w = this.w(i + p + 1);
    if (w === 'числа') {
      const today = nowDay(this.now);
      const [y, m] = civilFromDays(today);
      if (d < 1 || d > 31) return 0;
      let day = daysFromCivil(y, m, Math.min(d, daysInMonth(y, m)));
      if (day < today) {
        const [ny, nm] = civilFromDays(addMonths(daysFromCivil(y, m, 1), 1));
        day = daysFromCivil(ny, nm, Math.min(d, daysInMonth(ny, nm)));
      }
      this.date(day);
      return p + 2;
    }
    const m = monthOf(w);
    if (m === null) return 0;
    let n = p + 2;
    const yv = int(this.w(i + n));
    const year = yv !== null && yv >= 2000 && yv <= 2100 ? yv : null;
    if (year !== null) {
      n++;
      if (this.w(i + n) === 'года' || this.w(i + n) === 'г') n++;
    }
    if (!this.upcoming(year, m, d)) return 0;
    return n;
  }

  mNumericDate(i: number): number {
    const p = this.prep(i, PREP_DATE);
    const parts = this.w(i + p).split('.');
    if (parts.length < 2 || parts.length > 3 || parts[0]!.length > 2 || parts[1]!.length !== 2)
      return 0;
    const d = int(parts[0]!);
    const m = int(parts[1]!);
    if (d === null || m === null) return 0;
    let year: number | null = null;
    if (parts.length === 3) {
      if (parts[2]!.length !== 4) return 0;
      year = int(parts[2]!) ?? 0;
    }
    if ((year !== null && (year < 2000 || year > 2100)) || !this.upcoming(year, m, d)) return 0;
    return p + 1;
  }

  mTime(i: number): number {
    const p = this.prep(i, PREP_TIME);
    const from = p > 0 && this.w(i) === 'с';
    const w = this.w(i + p);
    if (p > 0 && (w === 'полдень' || w === 'полночь')) {
      this.times.push([w === 'полдень' ? 720 : 0, from]);
      return 2;
    }
    let minutes = clock(w, ':');
    if (minutes === null && p > 0) minutes = clock(w, '.');
    const explicit = minutes !== null;
    if (minutes === null) {
      const h = int(w);
      minutes = h !== null && h <= 24 ? (h % 24) * 60 : null;
    }
    if (minutes === null) return 0;
    let n = p + 1;
    const q = this.w(i + n);
    let qualified = true;
    if (q === 'утра') {
      if (minutes >= 720) minutes -= 720;
    } else if (q === 'дня' || q === 'вечера') {
      if (minutes < 720) minutes += 720;
    } else if (q === 'ночи') {
      if (minutes === 720) minutes = 0;
    } else qualified = false;
    if (qualified) n++;
    else if (q === 'часов' || q === 'часа' || q === 'час' || q === 'ч') {
      n++;
      const after = this.w(i + n);
      if (!explicit && p === 0 && !['утра', 'дня', 'вечера', 'ночи'].includes(after)) {
        if (minutes < 7 * 60) return 0;
      }
      if (after === 'утра') {
        if (minutes >= 720) minutes -= 720;
        n++;
      } else if (after === 'дня' || after === 'вечера') {
        if (minutes < 720) minutes += 720;
        n++;
      }
    } else if (!explicit) {
      if (
        p === 0 ||
        NOT_TIME.some((s) => q.startsWith(s)) ||
        monthOf(q) !== null ||
        (from && q !== 'до')
      )
        return 0;
      if (minutes >= 60 && minutes < 7 * 60) {
        minutes += 720;
        this.guessed = true;
      }
    }
    this.times.push([minutes, from]);
    return n;
  }

  mPartOfDay(i: number): number {
    const w = this.w(i);
    const minutes =
      w === 'утром'
        ? 9 * 60
        : w === 'днем'
          ? 13 * 60
          : w === 'вечером'
            ? 19 * 60
            : w === 'ночью'
              ? 23 * 60
              : -1;
    if (minutes < 0) return 0;
    this.part ??= minutes;
    return 1;
  }
}

function commandAtStart(toks: Token[]): [ParseCommandWord, number] | null {
  const low = (i: number) => toks[i]?.low ?? '';
  const colon = (i: number) => toks[i]?.orig.endsWith(':') ?? false;
  const first = low(0);
  const slash: Record<string, ParseCommandWord> = {
    '/д': 'task',
    '/м': 'thought',
    '/к': 'summary',
    '/з': 'journal',
    '/п': 'search',
    '/н': 'note',
  };
  const s = toks[0]?.orig.toLowerCase() ?? '';
  if (Object.hasOwn(slash, s)) return [slash[s]!, 1];
  if (
    (first === 'в' && low(1) === 'дневник') ||
    (first === 'запись' && low(1) === 'в' && low(2) === 'дневник')
  )
    return ['journal', first === 'в' ? 2 : 3];
  const withColon: Record<string, ParseCommandWord> = {
    дело: 'task',
    задача: 'task',
    мысль: 'thought',
    идея: 'thought',
    заметка: 'note',
    дневник: 'journal',
    поиск: 'search',
  };
  if (Object.hasOwn(withColon, first)) return colon(0) ? [withColon[first]!, 1] : null;
  if (first === 'напомни' || first === 'напомнить') {
    let n = 1;
    if (low(n) === 'мне') n++;
    if (['про', 'о', 'об'].includes(low(n))) n++;
    return ['remind', n];
  }
  if (first === 'найди' || first === 'найти') return ['search', 1];
  if (first === 'конспект') return ['summary', 1];
  return null;
}

function dateLabel(day: number, now: LocalNow): string {
  const diff = day - nowDay(now);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === 2) return 'послезавтра';
  const [y, m, d] = civilFromDays(day);
  const wd = WEEKDAY_SHORT[weekday(day) - 1]!;
  const mon = MONTH_SHORT[m - 1]!;
  return y === now.year ? `${wd}, ${d} ${mon}` : `${wd}, ${d} ${mon} ${y}`;
}

const clockLabel = (minutes: number) => `${div(minutes, 60)}:${pad(minutes % 60)}`;

function repeatLabel(r: Repeat): string {
  const days = r.days.join(',');
  switch (r.every) {
    case 'day':
      return r.interval === 1
        ? 'каждый день'
        : `каждые ${plural(r.interval, 'день', 'дня', 'дней')}`;
    case 'week':
      if (days === '1,2,3,4,5') return 'по будням';
      if (days === '6,7') return 'по выходным';
      if (r.days.length === 1) {
        const d = r.days[0]! - 1;
        return `${EVERY_WEEKDAY[d]} ${WEEKDAY_SHORT[d]}`;
      }
      if (r.days.length) return `по ${r.days.map((d) => WEEKDAY_SHORT[d - 1]).join(', ')}`;
      return r.interval === 1
        ? 'каждую неделю'
        : `каждые ${plural(r.interval, 'неделю', 'недели', 'недель')}`;
    case 'month':
      return r.interval === 1
        ? 'каждый месяц'
        : `каждые ${plural(r.interval, 'месяц', 'месяца', 'месяцев')}`;
    case 'year':
      return r.interval === 1 ? 'каждый год' : `каждые ${plural(r.interval, 'год', 'года', 'лет')}`;
  }
}

/** «Дело», «Напоминание», «Покупка», «Конспект»… — первое слово сводки. */
export function labelOf(p: Pick<Parsed, 'kind' | 'command' | 'shopping'>): string {
  if (p.kind === 'task')
    return p.command === 'remind' ? 'Напоминание' : p.shopping ? 'Покупка' : 'Дело';
  if (p.kind === 'note') return p.command === 'summary' ? 'Конспект' : 'Заметка';
  return { thought: 'Мысль', search: 'Поиск', journal: 'Дневник', bookmark: 'Закладка' }[p.kind];
}

/** «30 мин», «1 ч 30 мин». */
export function durationLabel(minutes: number): string {
  const h = div(minutes, 60);
  const m = minutes % 60;
  if (h === 0) return `${m} мин`;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

/** Разобрать строку. Пустая строка — null. */
export function parse(input: string, now: LocalNow): Parsed | null {
  const raw = input.trim();
  if (!raw) return null;
  const toks: Token[] = raw.split(/\s+/).map((orig) => ({ orig, low: lowWord(orig) }));
  const command = commandAtStart(toks);
  const start = command ? command[1] : 0;
  const p = new Parser(toks, now);
  for (let k = 0; k < start; k++) p.used[k] = true;
  const cmd = command ? command[0] : null;
  const question = cmd === null && raw.endsWith('?');
  const literal = question || cmd === 'search' || cmd === 'journal';
  let i = literal ? toks.length : start;
  while (i < toks.length) {
    if (p.used[i]) {
      i++;
      continue;
    }
    const n = p.tryAt(i);
    if (n === 0) {
      i++;
      continue;
    }
    for (let k = i; k < Math.min(i + n, toks.length); k++) p.used[k] = true;
    i += n;
  }

  const title = trimBy(
    toks
      .filter((_, k) => !p.used[k])
      .map((t) => t.orig)
      .join(' '),
    (c) => /\s/.test(c) || TITLE_EDGE.has(c),
  );
  const firstWord = lowWord(title.split(/\s+/)[0] ?? '');
  const shopping = firstWord === 'купить' || firstWord === 'купи';
  const verb = TASK_VERBS.has(firstWord);

  let time: number | null = p.times[0]?.[0] ?? null;
  let timesConflict = false;
  const [t0, t1] = p.times;
  if (t0 && t1 && t0[1] && !t1[1]) {
    if (t1[0] > t0[0] && p.duration === null) p.duration = t1[0] - t0[0];
  } else if (p.times.length > 1 && p.times.some(([m]) => m !== time)) timesConflict = true;
  if (time === null && p.part !== null) time = p.part;
  else if (time !== null && p.part !== null && p.part >= 720 && time < 720) time += 720;
  else if (time !== null && p.part !== null && p.part < 720 && p.guessed && time >= 720) {
    time -= 720;
    p.guessed = false;
  }

  const hasWhen = p.dates.length > 0 || time !== null || p.repeat !== null;
  let kind: ParseKind;
  if (cmd === 'task' || cmd === 'remind') kind = 'task';
  else if (cmd === 'thought') kind = 'thought';
  else if (cmd === 'note' || cmd === 'summary') kind = 'note';
  else if (cmd === 'journal') kind = 'journal';
  else if (cmd === 'search') kind = 'search';
  else if (question) kind = 'search';
  else if (p.url !== null && !hasWhen) kind = 'bookmark';
  else if (hasWhen || p.duration !== null || p.priority > 0 || verb) kind = 'task';
  else kind = 'thought';

  const today = nowDay(now);
  let date: number | null = p.dates[0] ?? null;
  const r = p.repeat;
  if (date === null && r) {
    const late = time !== null && time <= nowMinutes(now);
    let d = late ? today + 1 : today;
    if (r.every === 'week' && r.days.length) while (!r.days.includes(weekday(d))) d++;
    date = d;
  }
  if (date === null && time !== null) date = time > nowMinutes(now) ? today : today + 1;
  const due: Due | null =
    date === null ? null : { date: isoDate(date), time: time === null ? null : hhmm(time) };

  let confidence: number;
  if (cmd !== null) confidence = 0.95;
  else if (kind === 'search') confidence = 0.85;
  else if (kind === 'bookmark') confidence = 0.9;
  else if (kind === 'task') confidence = hasWhen ? 0.9 : 0.8;
  else confidence = p.projects.length ? 0.75 : 0.5;
  if (p.guessed) confidence = Math.min(confidence, 0.85);
  let review: string | null = null;
  if (p.dates.length > 1)
    review = `Два срока: «${dateLabel(p.dates[0]!, now)}» и «${dateLabel(p.dates[1]!, now)}» — какой верный?`;
  else if (timesConflict)
    review = `Два времени: ${clockLabel(p.times[0]![0])} и ${clockLabel(p.times[1]![0])} — какое верное?`;
  else if (p.projects.length > 1)
    review = `Два проекта: #${p.projects[0]} и #${p.projects[1]} — к какому?`;
  else if (cmd === 'remind' && due === null) review = 'Когда напомнить? Срок не нашёл';
  else if (p.past && kind === 'task') review = 'Срок уже прошёл — проверь дату';
  else if (!title && (kind === 'task' || kind === 'note') && p.url === null)
    review = 'Есть срок, но не понял, что сделать';
  if (review !== null) confidence = 0.6;
  const recognized = cmd !== null || kind !== 'thought' || p.projects.length > 0;

  let when: string | null = null;
  if (r) when = time !== null ? `${repeatLabel(r)}, ${clockLabel(time)}` : repeatLabel(r);
  else if (date !== null)
    when = time !== null ? `${dateLabel(date, now)}, ${clockLabel(time)}` : dateLabel(date, now);

  const label = labelOf({ kind, command: cmd, shopping: shopping && kind === 'task' });
  const shownTitle = title || (p.url ?? '');
  let summary = shownTitle ? `${label}: ${shownTitle}` : label;
  const extra: string[] = [];
  if (when !== null) extra.push(when);
  if (p.duration !== null && kind === 'task') extra.push(durationLabel(p.duration));
  if (p.projects[0]) extra.push(`#${p.projects[0]}`);
  if (p.priority > 0) extra.push('!'.repeat(p.priority));
  for (const e of extra) summary = `${summary} · ${e}`;

  return {
    kind,
    command: cmd,
    title,
    due,
    repeat: r,
    duration_min: kind === 'task' ? p.duration : null,
    project: p.projects[0] ?? null,
    priority: p.priority,
    remind: cmd === 'remind',
    shopping: shopping && kind === 'task',
    url: p.url,
    recognized,
    confidence,
    review,
    when,
    summary,
  };
}
