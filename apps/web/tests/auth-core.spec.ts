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
  await expect(page.getByRole("link", { name: /Qubite Docs/ })).toBeVisible();
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

async function signedIn(page: Page, email = owner) {
  await login(page, email);
  await expect(page.locator(".app-shell")).toBeVisible();
}
async function policyCommand(page: Page, body: unknown) {
  const nonce = await (await page.request.get("/api/v1/auth/csrf")).json();
  const current = await page.request.get("/api/v1/owner/modules");
  const r = await page.request.post("/api/v1/owner/policy/commands", {
    data: { reason: "configure", ...(body as object) },
    headers: {
      Origin: "http://127.0.0.1:4323",
      "X-CSRF-Token": nonce.csrf_token,
      "If-Match": current.headers()["etag"],
      "Idempotency-Key": crypto.randomUUID(),
    },
  });
  expect(r.status()).toBe(200);
}
test("real owner saves shared visibility with reauth; defaults locked and no permission is granted", async ({
  page,
}) => {
  await signedIn(page);
  await page.goto("/#/modules");
  await expect(page.locator(".module-card")).toHaveCount(8);
  await expect(
    page.locator(".module-status").filter({ hasText: "Нет доступа" }),
  ).toHaveCount(8);
  await page.goto("/#/settings/owner");
  await page
    .getByRole("group", { name: "Документы: без доступа" })
    .getByRole("button", { name: "Скрывать" })
    .click();
  await page
    .getByRole("group", { name: "Поиск: без доступа" })
    .getByRole("button", { name: "Скрывать" })
    .click();
  await page.getByLabel("Твой пароль для подтверждения").fill(password);
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Изменения сохранены на сервере" }),
  ).toBeVisible();
  await expect(page.getByLabel("Твой пароль для подтверждения")).toHaveValue(
    "",
  );
  for (const name of ["Документы", "Поиск"])
    await expect(
      page
        .getByRole("group", { name: name + ": без доступа" })
        .getByRole("button", { name: "Скрывать" }),
    ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(
    page
      .getByRole("group", { name: "Документы: без доступа" })
      .getByRole("button", { name: "Скрывать" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.goto("/#/modules/docs");
  await expect(
    page
      .getByRole("heading", { name: "Страница не найдена", exact: true })
      .first(),
  ).toBeVisible();
  expect((await page.request.get("/api/v1/me/access")).ok()).toBeTruthy();
  expect(
    await (await page.request.get("/api/v1/me/access")).json(),
  ).toMatchObject({ items: [] });
});
test("real granted member sees preparing and disabled status, then loses hidden metadata after revoke", async ({
  page,
  browser,
}) => {
  await signedIn(page);
  const fixture = await (
    await page.request.post("/__fixture__/catalog", { data: {} })
  ).json();
  await policyCommand(page, {
    kind: "catalog_visibility",
    module: "docs",
    visibility: "hidden",
  });
  await policyCommand(page, {
    kind: "entitlement",
    module: "docs",
    subject_id: fixture.member_id,
    action: "read",
    effect: "allow",
  });
  const c = await browser.newContext({ baseURL: "http://127.0.0.1:4323" }),
    u = await c.newPage();
  await signedIn(u, "browser-member@example.test");
  await u.goto("/#/modules");
  await expect(u.getByRole("link", { name: /Qubite Docs/ })).toContainText(
    "Готовится",
  );
  expect((await u.request.get("/api/v1/owner/modules")).status()).toBe(403);
  await page.request.post("/__fixture__/catalog", {
    data: { status: "unavailable" },
  });
  await u.goto("/#/modules/docs");
  await expect(
    u.getByRole("heading", { name: "Документы — временно недоступен" }),
  ).toBeVisible();
  await policyCommand(page, {
    kind: "entitlement",
    module: "docs",
    subject_id: fixture.member_id,
    action: "read",
    effect: "deny",
  });
  await u.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    u
      .getByRole("heading", { name: "Страница не найдена", exact: true })
      .first(),
  ).toBeVisible();
  await expect(u.locator("main")).not.toContainText("Документы");
  expect((await u.request.get("/api/v1/me/modules/docs")).status()).toBe(404);
  await u.goto("/#/modules");
  await expect(u.locator(".module-card")).toHaveCount(7);
  await c.close();
});
test("two real owner tabs reject stale save; wrong password and conflicts never optimistically save", async ({
  page,
  browser,
}) => {
  await signedIn(page);
  await page.goto("/#/settings/owner");
  const c = await browser.newContext({ baseURL: "http://127.0.0.1:4323" }),
    other = await c.newPage();
  await signedIn(other);
  await other.goto("/#/settings/owner");
  await expect(
    other.getByRole("heading", { name: "Видимость модулей" }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "Документы: без доступа" })
    .getByRole("button", { name: "Скрывать" })
    .click();
  await page
    .getByLabel("Твой пароль для подтверждения")
    .fill("Wrong synthetic password 42!");
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Не удалось войти");
  expect(
    (await (await page.request.get("/api/v1/owner/modules")).json()).items.find(
      (m: { module: string }) => m.module === "docs",
    ).visibility,
  ).toBe("locked");
  await page.getByLabel("Твой пароль для подтверждения").fill(password);
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(
    page
      .getByRole("group", { name: "Документы: без доступа" })
      .getByRole("button", { name: "Скрывать" }),
  ).toHaveAttribute("aria-pressed", "true");
  await other
    .getByRole("group", { name: "Соединение: без доступа" })
    .getByRole("button", { name: "Скрывать" })
    .click();
  await other.getByLabel("Твой пароль для подтверждения").fill(password);
  await other
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(other.getByRole("alert")).toContainText("другой вкладке");
  expect(
    (
      await (await other.request.get("/api/v1/owner/modules")).json()
    ).items.find((m: { module: string }) => m.module === "vpn").visibility,
  ).toBe("locked");
  await other
    .getByRole("button", { name: "Обновить настройки", exact: true })
    .click();
  await other
    .getByRole("button", { name: "Я сверил: использовать текущую версию" })
    .click();
  await other.getByLabel("Твой пароль для подтверждения").fill(password);
  await other
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(
    other
      .getByRole("group", { name: "Соединение: без доступа" })
      .getByRole("button", { name: "Скрывать" }),
  ).toHaveAttribute("aria-pressed", "true");
  await c.close();
});
test("expiry removes a hidden real module from a page that stays open", async ({
  page,
  browser,
}) => {
  await signedIn(page);
  const fixture = await (
    await page.request.post("/__fixture__/catalog", { data: {} })
  ).json();
  await policyCommand(page, {
    kind: "catalog_visibility",
    module: "docs",
    visibility: "hidden",
  });
  await policyCommand(page, {
    kind: "entitlement",
    module: "docs",
    subject_id: fixture.member_id,
    action: "read",
    effect: "allow",
    expires_at: new Date(Date.now() + 6000).toISOString(),
  });
  const c = await browser.newContext({ baseURL: "http://127.0.0.1:4323" }),
    u = await c.newPage();
  await signedIn(u, "browser-member@example.test");
  await u.goto("/#/modules");
  await expect(u.getByRole("link", { name: /Qubite Docs/ })).toBeVisible();
  await expect(u.getByRole("link", { name: /Qubite Docs/ })).toHaveCount(0, {
    timeout: 10000,
  });
  await c.close();
});
test("real owner catalog and locked cards reflow, retain chosen material and pass axe in both themes", async ({
  page,
}) => {
  await signedIn(page);
  for (const width of [360, 640, 844, 1440]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
    for (const route of ["/modules", "/settings/owner"]) {
      await page.goto("/#" + route);
      await expect(
        page.locator(
          route === "/modules" ? ".module-grid" : ".visibility-card",
        ),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBeTruthy();
    }
  }
  for (const dark of [false, true]) {
    await page.goto("/#/settings");
    const sw = page.getByRole("switch", { name: "Тёмная тема" });
    if ((await sw.isChecked()) !== dark) await sw.click();
    await page.goto("/#/settings/owner");
    await expect(
      page.getByRole("heading", { name: "Видимость модулей" }),
    ).toBeVisible();
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== "running"),
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await expect(page.locator(".living-tabs").first()).toBeVisible();
  }
});

test("owner draft survives reload and route exit without applying settings or retaining passwords", async ({
  page,
}) => {
  await signedIn(page);
  await page.goto("/#/settings/owner");
  const group = page.getByRole("group", { name: "Документы: без доступа" });
  await group.getByRole("button", { name: "Скрывать" }).click();
  await page.getByLabel("Твой пароль для подтверждения").fill(password);
  await page.reload();
  await expect(group.getByRole("button", { name: "Скрывать" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByText("Восстановлен незавершённый черновик.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Твой пароль для подтверждения")).toHaveValue(
    "",
  );
  expect(
    JSON.stringify(await page.evaluate(() => ({ ...localStorage }))),
  ).not.toContain(password);
  expect(
    (await (await page.request.get("/api/v1/owner/modules")).json()).items.find(
      (m: { module: string }) => m.module === "docs",
    ).visibility,
  ).toBe("locked");
  await page.goto("/#/profile");
  await page.goto("/#/settings/owner");
  await expect(group.getByRole("button", { name: "Скрывать" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByLabel("Твой пароль для подтверждения").fill(password);
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(
    page.getByText("Изменения сохранены на сервере.", { exact: true }),
  ).toBeVisible();
});

test("owner edits exact money and advanced caps; incomplete raw input survives reload", async ({
  page,
}) => {
  await signedIn(page);
  await page.goto("/#/settings/owner");
  await page.getByRole("button", { name: "Бюджеты AI", exact: true }).click();
  const daily = page.getByLabel("День: предел в USD", { exact: true });
  await daily.fill("12,");
  await page.reload();
  await expect(daily).toHaveValue("12,");
  await daily.fill("12,345678");
  await page
    .getByText("Все лимиты: деньги, запросы и токены", { exact: true })
    .click();
  await page.getByLabel("Месяц: запросы", { exact: true }).fill("20");
  await page.getByLabel("За всё время: USD", { exact: true }).fill("50");
  await page.getByLabel("Твой пароль для подтверждения").fill(password);
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(
    page.getByText("Изменения сохранены на сервере.", { exact: true }),
  ).toBeVisible();
  const csrf = (await (await page.request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  const b = await (
    await page.request.post("/api/v1/owner/console/budget", {
      data: { scope: "global", key: "*" },
      headers: { Origin: "http://127.0.0.1:4323", "X-CSRF-Token": csrf },
    })
  ).json();
  expect(
    b.data.items.find((x: { period: string }) => x.period === "day").usd_micro,
  ).toBe(12345678);
  expect(
    b.data.items.find((x: { period: string }) => x.period === "month").requests,
  ).toBe(20);
  expect(
    b.data.items.find((x: { period: string }) => x.period === "all").usd_micro,
  ).toBe(50000000);
});

test("owner grants read and AI independently; user gets no implicit write or paid request", async ({
  page,
}) => {
  const fixture = await (
    await page.request.post("/__fixture__/catalog", {
      data: { module: "docs" },
    })
  ).json();
  await signedIn(page);
  await page.goto("/#/settings/owner");
  await page.getByRole("button", { name: "Люди", exact: true }).click();
  await page
    .getByRole("button", { name: /browser-member@example.test/ })
    .click();
  await page
    .getByRole("switch", { name: "Документы: Чтение", exact: true })
    .click();
  await page
    .getByRole("switch", { name: "Документы: AI", exact: true })
    .click();
  await page.getByLabel("Твой пароль для подтверждения").fill(password);
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(
    page.getByText("Изменения сохранены на сервере.", { exact: true }),
  ).toBeVisible();
  const detail = (
    await (
      await page.request.get("/api/v1/owner/console/users/" + fixture.member_id)
    ).json()
  ).data;
  expect(
    detail.grants
      .filter((g: { effect: string }) => g.effect === "allow")
      .map((g: { action: string }) => g.action)
      .sort(),
  ).toEqual(["ai", "read"]);
  expect(detail.models).toEqual([]);
});

test("owner registration draft survives navigation; issued invite is shown once and never persisted", async ({
  page,
}) => {
  await signedIn(page);
  await page.goto("/#/settings/owner");
  await page.getByRole("button", { name: "Регистрация", exact: true }).click();
  await page
    .getByRole("group", { name: "Режим регистрации" })
    .getByRole("button", { name: "По приглашению", exact: true })
    .click();
  await page
    .getByLabel("Email приглашённого, необязательно")
    .fill("invite-only@example.test");
  await page.reload();
  await expect(
    page.getByLabel("Email приглашённого, необязательно"),
  ).toHaveValue("invite-only@example.test");
  await expect(
    page
      .getByRole("group", { name: "Режим регистрации" })
      .getByRole("button", { name: "По приглашению", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Твой пароль для подтверждения").fill(password);
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(
    page.getByText("Изменения сохранены на сервере.", { exact: true }),
  ).toBeVisible();
  // Applying configuration preserves other unfinished fields. Invitation issuance is separate.
  await page.getByRole("button", { name: "Регистрация", exact: true }).click();
  await page
    .getByLabel("Email приглашённого, необязательно")
    .fill("invite-only@example.test");
  await page
    .getByRole("button", { name: "Создать приглашение", exact: true })
    .click();
  const token = await page
    .getByLabel("Приглашение для ручного ввода", { exact: true })
    .inputValue();
  expect(token).toMatch(/^qbt_ri_/);
  const url = await page
    .getByLabel("Ссылка приглашения", { exact: true })
    .inputValue();
  expect(url).toContain(token);
  expect(
    JSON.stringify(
      await page.evaluate(() => ({ ...localStorage, ...sessionStorage })),
    ),
  ).not.toContain(token);
  await page.reload();
  await expect(
    page.getByLabel("Приглашение для ручного ввода", { exact: true }),
  ).toHaveCount(0);
});

test("lost owner response is reconciled after reload without sending the batch twice", async ({
  page,
}) => {
  await signedIn(page);
  await page.goto("/#/settings/owner");
  await page
    .getByRole("group", { name: "Документы: без доступа" })
    .getByRole("button", { name: "Скрывать" })
    .click();
  let calls = 0;
  await page.route("**/api/v1/owner/console/commands", async (route) => {
    calls++;
    await route.fetch();
    await route.abort();
  });
  await page.getByLabel("Твой пароль для подтверждения").fill(password);
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Проверить сохранение", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Проверить сохранение", exact: true })
    .click();
  await expect(
    page.getByText("Изменения сохранены на сервере.", { exact: true }),
  ).toBeVisible();
  expect(calls).toBe(1);
});

test("storage failure is visible and blocks submit; it never claims to have saved a draft", async ({
  page,
}) => {
  await signedIn(page);
  await page.goto("/#/settings/owner");
  await expect(
    page.getByRole("heading", { name: "Видимость модулей" }),
  ).toBeVisible();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k.startsWith("qubite.owner.draft"))
        throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, k, v);
    };
  });
  await page
    .getByRole("group", { name: "Документы: без доступа" })
    .getByRole("button", { name: "Скрывать" })
    .click();
  await expect(
    page.getByText("Браузер не сохранил черновик.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сохранить изменения", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Скачать черновик", exact: true }),
  ).toBeVisible();
});

test("owner drafts do not render after a real account switch", async ({
  page,
}) => {
  await page.request.post("/__fixture__/catalog", { data: { module: "docs" } });
  await signedIn(page);
  await page.goto("/#/settings/owner");
  await page
    .getByRole("group", { name: "Документы: без доступа" })
    .getByRole("button", { name: "Скрывать" })
    .click();
  await page.goto("/#/profile");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "С возвращением." }),
  ).toBeVisible();
  await signedIn(page, "browser-member@example.test");
  await page.goto("/#/settings/owner");
  await expect(
    page.getByRole("heading", { name: "Здесь пока нет доступа" }),
  ).toBeVisible();
  await expect(page.getByText("Твои изменения", { exact: true })).toHaveCount(
    0,
  );
  expect((await page.request.get("/api/v1/owner/console")).status()).toBe(403);
});

test("all Console sections reflow in portrait and landscape, use Flux, and pass axe in both themes", async ({
  page,
}) => {
  test.setTimeout(60000);
  await signedIn(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [360, 844, 1440]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });
    await page.goto("/#/settings/owner");
    for (const name of [
      "Люди",
      "Бюджеты AI",
      "Модули",
      "Регистрация",
      "Журнал",
    ]) {
      await page
        .getByRole("group", { name: "Разделы Owner Console" })
        .getByRole("button", { name, exact: true })
        .click();
      await expect(page.locator(".owner-console")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBeTruthy();
    }
  }
  for (const dark of [false, true]) {
    await page.goto("/#/settings");
    const sw = page.getByRole("switch", { name: "Тёмная тема" });
    if ((await sw.isChecked()) !== dark) await sw.click();
    await page.goto("/#/settings/owner");
    for (const name of [
      "Люди",
      "Бюджеты AI",
      "Модули",
      "Регистрация",
      "Журнал",
    ]) {
      await page
        .getByRole("group", { name: "Разделы Owner Console" })
        .getByRole("button", { name, exact: true })
        .click();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  }
  await page.goto("/#/settings");
  const sw = page.getByRole("switch", { name: "Тёмная тема" });
  if (await sw.isChecked()) await sw.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/settings/owner");
  await page.getByRole("button", { name: "Бюджеты AI", exact: true }).click();
  await expect(page.locator(".owner-money")).toHaveCount(2);
  await page.screenshot({
    path: "/tmp/qubite-owner-phone.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "/tmp/qubite-owner-desktop.png",
    fullPage: true,
  });
});
