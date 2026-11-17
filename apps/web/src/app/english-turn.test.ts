// Повтор хода после обрыва (OPS-009, D-972): тот же key, пока сервер доводит ход в фоне.
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
let account: string | undefined = 'a1';
vi.mock('../api', () => ({ api: { POST: post } }));
vi.mock('../account', () => ({ currentAccount: () => account }));

const { appendTurn, ENGLISH, sendTurn, TurnFail, TURN_RETRY_FOR_MS, TURN_RETRY_MS } =
  await import('./english');

const turn = {
  session: { id: 's' },
  learner: { id: 'l' },
  tutor: { id: 't' },
  cost_usd_micros: 0,
};
const ok = () => ({ data: turn, error: undefined, response: { ok: true, status: 200 } });
const failed = (status: number, error?: string) => ({
  data: undefined,
  error: error ? { error, message: 'нет' } : undefined,
  response: { ok: false, status },
});
const keys = () => post.mock.calls.map(([, init]) => (init as { body: { key: string } }).body.key);

/** Часы теста: ожидание сдвигает время; `slow` — сколько «идёт» каждый запрос. */
function clock(slow = 0) {
  let t = 0;
  post.mockImplementation(async () => {
    t += slow;
    return failed(409, 'in_progress');
  });
  return {
    now: () => t,
    wait: vi.fn(async (ms: number) => {
      t += ms;
    }),
  };
}

describe('sendTurn', () => {
  beforeEach(() => {
    post.mockReset();
    account = 'a1';
  });

  it('после 408 повторяет с тем же key и отдаёт готовый ход', async () => {
    const c = clock();
    post
      .mockResolvedValueOnce(failed(408))
      .mockResolvedValueOnce(failed(409, 'in_progress'))
      .mockResolvedValueOnce(ok());
    await expect(sendTurn({ text: 'I like tea' }, c)).resolves.toEqual(turn);
    expect(post).toHaveBeenCalledTimes(3);
    expect(new Set(keys()).size).toBe(1);
    expect(c.wait).toHaveBeenCalledWith(TURN_RETRY_MS);
  });

  it('сеть оборвалась по дороге — тоже повтор', async () => {
    const c = clock();
    post.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(ok());
    await expect(sendTurn({ text: 'hi' }, c)).resolves.toEqual(turn);
    expect(new Set(keys()).size).toBe(1);
  });

  it('обычная ошибка — сразу, без повтора', async () => {
    const c = clock();
    post.mockResolvedValueOnce(failed(400, 'invalid'));
    await expect(sendTurn({ text: 'hi' }, c)).rejects.toMatchObject({ code: 'invalid' });
    expect(post).toHaveBeenCalledTimes(1);
    expect(c.wait).not.toHaveBeenCalled();
  });

  it('ход так и не готов — через минуту прежняя ошибка', async () => {
    const c = clock();
    const error = await sendTurn({ text: 'hi' }, c).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TurnFail);
    expect(error).toMatchObject({ code: 'in_progress', status: 409 });
    expect(c.now()).toBeLessThanOrEqual(TURN_RETRY_FOR_MS);
    expect(post.mock.calls.length).toBeLessThanOrEqual(TURN_RETRY_FOR_MS / TURN_RETRY_MS + 1);
  });

  it('минута считается вместе с временем самих запросов', async () => {
    const c = clock(20_000);
    await sendTurn({ text: 'hi' }, c).catch(() => undefined);
    // первый запрос (20 с) + не дольше минуты повторов
    expect(c.now()).toBeLessThanOrEqual(20_000 + TURN_RETRY_FOR_MS + 20_000);
    // раньше считались только паузы — было бы 13 запросов и больше четырёх минут
    expect(post.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('сменился аккаунт — повторов нет: чужая реплика не уходит от нового', async () => {
    const c = clock();
    post.mockImplementationOnce(async () => {
      account = 'b2';
      return failed(408);
    });
    await expect(sendTurn({ text: 'hi' }, c)).rejects.toMatchObject({ status: 408 });
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('appendTurn', () => {
  it('ход, который обзор уже загрузил, не задваивается', () => {
    const qc = new QueryClient();
    qc.setQueryData(ENGLISH, { session: { id: 's' }, messages: [{ id: 'g' }] });
    appendTurn(qc, turn as never);
    appendTurn(qc, turn as never);
    const o = qc.getQueryData<{ messages: { id: string }[] }>(ENGLISH);
    expect(o?.messages.map((m) => m.id)).toEqual(['g', 'l', 't']);
  });

  it('ход старого или законченного разговора не приклеивается — обзор загружается заново', () => {
    const qc = new QueryClient();
    const refresh = vi.spyOn(qc, 'invalidateQueries');
    qc.setQueryData(ENGLISH, { session: { id: 'new' }, messages: [{ id: 'g' }] });
    appendTurn(qc, turn as never);
    appendTurn(qc, {
      ...turn,
      session: { id: 'new', finished_at: '2026-11-17T10:00:00Z' },
    } as never);
    const o = qc.getQueryData<{ session: { id: string }; messages: { id: string }[] }>(ENGLISH);
    expect(o?.session.id).toBe('new');
    expect(o?.messages.map((m) => m.id)).toEqual(['g']);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
