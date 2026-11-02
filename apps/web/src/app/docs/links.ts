import type { DocLink, DocLinkKind, DocLinkTarget } from '@qubite/sync-client';

/** Контракт DOC-003a отделён от сгенерированного API: в тестах достаточно фейка. */
export interface LinkSource {
  search(query: string, signal: AbortSignal): Promise<DocLinkTarget[]>;
  links(documentId: string, signal: AbortSignal): Promise<DocLink[]>;
}

export const LINK_LABELS: Record<DocLinkKind, string> = {
  'docs.page': 'Документ',
  'planner.task': 'Дело',
  'projects.project': 'Проект',
  'calendar.event': 'Событие',
};

export function httpLinkSource(doFetch: typeof fetch = globalThis.fetch): LinkSource {
  async function get<T>(path: string, signal: AbortSignal): Promise<T> {
    const response = await doFetch(path, { credentials: 'include', signal });
    if (!response.ok) throw new Error(`Связи недоступны: ${response.status}`);
    return (await response.json()) as T;
  }
  return {
    async search(query, signal) {
      const response = await get<{ targets: DocLinkTarget[] }>(
        `/api/v1/docs/link-targets?q=${encodeURIComponent(query)}`,
        signal,
      );
      return response.targets.slice(0, 8);
    },
    async links(id, signal) {
      const response = await get<{ links: DocLink[] }>(
        `/api/v1/docs/${encodeURIComponent(id)}/links`,
        signal,
      );
      return response.links;
    },
  };
}

export function mentionLabel(link: DocLink | undefined): string {
  return link?.deleted ? 'Удалено' : (link?.title || '…');
}

export function linkHref(target: string, kind: DocLinkKind): string {
  const id = encodeURIComponent(target);
  switch (kind) {
    case 'docs.page':
      return `/docs/${id}`;
    case 'projects.project':
      return `/planner/project/${id}`;
    case 'planner.task':
      return `/planner?task=${id}`;
    case 'calendar.event':
      return `/calendar?event=${id}`;
  }
}
