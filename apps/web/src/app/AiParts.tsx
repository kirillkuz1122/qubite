import type { components } from '@qubite/api-client';
import { useState } from 'react';
import {
  amount,
  limitLine,
  limitTarget,
  payer,
  share,
  STATUS_LABEL,
  usd,
  type LimitLike,
} from './ai-view';
import './ai.css';

type S = components['schemas'];

/** Время коротко: «23 окт., 14:05». */
const at = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Итоги за период — числа крупно. */
export function SpendTotals({ usage, extra }: { usage: S['AiUsage']; extra?: [string, string][] }) {
  const items: [string, string][] = [
    [`За ${usage.days} дн.`, usd(usage.total.usd)],
    ['Запросов', usage.total.requests.toLocaleString('ru-RU')],
    ['Токенов', usage.total.tokens.toLocaleString('ru-RU')],
    ...(extra ?? []),
  ];
  return (
    <dl className="ai-totals">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Расход по дням: один ряд — столбики одного цвета от общей нулевой линии, наведение (или
 * касание) показывает день и сумму. Те же числа — таблицей ниже (для чтения без графика).
 */
export function SpendChart({ days }: { days: S['UsageRow'][] }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(...days.map((d) => d.usd), 0);
  const picked = hover === null ? null : days[hover];
  const day = (key: string) =>
    new Date(`${key}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return (
    <figure className="ai-chart" aria-label="Расход по дням">
      <figcaption className="ai-chart-head">
        <span>{picked ? day(picked.key) : 'Расход по дням, $'}</span>
        <b>
          {picked
            ? `${usd(picked.usd)} · ${picked.requests} запр.`
            : top === 0
              ? 'трат не было'
              : `больше всего ${usd(top)}`}
        </b>
      </figcaption>
      <div className="ai-bars" role="list" onPointerLeave={() => setHover(null)}>
        {days.map((d, i) => (
          <button
            type="button"
            role="listitem"
            key={d.key}
            className={`ai-bar${hover === i ? ' on' : ''}`}
            aria-label={`${day(d.key)}: ${usd(d.usd)}, запросов ${d.requests}`}
            onPointerEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onClick={() => setHover(i)}
          >
            <i
              style={{
                transform: `scaleY(${top > 0 ? Math.max(d.usd / top, d.usd > 0 ? 0.04 : 0) : 0})`,
              }}
            />
          </button>
        ))}
      </div>
      <div className="ai-axis" aria-hidden="true">
        <span>{days[0] ? day(days[0].key) : ''}</span>
        <span>{days.length ? day(days[days.length - 1]!.key) : ''}</span>
      </div>
    </figure>
  );
}

/** Расход группами: модуль, модель, человек, кто платил. */
export function UsageTable({
  title,
  rows,
  label = (k) => k,
}: {
  title: string;
  rows: S['UsageRow'][];
  label?: (key: string) => string;
}) {
  return (
    <div className="ai-table">
      <h3 className="ai-h3">{title}</h3>
      {rows.length === 0 ? (
        <p className="ai-small">Пока ничего.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">{title}</th>
              <th scope="col">$</th>
              <th scope="col">Запр.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{label(r.key)}</th>
                <td>{usd(r.usd)}</td>
                <td>{r.requests}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Лимит строкой: на что, сколько, полоска расхода; действия — справа. */
export function LimitRow({ limit, children }: { limit: LimitLike; children?: React.ReactNode }) {
  const part = share(limit);
  return (
    <li className="ai-limit">
      <span className="ai-limit-text">
        <b>{limitTarget(limit)}</b>
        <small>{limitLine(limit)}</small>
        <span className={`ai-meter${part >= 1 ? ' full' : ''}`} aria-hidden="true">
          <i style={{ transform: `scaleX(${part})` }} />
        </span>
      </span>
      {children && <span className="ai-limit-act">{children}</span>}
    </li>
  );
}

/** Вызовы AI: когда, кто, модуль, модель, итог, деньги. Текста запросов здесь нет. */
export function CallList({ calls, who = true }: { calls: S['AiCallItem'][]; who?: boolean }) {
  if (calls.length === 0) return <p className="ai-small">Вызовов пока не было.</p>;
  return (
    <ol className="ai-calls" aria-label="AI-вызовы">
      {calls.map((c) => (
        <li key={c.id}>
          <time dateTime={c.at}>{at(c.at)}</time>
          <span>
            {who && <b>{c.account_email ?? '—'} · </b>}
            {c.module_id} · {c.model_id}
            <small className="ai-small">
              {STATUS_LABEL[c.status] ?? c.status}
              {c.error_code ? ` (${c.error_code})` : ''} ·{' '}
              {c.actual_usd != null ? usd(c.actual_usd) : `резерв ${usd(c.estimate_usd)}`} ·{' '}
              {payer(c.paid_by)}
              {c.tokens_in != null || c.tokens_out != null
                ? ` · ${amount('tokens', (c.tokens_in ?? 0) + (c.tokens_out ?? 0))}`
                : ''}
            </small>
          </span>
        </li>
      ))}
    </ol>
  );
}
