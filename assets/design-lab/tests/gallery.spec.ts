import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const concepts = ["nacre", "ferro", "folio", "prism", "milo"];
const sizes = [
  { name: "phone", width: 360, height: 780 },
  { name: "narrow", width: 320, height: 740 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 1000 },
  { name: "landscape", width: 844, height: 390 },
];
for (const concept of concepts) {
  for (const size of sizes) {
    test(`${concept} / ${size.name}: четыре экрана без overflow и ошибок`, async ({
      page,
    }, info) => {
      await page.setViewportSize(size);
      const errors: string[] = [];
      const external: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        if (!r.url().startsWith("http://127.0.0.1:4317/"))
          external.push(r.url());
      });
      for (const view of ["landing", "workspace", "auth", "material"]) {
        await page.goto(`/#/${concept}/${view}`);
        await expect(page.locator(".concept")).toBeVisible();
        await expect(page.locator(".concept h1")).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        if (size.name === "phone" || size.name === "desktop")
          await page.screenshot({
            path: info.outputPath(`${concept}-${view}-${size.name}.png`),
            fullPage: true,
            animations: "disabled",
          });
      }
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
    });
  }
  test(`${concept}: capture/undo, разделы, модули и Owner Console`, async ({
    page,
  }) => {
    await page.goto(`/#/${concept}/workspace`);
    await page.getByLabel("Быстрая заметка").fill("Идея из тестовой сессии");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.locator(".captured-notes")).toContainText(
      "Идея из тестовой сессии",
    );
    await expect(page.locator(".material")).toHaveAttribute(
      "data-mood",
      "success",
    );
    await page.getByRole("button", { name: "Отменить", exact: true }).click();
    await expect(page.getByLabel("Быстрая заметка")).toHaveValue(
      "Идея из тестовой сессии",
    );
    await expect(page.locator(".captured-notes")).toHaveCount(0);
    await page.getByRole("checkbox", { name: /Дописать заметку/ }).check();
    await expect(page.locator(".task-counter")).toHaveText("2 / 3");
    await page.keyboard.press("Control+k");
    await expect(page.getByLabel("Поисковый запрос")).toBeVisible();
    await page.getByLabel("Поисковый запрос").fill("внимание");
    await page.getByRole("button", { name: "Найти", exact: true }).click();
    await expect(page.locator(".search-result")).toHaveCount(3);
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "VPN", exact: true })
      .click();
    await page.getByRole("button", { name: "Подключить в макете" }).click();
    await expect(page.locator(".vpn-card")).toHaveClass(/connected/);
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Writer", exact: true })
      .click();
    await page.getByRole("button", { name: "Помочь с AI" }).click();
    await expect(page.getByRole("status")).toContainText("AI не запущен");
    await page.getByRole("button", { name: "Проверить текст" }).click();
    await page.getByRole("button", { name: "Применить пример" }).click();
    await expect(page.getByLabel("Текст Writer")).toHaveValue(/В общем/);
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Модули", exact: true })
      .click();
    await page.getByRole("button", { name: /Qubite Tournaments/ }).click();
    await expect(page.getByRole("status")).toContainText(
      "Доступ не выдан".toLowerCase(),
    );
    await expect(page.locator(".sidebar")).not.toContainText("Owner Console");
    await page
      .getByRole("button", { name: "Открыть настройки профиля" })
      .click();
    await page.getByRole("button", { name: /Управление Qubite/ }).click();
    await expect(page.getByRole("heading", { name: /Ясность/ })).toBeVisible();
    await page.getByRole("button", { name: "Выдать пример гранта" }).click();
    await expect(page.locator(".grant-state")).toContainText(
      "бюджет всё ещё $0.00",
    );
    await page
      .getByRole("button", { name: "К настройкам", exact: false })
      .click();
    await page.getByLabel("Роль в макете").selectOption("member");
    await expect(
      page.getByRole("button", { name: /Управление Qubite/ }),
    ).toHaveCount(0);
  });
  test(`${concept}: формы, приватность пароля, ошибки и отсутствие сохранённых данных`, async ({
    page,
    context,
  }) => {
    const requests: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET") requests.push(r.url());
    });
    await page.goto(`/#/${concept}/auth`);
    await page
      .locator("form")
      .getByRole("button", { name: "Войти", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("Проверь адрес");
    await page.getByPlaceholder("hello@example.com").fill("demo@example.com");
    await page.getByPlaceholder("Не меньше 8 символов").fill("Example123");
    await page.getByRole("button", { name: "Показать пароль" }).click();
    await expect(page.locator(".material")).toHaveAttribute(
      "data-mood",
      "private",
    );
    await expect(page.locator("input[name=password]")).toHaveAttribute(
      "type",
      "text",
    );
    await page.getByRole("button", { name: "Скрыть пароль" }).click();
    await page.getByRole("button", { name: "Telegram", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Внешний запрос не выполняется",
    );
    await page
      .getByRole("button", { name: "Регистрация", exact: true })
      .click();
    await page.getByPlaceholder("hello@example.com").fill("demo@example.com");
    await page.getByPlaceholder("Не меньше 8 символов").fill("Example123");
    await page.getByRole("button", { name: "Создать пространство" }).click();
    await expect(page.getByRole("alert")).toContainText("Нужно принять");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Создать пространство" }).click();
    await expect(page.getByRole("status")).toContainText("аккаунт не создан");
    expect(
      await page.evaluate(() => ({
        local: localStorage.length,
        session: sessionStorage.length,
      })),
    ).toEqual({ local: 0, session: 0 });
    expect(await context.cookies()).toEqual([]);
    expect(requests).toEqual([]);
    await page.reload();
    await expect(page.getByPlaceholder("hello@example.com")).toHaveValue("");
    await expect(page.getByPlaceholder("Не меньше 8 символов")).toHaveValue("");
  });
  test(`${concept}: доступность и reduced motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/#/${concept}/auth`);
    await expect(page.locator(".concept")).toHaveClass(/quiet/);
    expect(
      await page
        .locator(".material")
        .evaluate((el) =>
          Array.from(el.querySelectorAll("*")).every(
            (x) => getComputedStyle(x).animationName === "none",
          ),
        ),
    ).toBe(true);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    ).toEqual([]);
    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".concept")).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`/${concept}/auth`));
  });
}
test("Предпросмотр, темы и реакции всех пяти материалов", async ({ page }) => {
  await page.goto("/#/nacre/material");
  for (const c of concepts) {
    await page.goto(`/#/${c}/material`);
    await page.getByRole("button", { name: "Телефон", exact: true }).click();
    await expect
      .poll(async () =>
        page
          .locator(".concept")
          .evaluate((el) => el.getBoundingClientRect().width),
      )
      .toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: "Ошибка", exact: true }).click();
    await expect(page.locator(".material")).toHaveAttribute(
      "data-mood",
      "error",
    );
    await page
      .getByRole("button", { name: /^(Тёмный|Светлый) режим$/ })
      .click();
    await expect(page.locator(".concept")).toHaveClass(/night/);
    await page.getByRole("button", { name: "Спокойный режим" }).click();
    await expect(page.locator(".concept")).toHaveClass(/quiet/);
    await page.getByRole("button", { name: "Спокойный режим" }).click();
    await page
      .getByRole("button", { name: /^(Тёмный|Светлый) режим$/ })
      .click();
    await page.getByRole("button", { name: "Автоматическая ширина" }).click();
  }
});
test("Смена формы отменяет устаревший ответ", async ({ page }) => {
  await page.goto("/#/milo/auth");
  await page.getByPlaceholder("hello@example.com").fill("demo@example.com");
  await page.getByPlaceholder("Не меньше 8 символов").fill("Example123");
  await page
    .locator("form")
    .getByRole("button", { name: "Войти", exact: true })
    .click();
  await page.getByRole("button", { name: "Регистрация", exact: true }).click();
  await page.waitForTimeout(750);
  await expect(
    page.getByRole("heading", { name: "Начнём с тебя." }),
  ).toBeVisible();
  await expect(page.locator(".auth-complete")).toHaveCount(0);
});

for (const concept of concepts) {
  test(`${concept}: WCAG для всех экранов и обеих тем`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const view of ["landing", "workspace", "auth", "material"]) {
      await page.goto(`/#/${concept}/${view}`);
      for (let theme = 0; theme < 2; theme++) {
        const result = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(
          result.violations.map((v) => ({
            view,
            theme,
            id: v.id,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              summary: n.failureSummary,
            })),
          })),
        ).toEqual([]);
        await page
          .getByRole("button", { name: /^(Тёмный|Светлый) режим$/ })
          .click();
      }
    }
  });
}
