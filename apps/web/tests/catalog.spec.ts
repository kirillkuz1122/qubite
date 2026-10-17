import { test, expect, type Page } from "@playwright/test";
const profile = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "user@example.test",
  display_name: "Пользователь",
  platform_owner: false,
};
const doc = {
  module: "docs",
  name: "Документы",
  summary: "Материалы пользователя.",
  label: "Qubite Docs",
  tone: "yellow",
  icon: "document",
  visibility: "locked",
  status: "locked",
  access_expires_at: null,
};
async function api(page: Page, items: unknown[], owner = false) {
  await page.route("**/api/v1/me", (r) =>
    r.fulfill({ json: { ...profile, platform_owner: owner } }),
  );
  await page.route("**/api/v1/me/access", (r) =>
    r.fulfill({ json: { revision: 1, items: [] } }),
  );
  await page.route("**/api/v1/me/modules", (r) =>
    r.fulfill({ json: { revision: 1, items } }),
  );
  await page.route("**/api/v1/me/modules/*", (r) => {
    const found = items.find(
      (m) => (m as typeof doc).module === r.request().url().split("/").at(-1),
    );
    return r.fulfill(
      found
        ? { json: { revision: 1, items: [found] } }
        : { status: 404, json: { code: "not_found" } },
    );
  });
}
test("server catalog controls default locked cards and direct routes, without read grant inference", async ({
  page,
}) => {
  await api(page, [doc]);
  await page.goto("/#/modules");
  await expect(page.getByRole("link", { name: /Qubite Docs/ })).toContainText(
    "Нет доступа",
  );
  await page.goto("/#/modules/docs");
  await expect(
    page.getByRole("heading", { name: "Здесь пока нет доступа" }),
  ).toBeVisible();
  await page.goto("/#/modules/unknown");
  await expect(
    page
      .getByRole("heading", { name: "Страница не найдена", exact: true })
      .first(),
  ).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Qubite Docs");
});
for (const bad of [
  { ...doc, visibility: "hidden" },
  { ...doc, private_payload: "no" },
  { ...doc, module: "../owner" },
  { ...doc, icon: "<svg>" },
  { ...doc, status: "paid_bypass" },
])
  test(
    "malformed catalog fails closed " + JSON.stringify(bad),
    async ({ page }) => {
      await api(page, [bad]);
      await page.goto("/#/modules");
      await expect(
        page.getByRole("heading", { name: "Не удалось загрузить каталог" }),
      ).toBeVisible();
      await expect(page.locator(".module-card")).toHaveCount(0);
      await expect(page.locator("main")).not.toContainText("Qubite Docs");
    },
  );
test("direct lookup revision mismatch hides an earlier visible snapshot", async ({
  page,
}) => {
  await api(page, [{ ...doc, status: "preparing" }]);
  await page.route("**/api/v1/me/modules/docs", (r) =>
    r.fulfill({
      json: { revision: 2, items: [{ ...doc, status: "preparing" }] },
    }),
  );
  await page.goto("/#/modules/docs");
  await expect(
    page.getByRole("heading", { name: "Не удалось загрузить каталог" }),
  ).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Документы");
});
test("expired hidden grant is never painted and never triggers a retry loop", async ({
  page,
}) => {
  let count = 0;
  await api(page, [
    {
      ...doc,
      visibility: "hidden",
      status: "preparing",
      access_expires_at: "2020-01-01T00:00:00Z",
    },
  ]);
  page.on("request", (r) => {
    if (r.url().endsWith("/me/modules")) ++count;
  });
  await page.goto("/#/modules");
  await expect(
    page.getByRole("heading", { name: "Модули ещё не добавлены" }),
  ).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Документы");
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  expect(count).toBeLessThanOrEqual(2); // StrictMode may mount twice; expiry must not loop.
});
test("catalog revalidation cancels old replies and clears metadata before network response", async ({
  page,
}) => {
  await api(page, [{ ...doc, visibility: "hidden", status: "preparing" }]);
  await page.goto("/#/modules");
  await expect(page.getByRole("link", { name: /Qubite Docs/ })).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let delayed = false;
  await page.route("**/api/v1/me/modules", async (r) => {
    delayed = true;
    await gate;
    try {
      await r.fulfill({
        json: { revision: 1, items: [{ ...doc, status: "preparing" }] },
      });
    } catch {}
  });
  await page.goto("/#/profile");
  await expect.poll(() => delayed).toBeTruthy();
  await page.route("**/api/v1/me/modules", (r) =>
    r.fulfill({ json: { revision: 2, items: [] } }),
  );
  await page.goto("/#/modules");
  await expect(
    page.getByRole("heading", { name: "Модули ещё не добавлены" }),
  ).toBeVisible();
  release();
  await expect(page.getByRole("link", { name: /Qubite Docs/ })).toHaveCount(0);
});
test("owner timeout leaves no fake save, leaks no password to storage and does not replay", async ({
  page,
}) => {
  await api(page, [doc], true);
  await page.route("**/api/v1/owner/console", (r) =>
    r.fulfill({
      json: {
        data: {
          revision: "owner-1-1-1",
          timezone: "Asia/Yekaterinburg",
          timeout_seconds: 60,
          now: "2030-01-01T00:00:00Z",
          reauth_until: null,
          registration: {
            mode: "invite",
            revision: 1,
            consent_version: "2026-10-13",
          },
          modules: [
            {
              id: "docs",
              name: "Документы",
              visibility: "locked",
              installed: false,
              enabled: false,
              released: false,
            },
          ],
        },
      },
    }),
  );
  await page.route("**/api/v1/auth/csrf", (r) =>
    r.fulfill({ json: { csrf_token: "qbt_c_" + "c".repeat(43) } }),
  );
  await page.route("**/api/v1/auth/reauth", (r) => r.fulfill({ status: 204 }));
  let saves = 0;
  await page.route("**/api/v1/owner/console/commands", (r) => {
    ++saves;
    expect(r.request().headers()["if-match"]).toBe('"owner-1-1-1"');
    expect(r.request().headers()["idempotency-key"]).toMatch(/^[a-f0-9-]{36}$/);
    return r.fulfill({ status: 503, json: { code: "policy_unavailable" } });
  });
  await page.goto("/#/settings/owner");
  await page
    .getByRole("group", { name: "Документы: без доступа" })
    .getByRole("button", { name: "Скрывать" })
    .click();
  await page
    .getByLabel("Твой пароль для подтверждения")
    .fill("Synthetic password only 42!");
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("временно недоступны");
  expect(saves).toBe(1);
  await expect(page.getByLabel("Твой пароль для подтверждения")).toHaveValue(
    "",
  );
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("Synthetic password");
});
