import { describe, expect, it } from 'vitest';
import {
  amount,
  limitLine,
  limitTarget,
  limitsLink,
  parseUsd,
  share,
  unlimitedMissing,
  usd,
} from './ai-view';

describe('AI и бюджет словами', () => {
  it('доллары туда и обратно', () => {
    expect(usd(5_000_000)).toBe('$5.00');
    expect(usd(120_000)).toBe('$0.120');
    expect(usd(49)).toBe('$0.000049');
    expect(usd(0)).toBe('$0');
    expect(parseUsd('2')).toBe(2_000_000);
    expect(parseUsd('0,5')).toBe(500_000);
    expect(parseUsd('$3.25')).toBe(3_250_000);
    expect(parseUsd('.000001')).toBe(1);
    expect(parseUsd('abc')).toBeNull();
    expect(parseUsd('')).toBeNull();
    expect(parseUsd('1.0000001')).toBeNull();
  });

  it('лимит словами', () => {
    const l = {
      scope: 'user',
      period: 'day',
      metric: 'usd',
      value: 1_000_000,
      used: 250_000,
      account_email: 'kirill@qubite.ru',
    };
    expect(limitTarget(l)).toBe('Человек: kirill@qubite.ru');
    expect(limitLine(l)).toBe('$1.00 в день · израсходовано $0.250');
    expect(share(l)).toBe(0.25);
    expect(amount('requests', 1500)).toMatch(/^1\s500 запросов$/);
    expect(limitLine({ ...l, value: 0, used: 0 })).toMatch(/^запрещено/);
    expect(share({ ...l, value: 0, used: 1 })).toBe(1);
  });

  it('что нужно для безлимита owner', () => {
    expect(
      unlimitedMissing({ owner_unlimited: true, owner_personal_usd: [], platform_day_usd: {} }),
    ).toEqual([]);
    const all = unlimitedMissing({
      owner_unlimited: false,
      owner_personal_usd: [{}],
      platform_day_usd: null,
    });
    expect(all).toHaveLength(3);
    expect(all[1]).toMatch(/снять личный лимит/);
  });

  it('ссылка на настройки лимитов', () => {
    expect(limitsLink(true)).toBe('/console/ai');
    expect(limitsLink(false)).toBe('/settings/ai');
  });
});
