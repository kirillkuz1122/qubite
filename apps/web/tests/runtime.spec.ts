import { test, expect, type Page } from "@playwright/test";
const profile = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "user@example.test",
  display_name: "Настоящий контракт",
  platform_owner: false,
};
const grant = (
  module: string,
  action: string,
  expires_at: string | null = null,
) => ({ module, action, expires_at });
async function api(
  page: Page,
  p: unknown = profile,
  access: unknown = { revision: 1, items: [] },
) {
  await page.route("**/api/v1/me", (r) => r.fulfill({ json: p }));
  await page.route("**/api/v1/me/access", (r) => r.fulfill({ json: access }));
}
test("live actor comes only from API; query and storage cannot select demo owner", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("qubite.role", "owner");
    localStorage.setItem(
      "qubite.ui.v1",
      JSON.stringify({ owner: true, dark: false }),
    );
  });
  await api(page);
  await page.goto("/?demo=1&role=owner#/profile");
  await expect(
    page.getByRole("heading", { name: profile.display_name }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Демо", exact: false }),
  ).toHaveCount(0);
  await page.goto("/#/settings/owner");
  await expect(
    page.getByRole("heading", { name: "Здесь пока нет доступа" }),
  ).toBeVisible();
  await page.goto("/#/modules");
  await expect(
    page.getByRole("heading", { name: "Модули ещё не добавлены" }),
  ).toBeVisible();
});
test("owner status does not bypass read grants or create server visibility settings", async ({
  page,
}) => {
  await api(page, { ...profile, platform_owner: true });
  await page.goto("/#/settings/owner");
  await expect(
    page.getByRole("heading", { name: "Настройка каталога готовится" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await page.goto("/#/modules/docs");
  await expect(
    page
      .getByRole("heading", { name: "Страница не найдена", exact: true })
      .first(),
  ).toBeVisible();
});
test("read/write independent, expired grants denied, live command has no fake save", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") requests.push(r.url());
  });
  await api(page, profile, {
    revision: 3,
    items: [
      grant("docs", "write"),
      grant("inbox", "read"),
      grant("projects", "read", "2020-01-01T00:00:00Z"),
    ],
  });
  await page.goto("/#/inbox");
  await expect(
    page.getByRole("heading", { name: "Здесь можно выдохнуть" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Добавить мысль" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "Скинь мысль" }),
  ).toBeDisabled();
  await page.goto("/#/modules/docs");
  await expect(
    page
      .getByRole("heading", { name: "Страница не найдена", exact: true })
      .first(),
  ).toBeVisible();
  await page.goto("/#/modules/projects");
  await expect(
    page
      .getByRole("heading", { name: "Страница не найдена", exact: true })
      .first(),
  ).toBeVisible();
  expect(requests).toEqual([]);
});
test("real read permission exposes unavailable module, not imported legacy UI", async ({
  page,
}) => {
  await api(page, profile, { revision: 1, items: [grant("docs", "read")] });
  await page.goto("/#/modules/docs");
  await expect(
    page.getByRole("heading", {
      name: "Документы — скоро в твоём пространстве",
    }),
  ).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
});
for (const status of [401, 403, 429, 503])
  test(`HTTP ${status} removes authenticated shell`, async ({ page }) => {
    await page.route("**/api/v1/me", (r) =>
      r.fulfill({ status, json: { message: "secret error detail" } }),
    );
    await page.goto("/#/settings/owner");
    await expect(
      page.getByRole("heading", {
        name: [401, 403].includes(status)
          ? "Начнём с твоего аккаунта"
          : "Не удалось открыть пространство",
      }),
    ).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("secret error detail");
  });
for (const scenario of [
  "owner string",
  "extra property",
  "invalid grant",
  "access error",
])
  test(`malformed response fails closed: ${scenario}`, async ({ page }) => {
    const p =
      scenario === "owner string"
        ? { ...profile, platform_owner: "true" }
        : scenario === "extra property"
          ? { ...profile, role: "owner" }
          : profile;
    await api(page, p, {
      revision: 1,
      items: scenario === "invalid grant" ? [grant("docs", "admin")] : [],
    });
    if (scenario === "access error")
      await page.route("**/api/v1/me/access", (r) =>
        r.fulfill({ status: 403, json: {} }),
      );
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name:
          scenario === "access error"
            ? "Начнём с твоего аккаунта"
            : "Не удалось открыть пространство",
      }),
    ).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveCount(0);
  });
test("revalidation clears stale owner and rechecks revoked grants", async ({
  page,
}) => {
  await api(
    page,
    { ...profile, platform_owner: true },
    { revision: 1, items: [grant("docs", "read")] },
  );
  await page.goto("/#/settings");
  await expect(
    page.getByRole("link", { name: "Управление Qubite" }),
  ).toBeVisible();
  await page.route("**/api/v1/me", (r) => r.fulfill({ status: 401, json: {} }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Начнём с твоего аккаунта" }),
  ).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);
});
test("aborted response from an older refresh cannot restore owner", async ({
  page,
}) => {
  await api(page, { ...profile, platform_owner: true });
  await page.goto("/#/settings");
  await expect(
    page.getByRole("link", { name: "Управление Qubite" }),
  ).toBeVisible();
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let delayed = false;
  await page.route("**/api/v1/me", async (r) => {
    if (!delayed) {
      delayed = true;
      await blocked;
      await r
        .fulfill({ json: { ...profile, platform_owner: true } })
        .catch(() => {});
    } else await r.fulfill({ status: 401, json: {} });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => delayed).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Начнём с твоего аккаунта" }),
  ).toBeVisible();
  release();
  await expect(page.locator(".app-shell")).toHaveCount(0);
});
