/**
 * Поиск для Command без сервера: сравнивает запрос со строкой по началам слов.
 * «нас» найдёт «Настройки», «алг 214» — «Алгебра: № 214–220», «ntvf» (забыл раскладку) — «тема».
 */

/** Буквы раскладки: латинская клавиша → русская буква на той же клавише. */
const LAYOUT_EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const LAYOUT_RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';

/** Нижний регистр, «ё» → «е», без знаков препинания — для сравнения. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Набрано в английской раскладке, а думал по-русски: «yfcnhjqrb» → «настройки». */
export function fixLayout(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase()) {
    const i = LAYOUT_EN.indexOf(ch);
    out += i >= 0 ? LAYOUT_RU[i] : ch;
  }
  return out;
}

const words = (s: string) => normalize(s).split(' ').filter(Boolean);

function score(q: string[], hay: string[], title: string[]): number {
  if (!q.length) return 0;
  let total = 0;
  for (const w of q) {
    let best = 0;
    for (const h of hay) {
      if (h === w) best = Math.max(best, 3);
      else if (h.startsWith(w)) best = Math.max(best, 2);
      else if (w.length >= 3 && h.includes(w)) best = Math.max(best, 1);
    }
    if (!best) return 0;
    total += best;
  }
  // совпало начало заголовка — выше
  if (title[0]?.startsWith(q[0]!)) total += 2;
  return total / q.length;
}

/**
 * Насколько запись подходит под запрос: 0 — не подходит, больше — лучше.
 * Каждое слово запроса должно найтись в начале какого-то слова заголовка или ключевых слов.
 */
export function matchScore(query: string, title: string, keywords: readonly string[] = []): number {
  const t = words(title);
  const hay = [...t, ...keywords.flatMap(words)];
  const direct = score(words(query), hay, t);
  if (direct) return direct;
  // забытая раскладка — чуть ниже прямого совпадения
  return score(words(fixLayout(query)), hay, t) * 0.9;
}
