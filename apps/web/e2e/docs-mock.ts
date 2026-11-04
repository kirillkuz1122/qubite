import type { Page } from '@playwright/test';
import type { DocLinkTarget, DocVersion } from '@qubite/sync-client';
import * as Y from 'yjs';
import { mockSync, type SyncMock } from './sync-mock';

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const bytes = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));
type WireVersion = Omit<DocVersion, 'ystate'> & { ystate: string };

/** Контракт DOCS.md: сервер хранит Yjs, Markdown отдаёт для первого переноса. */
export async function mockDocs(page: Page, existing?: SyncMock) {
  const sync = existing ?? (await mockSync(page));
  const documents = new Map<string, Y.Doc>();
  const markdown = new Map<string, string>();
  const pushes: {
    id: string;
    text: string;
    seed: boolean;
    links?: string[];
    reason?: string;
    restore_of?: string;
  }[] = [];
  const versions = new Map<string, WireVersion[]>();
  let versionTime = Date.now();
  const snapshot = (id: string, name: string | null = null, kind = 'named'): WireVersion => {
    const doc = documents.get(id);
    if (!doc) throw new Error('Сначала дождитесь отправки документа');
    const state = Y.encodeStateAsUpdate(doc);
    const text = markdown.get(id) ?? '';
    const version: WireVersion = {
      id: crypto.randomUUID(),
      created_at: new Date(++versionTime).toISOString(),
      kind,
      name,
      title: sync.objects.get(id)?.title as string,
      preview: text.split('\n')[0] ?? '',
      size: state.length,
      text,
      ystate: base64(state),
    };
    versions.set(id, [version, ...(versions.get(id) ?? [])]);
    return version;
  };
  const mentions = new Map<string, string[]>();
  const targets = new Map<string, DocLinkTarget>();
  const deletedTargets = new Set<string>();
  const targetQueries: string[] = [];
  const queries: string[] = [];
  const backlinkQueries: string[] = [];
  const backlinks = (id: string): DocLinkTarget[] => {
    const target = sync.objects.get(id);
    if (!target || target.deleted || deletedTargets.has(id)) return [];
    return [...mentions.entries()].flatMap(([sourceId, ids]) => {
      const source = sync.objects.get(sourceId);
      if (!ids.includes(id) || !source || source.deleted || deletedTargets.has(sourceId)) return [];
      return [{ id: sourceId, type: 'docs.page' as const, title: source.title as string }];
    });
  };
  const add = (title: string, text = '') => {
    const id = sync.addDoc(title, { preview: text.slice(0, 160) });
    markdown.set(id, text);
    targets.set(id, { id, type: 'docs.page', title });
    return id;
  };
  await page.route('**/api/v1/docs**', async (route) => {
    if (sync.offline) return route.abort('internetdisconnected');
    const request = route.request();
    const url = new URL(request.url());
    const versionsMatch = url.pathname.match(
      /^\/api\/v1\/docs\/([^/]+)\/versions(?:\/([^/]+))?$/,
    );
    if (versionsMatch) {
      const id = decodeURIComponent(versionsMatch[1]!);
      const vid = versionsMatch[2] ? decodeURIComponent(versionsMatch[2]) : null;
      if (!sync.objects.has(id))
        return route.fulfill({ status: 404, json: { error: 'not_found' } });
      if (!vid) {
        if (request.method() === 'POST') {
          const body = request.postDataJSON() as { name: string };
          return route.fulfill({ status: 201, json: snapshot(id, body.name) });
        }
        const before = url.searchParams.get('before');
        const page = (versions.get(id) ?? [])
          .filter((item) => !before || item.created_at < before)
          .slice(0, 50);
        return route.fulfill({
          json: {
            versions: page.map((item) => ({
              id: item.id,
              created_at: item.created_at,
              kind: item.kind,
              name: item.name,
              preview: item.preview,
              title: item.title,
              size: item.size,
            })),
          },
        });
      }
      const version = versions.get(id)?.find((item) => item.id === vid);
      if (!version)
        return route.fulfill({ status: 404, json: { error: 'not_found' } });
      if (request.method() === 'PATCH' || request.method() === 'DELETE') {
        if (version.kind !== 'named')
          return route.fulfill({ status: 400, json: { error: 'not_named' } });
        if (request.method() === 'PATCH')
          version.name = (request.postDataJSON() as { name: string }).name;
        else {
          versions.set(id, (versions.get(id) ?? []).filter((item) => item.id !== vid));
          return route.fulfill({ status: 204 });
        }
      }
      return route.fulfill({ json: version });
    }
    const backlinksMatch = url.pathname.match(/^\/api\/v1\/docs\/([^/]+)\/backlinks$/);
    if (backlinksMatch) {
      const id = decodeURIComponent(backlinksMatch[1]!);
      backlinkQueries.push(id);
      return route.fulfill({ json: { backlinks: backlinks(id) } });
    }
    if (url.pathname === '/api/v1/docs/link-targets') {
      const query = url.searchParams.get('q') ?? '';
      targetQueries.push(query);
      return route.fulfill({
        json: {
          targets: [...targets.values()]
            .filter(
              (target) =>
                !deletedTargets.has(target.id) &&
                target.title.toLowerCase().includes(query.toLowerCase()),
            )
            .slice(0, 8),
        },
      });
    }
    const linksMatch = url.pathname.match(/^\/api\/v1\/docs\/([^/]+)\/links$/);
    if (linksMatch) {
      const links = (mentions.get(decodeURIComponent(linksMatch[1]!)) ?? []).flatMap((id) => {
        const target = targets.get(id);
        return target ? [{ ...target, deleted: deletedTargets.has(id) }] : [];
      });
      return route.fulfill({ json: { links } });
    }
    const match = url.pathname.match(/^\/api\/v1\/docs\/([^/]+)\/y$/);
    if (match) {
      const id = decodeURIComponent(match[1]!);
      if (!sync.objects.has(id))
        return route.fulfill({ status: 404, json: { error: 'not_found' } });
      let doc = documents.get(id);
      if (!doc) {
        doc = new Y.Doc();
        documents.set(id, doc);
      }
      if (request.method() === 'GET') {
        const sv = bytes(url.searchParams.get('sv') ?? 'AA==');
        return route.fulfill({
          json: {
            update: base64(Y.encodeStateAsUpdate(doc, sv)),
            sv: base64(Y.encodeStateVector(doc)),
            seed_markdown:
              doc.get('root', Y.XmlText).length === 0 ? (markdown.get(id) ?? '') : null,
          },
        });
      }
      const body = request.postDataJSON() as {
        update: string;
        text: string;
        seed?: boolean;
        links?: string[];
        reason?: string;
        restore_of?: string;
      };
      if (body.seed && doc.get('root', Y.XmlText).length > 0)
        return route.fulfill({
          status: 409,
          json: { error: 'seed_taken', message: 'Документ уже перенесён' },
        });
      if (body.reason === 'restore') snapshot(id, null, 'before_restore');
      Y.applyUpdate(doc, bytes(body.update));
      markdown.set(id, body.text);
      pushes.push({
        id,
        text: body.text,
        seed: !!body.seed,
        ...(body.links ? { links: body.links } : {}),
        ...(body.reason ? { reason: body.reason, restore_of: body.restore_of } : {}),
      });
      if (body.links) mentions.set(id, body.links);
      sync.patch(id, { preview: body.text.slice(0, 160), has_ystate: true });
      return route.fulfill({ json: { sv: base64(Y.encodeStateVector(doc)) } });
    }
    const list = [...sync.objects.values()]
      .filter((doc) => doc.object_type === 'docs.page' && !doc.deleted)
      .map((doc) => ({
        id: doc.id as string,
        title: doc.title as string,
        preview: (doc.fields as { preview?: string }).preview ?? '',
        updated_at: new Date(doc.updated_at_ms as number).toISOString(),
        revision: doc.revision,
        project_ids: [],
      }));
    if (url.pathname === '/api/v1/docs') {
      const q = url.searchParams.get('q')?.toLowerCase() ?? '';
      queries.push(q);
      return route.fulfill({
        json: {
          docs: list.filter((doc) =>
            `${doc.title} ${markdown.get(doc.id) ?? doc.preview}`.toLowerCase().includes(q),
          ),
        },
      });
    }
    const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
    const doc = list.find((doc) => doc.id === id);
    return doc
      ? route.fulfill({ json: { ...doc, body: markdown.get(id) ?? '' } })
      : route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  await page.route('**/api/v1/objects/*/backlinks', (route) => {
    if (sync.offline) return route.abort('internetdisconnected');
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[4]!);
    backlinkQueries.push(id);
    return route.fulfill({ json: { backlinks: backlinks(id) } });
  });
  return {
    sync,
    add,
    versions,
    snapshot,
    pushes,
    queries,
    markdown,
    documents,
    targets,
    deletedTargets,
    targetQueries,
    mentions,
    backlinkQueries,
  };
}
