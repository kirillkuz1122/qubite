/**
 * AI и бюджеты словами (AI-003): лимиты, деньги, кто платит. Общее для Console → AI и
 * «Настройки → AI и бюджет». Деньги на сервере — микродоллары (1 $ = 1 000 000).
 */

export const MICROS = 1_000_000;

export const SCOPE_LABEL: Record<string, string> = {
  platform: 'Вся платформа',
  each_user: 'Каждый человек',
  user: 'Человек',
  user_module: 'Человек в модуле',
  module: 'Модуль',
  model: 'Модель',
  provider: 'Провайдер',
};

export const PERIOD_LABEL: Record<string, string> = {
  hour: 'в час',
  day: 'в день',
  month: 'в месяц',
  all: 'всего',
};

export const METRIC_LABEL: Record<string, string> = {
  usd: '$',
  requests: 'запросов',
  tokens: 'токенов',
};

export const PAYER_LABEL: Record<string, string> = {
  platform: 'платформа',
  subscription: 'своя подписка',
  own_key: 'свой ключ',
};

/** Кто платил — словами. */
export const payer = (key: string) => PAYER_LABEL[key] ?? key;

export const STATUS_LABEL: Record<string, string> = {
  succeeded: 'готово',
  failed_not_sent: 'не ушёл',
  unknown: 'неизвестно',
  sending: 'идёт',
  reserved: 'резерв',
  denied: 'отказ',
};

/** Микродоллары → «$0.12» (мелкие суммы — с тремя–шестью знаками, чтобы не было «$0.00»). */
export function usd(micro: number): string {
  const v = micro / MICROS;
  if (micro === 0) return '$0';
  if (Math.abs(v) >= 1) return `$${v.toFixed(2)}`;
  if (Math.abs(v) >= 0.01) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(6).replace(/0+$/, '')}`;
}

/** «2», «0.5», «0,50», «$3» → микродоллары; не число — `null`. */
export function parseUsd(text: string): number | null {
  const t = text.trim().replace(/^\$/, '').replace(',', '.');
  if (!/^\d*(\.\d{0,6})?$/.test(t) || t === '' || t === '.') return null;
  const [int = '0', frac = ''] = t.split('.');
  return Number(int || '0') * MICROS + Number(frac.padEnd(6, '0'));
}

/** Число лимита по метрике: доллары или штуки. */
export function amount(metric: string, value: number): string {
  return metric === 'usd'
    ? usd(value)
    : `${value.toLocaleString('ru-RU')} ${METRIC_LABEL[metric] ?? metric}`;
}

export interface LimitLike {
  scope: string;
  period: string;
  metric: string;
  value: number;
  used: number;
  account_email?: string | null;
  module_id?: string | null;
  model_id?: string | null;
  provider_id?: string | null;
}

/** На что лимит: «Человек: kirill@…», «Модуль: english», «Вся платформа». */
export function limitTarget(l: LimitLike): string {
  const base = SCOPE_LABEL[l.scope] ?? l.scope;
  const who = [l.account_email, l.module_id, l.model_id, l.provider_id].filter(Boolean).join(' · ');
  return who ? `${base}: ${who}` : base;
}

/** «$5.00 в день · потрачено $0.12» */
export function limitLine(l: LimitLike): string {
  const value =
    l.value === 0
      ? 'запрещено'
      : `${amount(l.metric, l.value)} ${PERIOD_LABEL[l.period] ?? l.period}`;
  return `${value} · израсходовано ${amount(l.metric, l.used)}`;
}

/** Доля израсходованного 0…1 (для полоски). */
export function share(l: LimitLike): number {
  if (l.value <= 0) return l.used > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, l.used / l.value));
}

/**
 * Что ещё нужно, чтобы режим «owner без личного лимита» работал (D-200, D-212): пустой
 * список — работает.
 */
export function unlimitedMissing(o: {
  owner_unlimited: boolean;
  owner_personal_usd: unknown[];
  platform_day_usd?: unknown;
}): string[] {
  const out: string[] = [];
  if (!o.owner_unlimited) out.push('включить режим «owner без личного лимита»');
  if (o.owner_personal_usd.length > 0)
    out.push(
      `снять личный лимит в $ (${o.owner_personal_usd.length}) — пока он есть, действует он, а не режим`,
    );
  if (!o.platform_day_usd)
    out.push('поставить дневной потолок платформы в $ — без него режим не работает');
  return out;
}

/** Коды отказов AI, которые чинятся настройками лимитов (D-509: ссылка вместо команды). */
export const LIMIT_CODES = new Set([
  'budget_exhausted',
  'budget_not_set',
  'platform_cap_not_set',
  'rate_limited',
  'repeated_request',
  'source_not_ready',
]);

/** Куда вести «Открыть настройки лимитов»: owner — в Console, остальных — в свои настройки. */
export function limitsLink(isOwner: boolean): string {
  return isOwner ? '/console/ai' : '/settings/ai';
}
