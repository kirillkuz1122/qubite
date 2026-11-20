import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answerFromPult } from './command-dispatch';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../api', () => ({ api: { POST: post } }));

beforeEach(() => post.mockReset());

const oldPath = '/api/owner/work/questions/{number}/answer';

function refusal(status: number, error: string) {
  return { response: { ok: false, status }, error: { error, message: 'Отказ' } };
}

describe('Ответ из Пульта через Command', () => {
  it('передаёт номер и текст диспетчеру', async () => {
    post.mockResolvedValue({ response: { ok: true } });
    await answerFromPult(7, ' По первому варианту ', 'request-7');
    expect(post).toHaveBeenCalledExactlyOnceWith('/api/command/dispatch', {
      body: { id: 'request-7', source: 'pult', text: 'ответить на #7: По первому варианту' },
    });
  });

  it('использует прежний путь при недоступности шлюза', async () => {
    post
      .mockResolvedValueOnce(refusal(503, 'command_gateway_unavailable'))
      .mockResolvedValueOnce({ response: { ok: true } });
    await answerFromPult(7, 'Да', 'request-7');
    expect(post).toHaveBeenNthCalledWith(2, oldPath, {
      params: { path: { number: 7 } },
      body: { answer: 'Да' },
    });
  });

  it('после ошибки GitHub не повторяет запись комментария другим путём', async () => {
    post.mockResolvedValueOnce(refusal(502, 'github_unavailable'));
    await expect(answerFromPult(7, 'Да', 'request-7')).rejects.toMatchObject({ status: 502 });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
