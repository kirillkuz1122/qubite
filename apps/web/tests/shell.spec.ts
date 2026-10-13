import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function persona(page: Page, name: string) {
  await page.getByRole("button", { name: "Демо", exact: false }).click();
  await page.getByRole("button", { name, exact: false }).click();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
});
test("owner ordinary home, settings-only management entry and unavailable module", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Управление Qubite" }),
  ).toHaveCount(0);
  await page.goto("/#/settings");
  await page.getByRole("link", { name: "Управление Qubite" }).click();
  await expect(
    page.getByRole("heading", { name: "Видимость модулей" }),
  ).toBeVisible();
  await page.goto("/#/modules/docs");
  await expect(
    page.getByRole("heading", {
      name: "Документы — скоро в твоём пространстве",
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Документы — скоро в твоём пространстве",
    }),
  ).toBeVisible();
});
test("new account cannot open inbox or owner by direct URL", async ({
  page,
}) => {
  await persona(page, "Новый пользователь");
  await expect(
    page.getByRole("heading", { name: "Пока только твой аккаунт" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Скинь мысль" }),
  ).toBeDisabled();
  await page.goto("/#/inbox");
  await expect(
    page.getByRole("heading", { name: "Здесь пока нет доступа" }),
  ).toBeVisible();
  await page.goto("/#/settings/owner");
  await expect(
    page.getByRole("heading", { name: "Здесь пока нет доступа" }),
  ).toBeVisible();
  await page.goto("/#/settings");
  await expect(
    page.getByRole("link", { name: "Управление Qubite" }),
  ).toHaveCount(0);
});
test("owner hidden/locked preview changes catalog without granting access", async ({
  page,
}) => {
  await page.goto("/#/settings/owner");
  await page.getByLabel(/^Поиск/).selectOption("hidden");
  await page.getByLabel(/^Соединение/).selectOption("locked");
  await page
    .getByRole("button", { name: "Посмотреть новым пользователем" })
    .click();
  await expect(page.getByRole("link", { name: /Qubite Search/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole("link", { name: /Qubite VPN/ })).toBeVisible();
  await page.goto("/#/modules/search");
  await expect(
    page
      .getByRole("heading", { name: "Страница не найдена", exact: true })
      .first(),
  ).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Qubite Search");
  await page.goto("/#/modules/vpn");
  await expect(
    page.getByRole("heading", { name: "Здесь пока нет доступа" }),
  ).toBeVisible();
});
test("capture is text-only, escaped, ephemeral and never sends API requests", async ({
  page,
}) => {
  const outbound: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" || r.url().includes("/api/"))
      outbound.push(r.url());
  });
  const text = "<script>window.bad = true</script> Моя мысль";
  await page.getByRole("textbox", { name: "Скинь мысль" }).fill(text);
  await page
    .getByRole("button", { name: "Добавить мысль", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Данные исчезнут");
  await page.goto("/#/inbox");
  await expect(page.locator(".note p")).toHaveText(text);
  expect(
    await page.evaluate(() => (window as unknown as { bad?: boolean }).bad),
  ).toBeUndefined();
  await persona(page, "Пользователь Документы");
  await expect(page.locator(".note")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".note")).toHaveCount(0);
  expect(outbound).toEqual([]);
});
test("voice dialog never requests microphone and restores focus", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => {
      throw new Error("Microphone must not be used");
    };
  });
  await page.getByRole("button", { name: "Голосовой ввод" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Микрофон не включается",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Голосовой ввод" }),
  ).toBeFocused();
});
test("keyboard navigation and modal focus stay within the active surface", async ({
  page,
}) => {
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "К содержимому" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeFocused();
  await page.getByRole("link", { name: "Модули", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Модули", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Демо", exact: false }).click();
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest("dialog")),
    ).toBe(true);
  }
});
test("appearance persists only cosmetic preferences; reduced motion is respected", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await page.getByRole("switch", { name: "Тёмная тема" }).check();
  await page.getByRole("switch", { name: "Спокойное движение" }).check();
  await page.reload();
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-quiet",
    "true",
  );
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([
    "qubite.ui.v1",
  ]);
  await page.getByRole("switch", { name: "Спокойное движение" }).uncheck();
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".page-content")
      .evaluate((e) => parseFloat(getComputedStyle(e).animationDuration)),
  ).toBeLessThan(0.01);
});
test("layouts have no horizontal overflow and command never covers bottom navigation", async ({
  page,
}) => {
  for (const [width, height] of [
    [360, 740],
    [768, 1024],
    [1280, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    for (const route of ["/", "/modules", "/profile", "/settings/owner"]) {
      await page.goto("/#" + route);
      await expect(page.locator("h1")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const dock = await page.locator(".command-dock").boundingBox();
      expect(dock!.x).toBeGreaterThanOrEqual(0);
      expect(dock!.x + dock!.width).toBeLessThanOrEqual(width);
      if (width <= 850) {
        const nav = await page.locator(".sidebar").boundingBox();
        expect(dock!.y + dock!.height).toBeLessThanOrEqual(nav!.y);
      }
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      const footer = await page.locator(".page-footer").boundingBox();
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(dock!.y + 1);
    }
  }
});
test("large text layout keeps profile and settings readable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await page.goto("/#/profile");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Доступ по делу" }),
  ).toBeVisible();
});
test("keyboard viewport signal lifts Command and leaves touch navigation clear", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("textbox", { name: "Скинь мысль" }).focus();
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport, {
      height: { value: 544, configurable: true },
      offsetTop: { value: 0, configurable: true },
      scale: { value: 1, configurable: true },
    });
    window.visualViewport?.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-keyboard",
    "true",
  );
  await expect(page.locator(".sidebar")).toBeHidden();
  const dock = await page.locator(".command-dock").boundingBox();
  expect(dock!.y + dock!.height).toBeLessThanOrEqual(544);
  await expect(
    page.getByRole("textbox", { name: "Скинь мысль" }),
  ).toBeFocused();
});
test("light and dark surfaces pass WCAG checks including owner controls and dialog", async ({
  page,
}) => {
  for (const dark of [false, true]) {
    await page.goto("/#/settings");
    await page.getByRole("switch", { name: "Тёмная тема" }).setChecked(dark);
    for (const route of ["/", "/modules", "/settings/owner", "/profile"]) {
      await page.goto("/#" + route);
      await expect(page.locator("h1")).toBeVisible();
      await page.locator(".page-content").evaluate(async (e) => {
        await Promise.all(e.getAnimations().map((a) => a.finished));
      });
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            detail: n.failureSummary,
          })),
        })),
      ).toEqual([]);
    }
    await page.getByRole("button", { name: "Демо", exact: false }).click();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.keyboard.press("Escape");
  }
});
