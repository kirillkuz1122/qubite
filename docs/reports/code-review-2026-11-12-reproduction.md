Воспроизведение замечаний к ревью от 12 ноября 2026

Проверяемый commit: `c51c7c93a96392da91ad0f04b8cb0e46710c1916`. Примеры запускались только в отдельной копии исходников и на отдельной PostgreSQL. Они **проверяют наличие ошибки**: успешный тест означает, что дефект воспроизведён. Исправлений приложения здесь нет.

Чтобы повторить, распакуйте `git archive c51c7c9` в `/tmp/qubite-review`, установите зависимости из lockfile, скопируйте приведённые файлы по указанным путям и используйте отдельную тестовую БД. Playwright использует настоящие компоненты и API-моки из репозитория; внешние аккаунты и платные провайдеры не нужны. Для серверного теста задайте `TEST_DATABASE_URL` на отдельную PostgreSQL 18 с pgvector и правом создавать тестовые базы.

Команды:

```sh
cargo test -p qubite-sync-server --test review_repro -- --nocapture --test-threads=1
pnpm --filter @qubite/sync-client exec vitest run src/review-repro.test.ts
pnpm --filter @qubite/web exec playwright test e2e/review-findings.spec.ts e2e/review-cache.spec.ts --project=chromium --workers=1
```

Для браузерных примеров копия должна находиться именно в `/tmp/qubite-review`: так указан импорт настоящего клиента. Тесты UI из основной копии не редактируются. При другом расположении нужно заменить URL импорта.

Файл `crates/qubite-sync-server/tests/review_repro.rs`:

```rust
use qubite_objects::{NewObject, objects};
use qubite_sync_server::{Rules, pull, pull_with};
use qubite_testkit::TestDb;
use uuid::Uuid;

#[tokio::test]
async fn review_commits_out_of_sequence_are_missed() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let owner = Uuid::now_v7();
    let mut slow = pool.begin().await.unwrap();
    let a = objects::create(&mut slow, NewObject::new("inbox.item", owner, "slow transaction")).await.unwrap();
    let mut fast = pool.acquire().await.unwrap();
    let b = objects::create(&mut fast, NewObject::new("inbox.item", owner, "fast transaction")).await.unwrap();
    drop(fast);
    let first = pull(pool, owner, 0, 100).await.unwrap();
    assert_eq!(first.changes.len(), 1);
    assert_eq!(first.changes[0].id, b.id);
    slow.commit().await.unwrap();
    let next = pull(pool, owner, first.cursor, 100).await.unwrap();
    let full = pull(pool, owner, 0, 100).await.unwrap();
    println!("first_cursor={} incremental_count={} full_count={} missed={}", first.cursor, next.changes.len(), full.changes.len(), a.id);
    assert!(next.changes.is_empty(), "reproduction: committed object is missed");
    assert_eq!(full.changes.len(), 2);
    test_db.drop_db().await;
}

#[tokio::test]
async fn review_reenabled_module_is_not_backfilled() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let owner = Uuid::now_v7();
    let mut conn = pool.acquire().await.unwrap();
    objects::create(&mut conn, NewObject::new("docs.page", owner, "existing doc")).await.unwrap();
    objects::create(&mut conn, NewObject::new("inbox.item", owner, "visible inbox")).await.unwrap();
    drop(conn);
    let restricted = Rules { readable: Some(vec!["inbox".into()]), ..Default::default() };
    let first = pull_with(pool, owner, 0, 100, &restricted).await.unwrap();
    let allowed = Rules { readable: Some(vec!["inbox".into(), "docs".into()]), ..Default::default() };
    let next = pull_with(pool, owner, first.cursor, 100, &allowed).await.unwrap();
    let full = pull_with(pool, owner, 0, 100, &allowed).await.unwrap();
    println!("cursor={} newly_allowed_objects={} full_objects={}", first.cursor, next.changes.len(), full.changes.len());
    assert_eq!(first.changes.len(), 1);
    assert!(next.changes.is_empty(), "reproduction: existing docs not backfilled");
    assert_eq!(full.changes.len(), 2);
    test_db.drop_db().await;
}
```

Файл `packages/sync-client/src/review-repro.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { it, expect } from 'vitest';
import { SyncClient, type Transport } from './client';
import type { ObjectSnapshot } from './protocol';

it('review: rejected edit blocks incoming snapshots', async () => {
  let snapshot: ObjectSnapshot = {
    id: crypto.randomUUID(),
    object_type: 'planner.task',
    title: 'server original',
    revision: 1,
    deleted: false,
    updated_at_ms: 1,
  };
  const transport: Transport = {
    pull: async () => ({ changes: [snapshot], cursor: snapshot.revision, has_more: false }),
    push: async ({ ops }) => ({
      results: ops.map((op) => ({
        status: 'rejected' as const,
        op_id: op.op_id,
        reason: 'forbidden' as const,
        message: 'revoked',
      })),
    }),
  };
  const c = await SyncClient.open({ dbName: 'review-rejected-' + crypto.randomUUID(), transport });
  await c.sync();
  await c.setTitle(snapshot.id, 'rejected local title');
  await c.sync();
  const problem = (await c.problems())[0]!;
  await c.dismissProblem(problem.op.op_id);
  snapshot = { ...snapshot, title: 'fresh server title', revision: 3 };
  await c.sync();
  console.log('REJECTED_STATE', c.state(), await c.get(snapshot.id));
  expect(c.state().status).toBe('synced');
  expect((await c.get(snapshot.id))?.pending).toBe(true);
  expect((await c.get(snapshot.id))?.title).toBe('rejected local title');
  c.close();
});

it('review: concurrent local edits overwrite one another', async () => {
  const c = await SyncClient.open({
    dbName: 'review-parallel-' + crypto.randomUUID(),
    transport: {
      push: async () => {
        throw Error('offline');
      },
      pull: async () => {
        throw Error('offline');
      },
    },
  });
  const object = await c.create('planner.task', 'original', { priority: 'normal', status: 'todo' });
  await Promise.all([
    c.patch(object.id, { priority: 'high' }),
    c.patch(object.id, { status: 'done' }),
  ]);
  const current = await c.get(object.id);
  console.log('PARALLEL_LOCAL', current);
  expect(current?.revision).toBe(2);
  expect(current?.fields).not.toEqual({ priority: 'high', status: 'done' });
  c.close();
});
```

Файл `apps/web/review-sheet.html`:

```html
<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <script type="module" src="/review-sheet.tsx"></script>
  </body>
</html>
```

Файл `apps/web/review-sheet.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { LookProvider, Sheet } from '@qubite/ui';
import '@qubite/ui/styles.css';
function Demo() {
  const [open, setOpen] = useState(false);
  return (
    <LookProvider>
      <button onClick={() => setOpen(true)}>Open</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Review">
        <input aria-label="Input" />
        <button disabled>Save</button>
      </Sheet>
    </LookProvider>
  );
}
createRoot(document.getElementById('root')!).render(<Demo />);
```

Файл `apps/web/e2e/review-findings.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mockSync } from './sync-mock';
import { mockAuth, USER, OWNER } from './auth-mock';

test('review: failed logout leaves the session active', async ({ page }) => {
  const auth = await mockAuth(page, { me: USER });
  await mockSync(page);
  await page.route('**/api/auth/logout', (r) => r.abort('failed'));
  await page.goto('/account');
  await page.getByRole('button', { name: 'Выйти здесь', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(auth.me?.id).toBe(USER.id);
  await page.goto('/account');
  await expect(page.getByRole('button', { name: 'Выйти здесь', exact: true })).toBeVisible();
  console.log('LOGOUT_REOPENED', auth.me?.id);
});

test('review: sheet focus escapes past a disabled button', async ({ page }) => {
  await page.goto('/review-sheet.html');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('textbox', { name: 'Input' }).focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
    false,
  );
  console.log('SHEET_FOCUS', await page.evaluate(() => document.activeElement?.tagName));
});

test('review: stale account queue uses replacement cookies', async ({ page, context }) => {
  await mockAuth(page, { me: USER });
  const sync = await mockSync(page);
  sync.offline = true;
  let account = USER;
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: account }));
  await page.goto('/inbox');
  await page.waitForFunction(() => localStorage.getItem('qubite.sync.account')?.endsWith('2'));
  await page.evaluate(async () => {
    const { SyncClient, httpTransport } =
      await import('/@fs/tmp/qubite-review/packages/sync-client/src/index.ts');
    const c = await SyncClient.open({
      dbName: 'qubite-sync-' + localStorage.getItem('qubite.sync.account'),
      transport: httpTransport(),
    });
    await c.create('inbox.item', 'PRIVATE-A-REVIEW', {
      body: 'PRIVATE-A-REVIEW',
      source: 'web',
      kind: 'text',
    });
    c.close();
  });
  account = OWNER;
  await context.addCookies([
    { name: 'qubite_csrf', value: 'csrf-for-account-B', domain: '127.0.0.1', path: '/' },
  ]);
  await page.evaluate((id) => localStorage.setItem('qubite.sync.account', id), OWNER.id);
  let leaked: unknown = null;
  await page.route('**/api/v1/sync/push', async (r) => {
    leaked = {
      headers: await r.request().allHeaders(),
      body: r.request().postDataJSON(),
      authenticatedAccount: account.id,
    };
    await r.fallback();
  });
  sync.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => leaked).not.toBeNull();
  expect(JSON.stringify(leaked)).toContain('PRIVATE-A-REVIEW');
  expect(JSON.stringify(leaked)).toContain('csrf-for-account-B');
  console.log('ACCOUNT_CROSSOVER', JSON.stringify(leaked));
});

test('review: production CSP blocks local Whisper', async ({ page }) => {
  const csp = /Content-Security-Policy "([^"]+)"/.exec(
    readFileSync('../../deploy/pi/qubite.caddy', 'utf8'),
  )![1]!;
  await page.route('**/review-csp', (r) =>
    r.fulfill({
      contentType: 'text/html',
      headers: { 'Content-Security-Policy': csp },
      body: '<!doctype html><html><body>Review</body></html>',
    }),
  );
  await page.goto('/review-csp');
  const events = await page.evaluate(async () => {
    const found: { directive: string; uri: string }[] = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      found.push({ directive: e.violatedDirective, uri: e.blockedURI }),
    );
    await fetch('http://127.0.0.1:8080/inference', { method: 'POST', body: new FormData() }).catch(
      () => {},
    );
    await new Promise((r) => setTimeout(r, 100));
    return found;
  });
  expect(events).toContainEqual({
    directive: 'connect-src',
    uri: 'http://127.0.0.1:8080/inference',
  });
  console.log('WHISPER_CSP', events);
});
```

Файл `apps/web/e2e/review-cache.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { mockAuth, USER, OWNER } from './auth-mock';
import { mockSync } from './sync-mock';

test('review: sessions cached for A remain visible after login as B', async ({ page }) => {
  const auth = await mockAuth(page, { me: USER });
  await mockSync(page);
  auth.sessions[0]!.ip = '192.0.2.99';
  let isB = false;
  await page.route('**/api/auth/sessions', async (r) => {
    if (isB)
      await r.fulfill({ status: 503, json: { error: 'unavailable', message: 'mock unavailable' } });
    else await r.fallback();
  });
  await page.goto('/account');
  await expect(page.getByText(/192\.0\.2\.99/)).toBeVisible();
  await page.getByRole('button', { name: 'Выйти здесь', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(auth.me).toBeNull();
  isB = true;
  auth.sessions = [];
  await page.getByRole('link', { name: 'Войти', exact: true }).first().click();
  await page.getByLabel('Почта').fill(OWNER.email);
  await page.getByLabel('Пароль', { exact: true }).fill(auth.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  expect(auth.me?.id).toBe(OWNER.id);
  await page.getByRole('link', { name: /Аккаунт:/ }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(/192\.0\.2\.99/)).toBeVisible();
  console.log('CACHED_A_SESSION_VISIBLE_TO_B', {
    loggedIn: auth.me?.id,
    oldIp: '192.0.2.99',
    serverSessions: auth.sessions.length,
  });
});
```
