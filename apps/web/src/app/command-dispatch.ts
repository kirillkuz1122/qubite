import type { components } from '@qubite/api-client';
import { api } from '../api';
import { Fail, must } from '../auth/client';

export type DispatchRequest = components['schemas']['DispatchRequest'];
export type DispatchResult = components['schemas']['DispatchResult'];
export type CommandKind = components['schemas']['CommandKind'];

export function dispatchCommand(body: DispatchRequest) {
  return must(api.POST('/api/command/dispatch', { body }));
}

export function reclassifyCommand(id: string, kind: CommandKind) {
  return must(
    api.POST('/api/command/dispatch/{id}/reclassify', {
      params: { path: { id } },
      body: { kind },
    }),
  );
}

export async function answerFromPult(number: number, answer: string, id: string) {
  const text = answer.trim();
  try {
    await dispatchCommand({ source: 'pult', id, text: `ответить на #${number}: ${text}` });
  } catch (e) {
    // Этот код возможен только до начала записи комментария.
    if (!(e instanceof Fail) || e.code !== 'command_gateway_unavailable') throw e;
    await must(
      api.POST('/api/owner/work/questions/{number}/answer', {
        params: { path: { number } },
        body: { answer: text },
      }),
    );
  }
}
