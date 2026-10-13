import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const owner = "browser-owner@example.test",
  password = "Synthetic browser password 42!",
  replacement = "Synthetic replacement password 53!";
test.describe.configure({ mode: "default" });
test.beforeEach(async ({ request, context }) => {
  await context.clearCookies();
  expect(
    (await request.post("/__fixture__/reset", { data: {} })).ok(),
  ).toBeTruthy();
});
async function login(page: Page, email = owner, pass = password) {
  await page.goto("/#/auth/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel(/^Пароль/)
    .first()
    .fill(pass);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
}
async function register(
  page: Page,
  email = "new-browser@example.test",
  invitation?: string,
) {
  await page.goto(
    invitation && invitation.startsWith("http")
      ? invitation
      : "/#/auth/register",
  );
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel(/^Пароль/)
    .first()
    .fill(password);
  if (invitation && !invitation.startsWith("http"))
    await page.getByLabel(/^Приглашение/).fill(invitation);
  await page
    .getByRole("switch", { name: "Я принимаю условия использования" })
    .click();
  await page
    .getByRole("switch", {
      name: "Я даю согласие на обработку данных аккаунта",
    })
    .click();
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Запрос принят");
}
async function proof(page: Page, purpose = "verify") {
  const data = await (await page.request.get("/__fixture__/mail")).json();
  return data.items
    .filter((x: { purpose: string }) => x.purpose === purpose)
    .at(-1) as { challenge_id: string; token: string };
}
function proofURL(
  p: { challenge_id: string; token: string },
  purpose = "verify",
) {
  return `/#/auth/${purpose === "verify" ? "verify" : "reset-confirm"}?challenge_id=${p.challenge_id}&token=${p.token}`;
}
test("anonymous website has landing, separate material Auth, public legal and real unavailable providers", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Твоя жизнь. Связно." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Войти в Qubite" }).click();
  await expect(
    page.getByRole("heading", { name: "С возвращением." }),
  ).toBeVisible();
  await expect(page.locator(".public-shell")).toHaveAttribute(
    "data-material",
    "flux",
  );
  for (const name of ["Google", "Яндекс", "VK", "Telegram"])
    await expect(
      page.getByRole("button", { name: new RegExp(name + " Пока недоступно") }),
    ).toBeDisabled();
  await page.getByRole("link", { name: "Cookies", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Cookies и хранение на устройстве" }),
  ).toBeVisible();
  expect(
    await (await page.request.get("/__fixture__/counts")).json(),
  ).toMatchObject({ subjects: 1, sessions: 0 });
});
test("real owner login with Enter, fresh grants, HttpOnly cookies, logout", async ({
  page,
  context,
}) => {
  await page.goto("/#/auth/login");
  await page.getByLabel("Email", { exact: true }).fill(owner);
  const field = page.getByLabel(/^Пароль/).first();
  await field.fill(password);
  await field.press("Enter");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page).toHaveURL(/\/#\/$/);
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "qubite_local_session")).toMatchObject({
    httpOnly: true,
    sameSite: "Lax",
  });
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "qubite_local_session",
  );
  await page.goto("/#/modules");
  await expect(
    page.getByRole("heading", { name: "Модули ещё не добавлены" }),
  ).toBeVisible();
  await page.goto("/#/profile");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "С возвращением." }),
  ).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  expect((await page.request.get("/api/v1/me")).status()).toBe(401);
});
test("failed password consumes preauth; next attempt gets fresh CSRF and succeeds", async ({
  page,
}) => {
  await login(page, owner, "Wrong synthetic password 42!");
  await expect(page.getByRole("alert")).toContainText("Не удалось войти");
  await page
    .getByLabel(/^Пароль/)
    .first()
    .fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
});
test("registration requires two independent choices, email confirmation is POST-only and grants remain empty", async ({
  page,
}) => {
  await page.goto("/#/auth/register");
  await page
    .getByLabel("Email", { exact: true })
    .fill("new-browser@example.test");
  await page
    .getByLabel(/^Пароль/)
    .first()
    .fill(password);
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("отдельно");
  expect((await page.request.get("/__fixture__/counts")).ok()).toBeTruthy();
  await register(page);
  const p = await proof(page);
  await page.goto(proofURL(p));
  await expect(page).toHaveURL(/\/#\/auth\/verify$/);
  expect((await page.request.get("/api/v1/me")).status()).toBe(401);
  await expect(
    page.getByText("Ссылка распознана.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Подтвердить почту", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Почта подтверждена");
  expect((await page.request.get("/api/v1/me")).status()).toBe(401);
  await login(page, "new-browser@example.test");
  await expect(page.locator(".app-shell")).toBeVisible();
  const access = await (await page.request.get("/api/v1/me/access")).json();
  expect(access.items).toEqual([]);
  await page.goto("/#/settings");
  await expect(
    page.getByRole("link", { name: "Управление Qubite" }),
  ).toHaveCount(0);
});
for (const via of ["link", "manual"])
  test(`invitation ${via} enrolls once; token purged and never stored`, async ({
    page,
    request,
  }) => {
    await request.post("/__fixture__/reset", { data: { mode: "invite" } });
    const t = (await (await request.post("/__fixture__/invite")).json())
      .token as string;
    const link = `http://127.0.0.1:4323/#/auth/register?invite=${t}`;
    await register(page, "invited@example.test", via === "link" ? link : t);
    await expect(page).toHaveURL(/\/#\/auth\/register$/);
    expect(
      await page.evaluate(() =>
        JSON.stringify({
          local: { ...localStorage },
          session: { ...sessionStorage },
        }),
      ),
    ).not.toContain(t);
    const p = await proof(page);
    await page.goto(proofURL(p));
    await page
      .getByRole("button", { name: "Подтвердить почту", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Почта подтверждена");
    await login(page, "invited@example.test");
    await expect(page.locator(".app-shell")).toBeVisible();
    expect(
      await (await request.get("/__fixture__/counts")).json(),
    ).toMatchObject({
      subjects: 2,
      registration_consents: 1,
      policy_entitlements: 0,
      policy_ai_grants: 0,
    });
  });
test("closed registration keeps login, unavailable mail never pretends to send", async ({
  page,
  request,
}) => {
  await request.post("/__fixture__/reset", { data: { mode: "disabled" } });
  await page.goto("/#/auth/register");
  await expect(page.getByRole("status")).toContainText("выключено");
  await expect(
    page
      .getByRole("form")
      .getByRole("button", { name: "Создать аккаунт", exact: true }),
  ).toHaveCount(0);
  await login(page);
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.context().clearCookies();
  await request.post("/__fixture__/reset", { data: { mail_enabled: false } });
  await page.reload();
  await page.goto("/#/auth/register");
  await page
    .getByLabel("Email", { exact: true })
    .fill("new-browser@example.test");
  await page
    .getByLabel(/^Пароль/)
    .first()
    .fill(password);
  await page
    .getByRole("switch", { name: "Я принимаю условия использования" })
    .click();
  await page
    .getByRole("switch", {
      name: "Я даю согласие на обработку данных аккаунта",
    })
    .click();
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Отправка писем сейчас недоступна",
  );
  expect(await (await request.get("/__fixture__/counts")).json()).toMatchObject(
    { subjects: 1, registration_consents: 0 },
  );
});
test("reset proof changes password, revokes every browser and never automatically signs in", async ({
  page,
  browser,
  request,
}) => {
  await login(page);
  await expect(page.locator(".app-shell")).toBeVisible();
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:4323" });
  const b = await other.newPage();
  await login(b);
  await expect(b.locator(".app-shell")).toBeVisible();
  const c = await browser.newContext({ baseURL: "http://127.0.0.1:4323" });
  const recovery = await c.newPage();
  await recovery.goto("http://127.0.0.1:4323/#/auth/reset");
  await recovery.getByLabel("Email", { exact: true }).fill(owner);
  await recovery.getByRole("button", { name: "Запросить письмо" }).click();
  await expect(recovery.getByRole("status")).toContainText("Запрос принят");
  const p = await proof(recovery, "reset");
  await recovery.goto("http://127.0.0.1:4323" + proofURL(p, "reset"));
  await expect(recovery).toHaveURL(/\/#\/auth\/reset-confirm$/);
  await recovery.getByLabel("Новый пароль", { exact: true }).fill(replacement);
  await recovery.getByRole("button", { name: "Изменить пароль" }).click();
  await expect(recovery.getByRole("status")).toContainText(
    "Прежние сессии завершены",
  );
  expect((await recovery.request.get("/api/v1/me")).status()).toBe(401);
  await page.evaluate(() => dispatchEvent(new Event("focus")));
  await b.evaluate(() => dispatchEvent(new Event("focus")));
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await expect(b.locator(".app-shell")).toHaveCount(0);
  await login(recovery, owner, password);
  await expect(recovery.getByRole("alert")).toContainText("Не удалось войти");
  await recovery
    .getByLabel(/^Пароль/)
    .first()
    .fill(replacement);
  await recovery.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(recovery.locator(".app-shell")).toBeVisible();
  await other.close();
  await c.close();
});
test("profile revokes another session; logout-all closes the current one", async ({
  page,
  browser,
}) => {
  await login(page);
  await expect(page.locator(".app-shell")).toBeVisible();
  const c = await browser.newContext({ baseURL: "http://127.0.0.1:4323" });
  const b = await c.newPage();
  await login(b);
  await expect(b.locator(".app-shell")).toBeVisible();
  await page.goto("/#/profile");
  await page.getByRole("button", { name: "Завершить другую сессию" }).click();
  await expect
    .poll(async () => (await b.request.get("/api/v1/me")).status())
    .toBe(401);
  expect((await page.request.get("/api/v1/me")).status()).toBe(200);
  await page.getByRole("button", { name: "Выйти на всех устройствах" }).click();
  await page.getByLabel("Пароль для завершения всех сессий").fill(password);
  await page
    .getByRole("button", { name: "Подтвердить выход на всех устройствах" })
    .click();
  await expect(
    page.getByRole("heading", { name: "С возвращением." }),
  ).toBeVisible();
  await c.close();
});
test("one-use invalid proof rejects without login; manual confirmation is available", async ({
  page,
}) => {
  await register(page);
  const p = await proof(page);
  await page.goto("/#/auth/verify");
  await page.getByLabel("Номер подтверждения из письма").fill(p.challenge_id);
  await page.getByLabel("Токен подтверждения из письма").fill(p.token);
  await page
    .getByRole("button", { name: "Подтвердить почту", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Почта подтверждена");
  await page.goto(proofURL(p));
  await page
    .getByRole("button", { name: "Подтвердить почту", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Ссылка недействительна");
  expect((await page.request.get("/api/v1/me")).status()).toBe(401);
});
test("auth and legal reflow, keyboard, reduced motion, theme and axe", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 844, height: 390 },
    { width: 640, height: 900 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/#/auth/register");
    await expect(
      page.getByRole("heading", { name: "Начнём с тебя." }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page
        .getByRole("button", { name: "Тёмная тема", exact: true })
        .click();
    for (const route of [
      "/auth/login",
      "/auth/register",
      "/auth/reset",
      "/auth/verify",
      "/auth/reset-confirm",
      "/legal/terms",
      "/legal/privacy",
      "/legal/cookies",
      "/legal/consent",
    ]) {
      await page.goto("/#" + route);
      await expect(page.locator("h1")).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.getAnimations().filter((a) => a.playState === "running")
                .length,
          ),
        )
        .toBe(0);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/auth/login");
  await page.getByLabel("Email", { exact: true }).fill(owner);
  await page
    .getByLabel(/^Пароль/)
    .first()
    .fill(password);
  await page.getByRole("button", { name: "Показать пароль" }).click();
  await expect(page.getByLabel(/^Пароль/).first()).toHaveAttribute(
    "type",
    "text",
  );
  await page.getByRole("button", { name: "Скрыть пароль" }).click();
  await page
    .getByLabel(/^Пароль/)
    .first()
    .press("Enter");
  await expect(page.locator(".app-shell")).toBeVisible();
});
