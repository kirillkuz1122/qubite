// Повтор хода после обрыва (OPS-009, D-972): тот же key, пока сервер доводит ход в фоне.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('../api', () => ({ api: { POST: post } }));

const { sendTurn, TurnFail, TURN_RETRY_FOR_MS, TURN_RETRY_MS } = await import('./english');

const turn = { session: {}, learner: { id: 'l' }, tutor: { id: 't' }, cost_usd_micros: 0 };
const ok = () => ({ data: turn, error: undefined, response: { ok: true, status: 200 } });
const failed = (status: number, error?: string) => ({
  data: undefined,
  error: error ? { error, message: 'нет' } : undefined,
  response: { ok: false, status },
});
const keys = () => post.mock.calls.map(([, init]) => (init as { body: { key: string } }).body.key);

describe('sendTurn', () => {
  const wait = vi.fn(() => Promise.resolve());
  beforeEach(() => {
    post.mockReset();
    wait.mockClear();
  });

  it('после 408 повторяет с тем же key и отдаёт готовый ход', async () => {
    post
      .mockResolvedValueOnce(failed(408))
      .mockResolvedValueOnce(failed(409, 'in_progress'))
      .mockResolvedValueOnce(ok());
    await expect(sendTurn({ text: 'I like tea' }, wait)).resolves.toEqual(turn);
    expect(post).toHaveBeenCalledTimes(3);
    expect(new Set(keys()).size).toBe(1);
    expect(wait).toHaveBeenCalledWith(TURN_RETRY_MS);
  });

  it('сеть оборвалась по дороге — тоже повтор', async () => {
    post.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(ok());
    await expect(sendTurn({ text: 'hi' }, wait)).resolves.toEqual(turn);
    expect(new Set(keys()).size).toBe(1);
  });

  it('обычная ошибка — сразу, без повтора', async () => {
    post.mockResolvedValueOnce(failed(400, 'invalid'));
    await expect(sendTurn({ text: 'hi' }, wait)).rejects.toMatchObject({ code: 'invalid' });
    expect(post).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('ход так и не готов — после минуты прежняя ошибка', async () => {
    post.mockResolvedValue(failed(409, 'in_progress'));
    const error = await sendTurn({ text: 'hi' }, wait).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TurnFail);
    expect(error).toMatchObject({ code: 'in_progress', status: 409 });
    expect(post).toHaveBeenCalledTimes(TURN_RETRY_FOR_MS / TURN_RETRY_MS + 1);
  });
});
