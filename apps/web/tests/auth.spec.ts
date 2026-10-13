import { test, expect, type Page } from "@playwright/test";
const csrf = "qbt_c_" + "a".repeat(43);
async function anonymous(page: Page) {
  await page.route("**/api/v1/me", (r) =>
    r.fulfill({ status: 401, json: { code: "unauthenticated" } }),
  );
  await page.route("**/api/v1/auth/oauth/providers", (r) =>
    r.fulfill({
      json: {
        items: ["google", "yandex", "vk", "telegram"].map((provider) => ({
          provider,
          available: provider === "google",
        })),
      },
    }),
  );
  await page.route("**/api/v1/auth/csrf", (r) =>
    r.fulfill({ json: { csrf_token: csrf } }),
  );
  await page.route("**/api/v1/auth/registration", (r) =>
    r.fulfill({
      json: {
        mode: "public",
        revision: 1,
        consent_version: "qubite-account-v1",
      },
    }),
  );
}
async function form(page: Page) {
  await page.goto("/#/auth/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill("fictional@example.test");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("Synthetic password 42!");
}
test("failed CSRF shows a bounded error and a new challenge on each deliberate retry", async ({
  page,
}) => {
  await anonymous(page);
  let challenges = 0,
    posts = 0;
  await page.route("**/api/v1/auth/csrf", (r) => {
    challenges++;
    return r.fulfill({ json: { csrf_token: csrf } });
  });
  await page.route("**/api/v1/auth/session", (r) => {
    posts++;
    expect(r.request().headers()["x-csrf-token"]).toBe(csrf);
    return r.fulfill({
      status: 403,
      json: { code: "csrf_failed", password: "must never render" },
    });
  });
  await form(page);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Проверка безопасности");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect.poll(() => posts).toBe(2);
  expect(challenges).toBe(2);
  await expect(page.locator("body")).not.toContainText("must never render");
});
for (const status of [429, 503])
  test(`controlled HTTP ${status}, no fake authenticated UI or automatic retry`, async ({
    page,
  }) => {
    await anonymous(page);
    let posts = 0;
    await page.route("**/api/v1/auth/session", (r) => {
      posts++;
      return r.fulfill({
        status,
        json: {
          code: status === 429 ? "rate_limited" : "identity_unavailable",
        },
      });
    });
    await form(page);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      status === 429 ? "пять минут" : "недоступен",
    );
    await expect(page.locator(".app-shell")).toHaveCount(0);
    expect(posts).toBe(1);
  });
test("abandoned login response cannot navigate or store credentials; no private transition snapshot", async ({
  page,
}) => {
  await anonymous(page);
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  let started = false;
  await page.route("**/api/v1/auth/session", async (r) => {
    started = true;
    await gate;
    await r
      .fulfill({ status: 401, json: { code: "invalid_credentials" } })
      .catch(() => {});
  });
  await form(page);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole("button", { name: "Регистрация", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Начнём с тебя." }),
  ).toBeVisible();
  release();
  await expect(page).toHaveURL(/\/auth\/register$/);
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("");
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
        ghost: document.querySelector(".morph-ghost")?.innerHTML,
      }),
    ),
  ).not.toContain("Synthetic password");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
for (const url of [
  "javascript:alert(1)",
  "https://evil.example.test/authorize?state=x",
  "https://accounts.google.com.evil.example.test/o/oauth2/v2/auth?state=x",
])
  test(`OAuth navigation refuses untrusted authorization URL ${url}`, async ({
    page,
  }) => {
    await anonymous(page);
    await page.route("**/api/v1/auth/oauth/google/start", (r) =>
      r.fulfill({ json: { authorization_url: url } }),
    );
    await form(page);
    await page.getByRole("button", { name: "Google", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Не удалось");
    await expect(page).toHaveURL(/\/auth\/login$/);
  });
test("registration refuses a changed document version and malicious error code stays generic", async ({
  page,
}) => {
  await anonymous(page);
  await page.route("**/api/v1/auth/registration", (r) =>
    r.fulfill({
      json: { mode: "public", revision: 2, consent_version: "other-terms-v2" },
    }),
  );
  await page.goto("/#/auth/register");
  await expect(
    page.getByRole("button", { name: "Создать аккаунт", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("не совпадает");
  await page.route("**/api/v1/auth/session", (r) =>
    r.fulfill({ status: 400, json: { code: "__proto__" } }),
  );
  await form(page);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Не удалось завершить");
});
test("fragment duplicate and return target cannot become an auth request or external redirect", async ({
  page,
}) => {
  await anonymous(page);
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() !== "GET") posts++;
  });
  await page.goto(
    "/#/auth/register?invite=secret&invite=second&return_to=https%3A%2F%2Fevil.example.test",
  );
  await expect(page).toHaveURL(/\/auth\/login$/);
  await expect(page.getByRole("alert")).toContainText("Ссылка недействительна");
  expect(posts).toBe(0);
});
