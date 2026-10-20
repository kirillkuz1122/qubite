import { describe, expect, it } from 'vitest';
import { noticeLine, noticeWhen } from './notice-view';
import { keyBytes } from './push';

describe('колокольчик (PLAN-004)', () => {
  it('строка под заголовком: подробности, почему, тишина', () => {
    expect(
      noticeLine({
        body: 'в 16:00',
        why: 'сходить куда-то — за час, с запасом на дорогу',
        held: false,
      }),
    ).toBe('в 16:00 · сходить куда-то — за час, с запасом на дорогу');
    expect(noticeLine({ body: '', why: '', held: true })).toBe('пришло в тишину');
  });

  it('время: сегодня — часы, раньше — день', () => {
    const now = new Date('2026-10-20T12:00:00');
    expect(noticeWhen(new Date('2026-10-20T09:05:00').toISOString(), now)).toBe('09:05');
    expect(noticeWhen(new Date('2026-10-19T09:05:00').toISOString(), now)).toMatch(/19 окт/);
  });

  it('ключ сервера для подписки: base64url → 65 байт', () => {
    const key =
      'BDmf-bInVoMNkA7HR8OtWUZa1pkU8tv3Bey9fGBGM1LZ6XRhKH_x5ZIGBzbS_LPPEPZcbHjj_-R7l5T6uqrpzMw';
    const bytes = keyBytes(key);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
  });
});
