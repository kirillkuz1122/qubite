/**
 * Страница проекта (PROJ-001): запросы к `/api/v1/projects/{id}` (файлы, документы, лента) и к
 * папке агента (память проекта). Дела и сам проект — синхронизацией (`usePlanner`), как везде.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { must } from '../auth/client';
import { TIMELINE } from './agent';
import { FILES } from './agent-records';
import type { ProjectDoc, ProjectDocItem, ProjectFileItem, ProjectPage } from './project-view';

export const PROJECT = ['project'] as const;
export const DOCS = ['docs'] as const;

export function useProjectPage(id: string) {
  return useQuery({
    queryKey: [...PROJECT, id],
    queryFn: (): Promise<ProjectPage> =>
      must(api.GET('/api/v1/projects/{id}', { params: { path: { id } } })),
    retry: false,
  });
}

function useRefresh(id: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: [...PROJECT, id] });
    void qc.invalidateQueries({ queryKey: DOCS });
  };
}

/** Положить файл: тело запроса — сам файл (до 25 МБ). */
export function useUploadFile(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (file: File): Promise<ProjectFileItem> =>
      must(
        api.POST('/api/v1/projects/{id}/files', {
          params: { path: { id }, query: { name: file.name } },
          // файл уходит как есть, без JSON
          body: file as unknown as number[],
          bodySerializer: (b: unknown) => b as BodyInit,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        }),
      ),
    onSettled: refresh,
  });
}

export function useRemoveFile(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (name: string) =>
      must(api.DELETE('/api/v1/projects/{id}/files/{name}', { params: { path: { id, name } } })),
    onSettled: refresh,
  });
}

export function useCreateDoc(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: ({ title, body }: { title: string; body: string }): Promise<ProjectDoc> =>
      must(
        api.POST('/api/v1/projects/{id}/docs', {
          params: { path: { id } },
          body: { title, body },
        }),
      ),
    onSettled: refresh,
  });
}

/** Мои документы — чтобы привязать к проекту. */
export function useDocs(enabled: boolean) {
  return useQuery({
    queryKey: DOCS,
    queryFn: (): Promise<{ docs: ProjectDocItem[] }> => must(api.GET('/api/v1/docs')),
    enabled,
    retry: false,
  });
}

export function useDoc(id: string | null) {
  return useQuery({
    queryKey: [...DOCS, id],
    queryFn: (): Promise<ProjectDoc> =>
      must(api.GET('/api/v1/docs/{id}', { params: { path: { id: id! } } })),
    enabled: !!id,
    retry: false,
  });
}

export function useEditDoc(project: string) {
  const refresh = useRefresh(project);
  return useMutation({
    mutationFn: (d: { id: string; title: string; body: string; revision: number }) =>
      must(
        api.PUT('/api/v1/docs/{id}', {
          params: { path: { id: d.id } },
          body: { title: d.title, body: d.body, revision: d.revision },
        }),
      ),
    onSettled: refresh,
  });
}

export function useLinkDoc(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (doc: string) =>
      must(api.POST('/api/v1/projects/{id}/docs/{doc}', { params: { path: { id, doc } } })),
    onSettled: refresh,
  });
}

export function useUnlinkDoc(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (doc: string) =>
      must(api.DELETE('/api/v1/projects/{id}/docs/{doc}', { params: { path: { id, doc } } })),
    onSettled: refresh,
  });
}

/**
 * Память агента о проекте — файл «Проекты/<проект>.md» его папки: завести и править руками
 * (твоя поправка, строка ленты агента с откатом, как в «Записях»).
 */
export function useMemoryWrite(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      m: { path: string; body: string } | { file: string; body: string; revision: number },
    ) =>
      'path' in m
        ? must(api.POST('/api/v1/agent/files', { body: { path: m.path, body: m.body } }))
        : must(
            api.PUT('/api/v1/agent/files/{id}', {
              params: { path: { id: m.file } },
              body: { body: m.body, revision: m.revision },
            }),
          ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [...PROJECT, id] });
      void qc.invalidateQueries({ queryKey: FILES });
      void qc.invalidateQueries({ queryKey: TIMELINE });
    },
  });
}
