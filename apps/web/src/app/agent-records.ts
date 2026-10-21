/**
 * Папка агента и разговор (AGT-001): запросы к `/api/v1/agent/files|chat|questions`. Ответ агента
 * готовит сервер в фоне, поэтому после «Поправить» и сообщения разговор спрашиваем снова, пока
 * агент думает (`pending`), — и тогда же обновляем файлы и ленту.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { must } from '../auth/client';
import { TIMELINE } from './agent';
import type {
  AgentChat,
  AgentFile,
  AgentFileList,
  AgentQuestions,
  AgentSkillList,
} from './agent-records-view';

export const FILES = ['agent-files'] as const;
export const CHAT = ['agent-chat'] as const;
export const QUESTIONS = ['agent-questions'] as const;
export const SKILLS = ['agent-skills'] as const;

export function useFiles() {
  return useQuery({
    queryKey: FILES,
    queryFn: (): Promise<AgentFileList> => must(api.GET('/api/v1/agent/files')),
    retry: false,
  });
}

export function useFile(id: string | null) {
  return useQuery({
    queryKey: [...FILES, id],
    queryFn: (): Promise<AgentFile> =>
      must(api.GET('/api/v1/agent/files/{id}', { params: { path: { id: id! } } })),
    enabled: !!id,
    retry: false,
  });
}

/** Всё, что мог поменять агент или ты: файлы, вопросы, ленту. */
function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: FILES });
    void qc.invalidateQueries({ queryKey: QUESTIONS });
    void qc.invalidateQueries({ queryKey: SKILLS });
    void qc.invalidateQueries({ queryKey: TIMELINE });
  };
}

/** Правка руками — твоя поправка, видна в ленте. */
export function useEditFile() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, body, revision }: { id: string; body: string; revision: number }) =>
      must(
        api.PUT('/api/v1/agent/files/{id}', { params: { path: { id } }, body: { body, revision } }),
      ),
    onSettled: refresh,
  });
}

/** «Новый файл» руками (D-391): имя и текст; строка ленты, откатывается. */
export function useCreateFile() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body: string }) =>
      must(api.POST('/api/v1/agent/files', { body: { path, body } })),
    onSettled: refresh,
  });
}

/** «Поправить»: агент исправит файл сразу. */
export function useFixFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      must(api.POST('/api/v1/agent/files/{id}/fix', { params: { path: { id } }, body: { text } })),
    onSettled: () => qc.invalidateQueries({ queryKey: CHAT }),
  });
}

/**
 * Разговор. Пока агент думает — спрашиваем каждые 1,5 с; как ответил — обновляем файлы и ленту.
 */
export function useChat() {
  const refresh = useRefresh();
  return useQuery({
    queryKey: CHAT,
    queryFn: async (): Promise<AgentChat> => {
      const chat = await must<AgentChat>(
        api.GET('/api/v1/agent/chat', { params: { query: { limit: 50 } } }),
      );
      if (!chat.pending) refresh();
      return chat;
    },
    refetchInterval: (q) => (q.state.data?.pending ? 1500 : false),
    retry: false,
  });
}

export function useSay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => must(api.POST('/api/v1/agent/chat', { body: { text } })),
    onSettled: () => qc.invalidateQueries({ queryKey: CHAT }),
  });
}

export function useQuestions() {
  return useQuery({
    queryKey: QUESTIONS,
    queryFn: (): Promise<AgentQuestions> => must(api.GET('/api/v1/agent/questions')),
    retry: false,
  });
}

/** Ответить (агент запишет) или «Не сейчас» (`answer` пустой). */
export function useAnswer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, answer }: { id: string; answer: string }): Promise<void> => {
      if (answer) {
        await must(
          api.POST('/api/v1/agent/questions/{id}/answer', {
            params: { path: { id } },
            body: { answer },
          }),
        );
      } else {
        await must(api.POST('/api/v1/agent/questions/{id}/dismiss', { params: { path: { id } } }));
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QUESTIONS });
      void qc.invalidateQueries({ queryKey: CHAT });
      void qc.invalidateQueries({ queryKey: TIMELINE });
    },
  });
}

/** Навыки агента: описания, когда пользовался, закреплён, в архиве (AGT-003). */
export function useSkills() {
  return useQuery({
    queryKey: SKILLS,
    queryFn: (): Promise<AgentSkillList> => must(api.GET('/api/v1/agent/skills')),
    retry: false,
  });
}

export type SkillChange = 'pin' | 'unpin' | 'archive' | 'restore';

/** Закрепить, открепить, в архив, вернуть — строка ленты, откатывается. */
export function useSkillChange() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, change }: { id: string; change: SkillChange }) => {
      const params = { params: { path: { id } } };
      switch (change) {
        case 'pin':
        case 'unpin':
          return must(
            api.POST('/api/v1/agent/skills/{id}/pin', {
              ...params,
              body: { pinned: change === 'pin' },
            }),
          );
        case 'archive':
          return must(api.POST('/api/v1/agent/skills/{id}/archive', params));
        case 'restore':
          return must(api.POST('/api/v1/agent/skills/{id}/restore', params));
      }
    },
    onSettled: refresh,
  });
}
