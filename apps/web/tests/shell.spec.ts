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
  await page
    .getByRole("group", { name: "Поиск: без доступа" })
    .getByRole("button", { name: "Скрывать" })
    .click();
  await page
    .getByRole("group", { name: "Соединение: без доступа" })
    .getByRole("button", { name: "С замком" })
    .click();
  await page
    .getByRole("group", { name: "Документы: без доступа" })
    .getByRole("button", { name: "Скрывать" })
    .click();
  await page
    .getByRole("button", { name: "Сохранить: Поиск", exact: true })
    .click();
  await expect(
    page
      .getByRole("group", { name: "Документы: без доступа" })
      .getByRole("button", { name: "Скрывать" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Сохранить: Документы", exact: true })
    .click();
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
        await Promise.all(
          e.getAnimations({ subtree: true }).map((a) => a.finished),
        );
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

test("Flux navigation flows for 503ms instead of teleporting, and retargets mid-flight", async ({
  page,
}) => {
  const pill = page.locator(".nav-material-pill");
  const values = () =>
    pill.evaluate((e) => ({
      x: parseFloat((e as HTMLElement).style.getPropertyValue("--navX")),
      y: parseFloat((e as HTMLElement).style.getPropertyValue("--navY")),
    }));
  const start = await values();
  await page.getByRole("link", { name: "Профиль", exact: true }).click();
  await expect(pill).toHaveAttribute("data-moving", "true");
  await page.waitForTimeout(140);
  const midway = await values();
  const target = await page
    .locator('.main-navigation a[aria-current="page"]')
    .evaluate((e) => ({
      x: (e as HTMLElement).offsetLeft,
      y: (e as HTMLElement).offsetTop,
    }));
  expect(Math.hypot(midway.x - start.x, midway.y - start.y)).toBeGreaterThan(1);
  expect(Math.hypot(midway.x - target.x, midway.y - target.y)).toBeGreaterThan(
    1,
  );
  await page.getByRole("link", { name: "Главная", exact: true }).click();
  await expect(pill).not.toHaveAttribute("data-moving", "true");
  const end = await values();
  expect(Math.abs(end.x - start.x) + Math.abs(end.y - start.y)).toBeLessThan(
    0.05,
  );
});
test("Flux settings retain native exact values and the slider/switch react to drag and keyboard", async ({
  page,
}) => {
  await page.goto("/#/settings");
  const slider = page.getByRole("slider", { name: "Перетекание выбора" });
  await expect(slider).toHaveValue("503");
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveValue("504");
  const sw = page.getByRole("switch", { name: "Тёмная тема" });
  const b = (await sw.boundingBox())!;
  await page.mouse.move(b.x + 18, b.y + 22);
  await page.mouse.down();
  await page.mouse.move(b.x + 61, b.y + 22, { steps: 8 });
  await page.mouse.up();
  await expect(sw).toBeChecked();
  await page.reload();
  await expect(slider).toHaveValue("504");
  await expect(sw).toBeChecked();
  await sw.focus();
  await page.keyboard.press("Space");
  await expect(sw).not.toBeChecked();
});
test("bounded material drag cannot activate a button; cancellation restores the surface", async ({
  page,
}) => {
  const button = page.getByRole("button", { name: "Демо", exact: false });
  const b = (await button.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 220, b.y + b.height / 2, {
    steps: 10,
  });
  await page.waitForTimeout(150);
  const displacement = await button.evaluate((e) =>
    parseFloat((e as HTMLElement).style.getPropertyValue("--dragX")),
  );
  expect(displacement).toBeGreaterThan(0);
  expect(displacement).toBeLessThanOrEqual(28.1);
  await page.mouse.up();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(button).not.toHaveAttribute("data-moving", "true");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
});
test("quiet/reduced motion snaps semantic selection and stationary controls schedule no frames", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await page.getByRole("link", { name: "Профиль", exact: true }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-quiet",
    "true",
  );
  expect(
    await page
      .locator(".content")
      .evaluate(
        (e) =>
          e
            .getAnimations({ subtree: true })
            .filter((a) => a.playState === "running").length,
      ),
  ).toBe(0);
  await expect(page.locator("[data-moving]")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(1200);
  const count = await page.evaluate(async () => {
    let count = 0;
    const original = requestAnimationFrame;
    window.requestAnimationFrame = (callback) => {
      count++;
      return original(callback);
    };
    await new Promise((resolve) => setTimeout(resolve, 180));
    window.requestAnimationFrame = original;
    return count;
  });
  expect(count).toBe(0);
});
test("cancelled switch drag never commits a preference", async ({ page }) => {
  await page.goto("/#/settings");
  const sw = page.getByRole("switch", { name: "Тёмная тема" });
  const bounds = (await sw.boundingBox())!;
  await page.mouse.move(bounds.x + 15, bounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 65, bounds.y + 20, { steps: 8 });
  await sw.dispatchEvent("pointercancel", {
    pointerId: 1,
    pointerType: "mouse",
  });
  await page.mouse.up();
  await expect(sw).not.toBeChecked();
  await expect(sw).not.toHaveAttribute("data-moving", "true");
});
test("selected material can be dragged between options; cancelled drag preserves the choice", async ({
  page,
}) => {
  await page.goto("/#/settings/owner");
  const group = page.getByRole("group", { name: "Поиск: без доступа" });
  const hidden = group.getByRole("button", { name: "Скрывать" });
  const locked = group.getByRole("button", { name: "С замком" });
  await group.scrollIntoViewIfNeeded();
  const a = (await hidden.boundingBox())!,
    b = (await locked.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 9 });
  await page.mouse.up();
  await expect(hidden).toHaveAttribute("aria-pressed", "true");
  await expect(group.locator(".living-pill")).not.toHaveAttribute(
    "data-moving",
    "true",
  );
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 9 });
  await hidden.dispatchEvent("pointercancel", {
    pointerId: 1,
    pointerType: "mouse",
  });
  await page.mouse.up();
  await expect(hidden).toHaveAttribute("aria-pressed", "true");
  await expect(group.locator(".living-pill")).not.toHaveAttribute(
    "data-moving",
    "true",
  );
  await hidden.focus();
  await page.keyboard.press("ArrowRight");
  await expect(locked).toHaveAttribute("aria-pressed", "true");
});

test("demo Auth previews never submit credentials or pretend to create an account", async ({
  page,
}) => {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") posts.push(r.url());
  });
  await page.goto("/#/welcome");
  await page.getByRole("link", { name: "Войти в Qubite" }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill("fictional@example.test");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("Synthetic preview password 42!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Аккаунт не создан");
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("");
  expect(posts).toEqual([]);
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    ),
  ).not.toContain("Synthetic preview password");
});
