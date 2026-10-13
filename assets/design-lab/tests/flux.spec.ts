import { test, expect, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const screens = [
  "components",
  "appearance",
  "marks",
  "pets",
  "workspace",
  "auth",
];
const sizes = [
  { width: 320, height: 740 },
  { width: 360, height: 780 },
  { width: 768, height: 1024 },
  { width: 1440, height: 1000 },
  { width: 844, height: 390 },
];
async function number(el: Locator, key: string) {
  return el.evaluate(
    (el, key) => Number((el as HTMLElement).style.getPropertyValue(`--${key}`)),
    key,
  );
}
for (const size of sizes)
  test(`Flux ${size.width}: все разделы без переполнения и внешних запросов`, async ({
    page,
  }, info) => {
    await page.setViewportSize(size);
    const errors: string[] = [],
      outside: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (!r.url().startsWith("http://127.0.0.1:4317/")) outside.push(r.url());
    });
    for (const screen of screens) {
      await page.goto(`/#/flux/${screen}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      if (screen === "marks") {
        await page.locator(".mark-matrix summary").click();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
      }
      if (size.width === 360 || size.width === 1440)
        await page.screenshot({
          path: info.outputPath(`flux-${screen}-${size.width}.png`),
          fullPage: true,
          animations: "disabled",
        });
    }
    expect(errors).toEqual([]);
    expect(outside).toEqual([]);
  });
for (const palette of ["Прилив", "Команда", "Берег", "Терракота", "Графит"])
  for (const night of [false, true])
    test(`Flux WCAG ${palette}/${night ? "dark" : "light"}: шесть разделов`, async ({
      page,
    }) => {
      await page.goto("/#/flux/appearance");
      await page.locator(".legacy-palettes summary").click();
      if (night)
        await page.getByRole("button", { name: "Тёмный режим" }).click();
      await page
        .locator(".palette-choice")
        .filter({ hasText: palette })
        .click();
      for (const screen of screens) {
        await page
          .locator(`.flux-page-nav button[data-id="${screen}"]`)
          .click();
        await expect(
          page.locator(".flux-stage .morph-ghost").first(),
        ).toBeEmpty();
        const result = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(result.violations, JSON.stringify(result.violations)).toEqual(
          [],
        );
      }
    });
test("Flux: click travelling pill has intermediate geometry and configured duration", async ({
  page,
}) => {
  await page.goto("/#/flux/components");
  const group = page.getByRole("group", { name: "Период", exact: true }),
    pill = group.locator(".living-pill");
  await group.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const from = await number(pill, "pillX");
  const target = await group
    .getByRole("button", { name: "Месяц" })
    .evaluate((el) => (el as HTMLElement).offsetLeft);
  await group.getByRole("button", { name: "Месяц" }).click();
  await page.waitForTimeout(160);
  const middle = await number(pill, "pillX");
  expect(middle).toBeGreaterThan(from + 1);
  expect(middle).toBeLessThan(target - 1);
  await expect(group.getByRole("button", { name: "Месяц" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => number(pill, "pillX")).toBeCloseTo(target, 1);
  await page.locator('.flux-page-nav button[data-id="appearance"]').click();
  const duration = page.getByRole("slider", { name: "Перетекание выбора" });
  await duration.press("End");
  await expect(duration).toHaveValue("900");
  await page.locator('.flux-page-nav button[data-id="components"]').click();
  const nextGroup = page.getByRole("group", { name: "Период", exact: true });
  await nextGroup.scrollIntoViewIfNeeded();
  const nextPill = nextGroup.locator(".living-pill"),
    nextTarget = await nextGroup
      .getByRole("button", { name: "Месяц" })
      .evaluate((el) => (el as HTMLElement).offsetLeft);
  await nextGroup.getByRole("button", { name: "Месяц" }).click();
  await page.waitForTimeout(600);
  expect(await number(nextPill, "pillX")).toBeLessThan(nextTarget - 1);
  await expect.poll(() => number(nextPill, "pillX")).toBeCloseTo(nextTarget, 1);
});
test("Flux mobile: navigation pill travels vertically and lands in correct cell", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/#/flux/components");
  const group = page.getByRole("group", { name: "Раздел витрины" }),
    pill = group.locator(".living-pill");
  const before = await number(pill, "pillY");
  const target = await group
    .getByRole("button", { name: "Вход", exact: true })
    .evaluate((el) => (el as HTMLElement).offsetTop);
  await group.getByRole("button", { name: "Вход", exact: true }).click();
  await page.waitForTimeout(160);
  expect(await number(pill, "pillY")).toBeGreaterThan(before);
  expect(await number(pill, "pillY")).toBeLessThan(target);
  await expect.poll(() => number(pill, "pillY")).toBeCloseTo(target, 1);
});
test("Flux: independent fonts, palettes and logo families apply across screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/#/flux/appearance");
  const headings = page.locator(".font-choice-heading"),
    texts = page.locator(".font-choice-body");
  expect(await headings.count()).toBe(5);
  expect(await texts.count()).toBe(5);
  for (const h of ["Onest", "Golos Text", "Rubik", "Manrope", "Unbounded"]) {
    await headings.filter({ hasText: h }).click();
    for (const b of ["Onest", "Golos Text", "Rubik", "Manrope", "Lora"]) {
      await texts.filter({ hasText: b }).click();
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    }
  }
  await page.locator(".legacy-palettes summary").click();
  await page.locator(".palette-choice").filter({ hasText: "Берег" }).click();
  await page.locator('.flux-page-nav button[data-id="marks"]').click();
  await expect(page.locator(".flux-studio")).toHaveAttribute(
    "data-palette",
    "coast",
  );
  await expect(page.locator(".flux-studio")).toHaveAttribute(
    "data-heading",
    "unbounded",
  );
  await expect(page.locator(".flux-studio")).toHaveAttribute(
    "data-body",
    "lora",
  );
  expect(await page.locator(".service-mark-card").count()).toBe(12);
  for (const family of ["ribbon", "orbit", "seed", "nodes", "portal"]) {
    await page
      .locator(".logo-choice")
      .filter({ has: page.locator(`.mark-${family}`) })
      .click();
    await expect(page.locator(".flux-brand .brand-mark")).toHaveClass(
      new RegExp(`mark-${family}`),
    );
    expect(
      await page.locator(`.service-mark-card>.mark-${family}`).count(),
    ).toBe(12);
  }
  await page.locator(".mark-matrix summary").click();
  expect(await page.locator(".matrix-row").count()).toBe(12);
  expect(await page.locator(".matrix-row .brand-mark").count()).toBe(60);
  await page.getByRole("button", { name: "Монохром", exact: true }).click();
  await expect(page.locator(".marks-section")).toHaveClass(/marks-mono/);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});
test("Flux touch: lightweight rendering, eyes follow touch and bounded drag remains safe under CPU slowdown", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 780 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4317/#/flux/pets");
  await expect(page.locator(".flux-studio")).toHaveAttribute(
    "data-lite",
    "true",
  );
  const card = page.locator(".crew-card").first();
  await card.tap();
  await expect(page.locator(".crew-card .companion").first()).toHaveAttribute(
    "data-looking",
    "touch",
  );
  await page.goto("http://127.0.0.1:4317/#/flux/components");
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const button = page.getByRole("button", { name: "Потяни материал" });
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
  });
  for (let i = 1; i <= 10; i++)
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: box.x + box.width / 2 + 15 * i, y: box.y + box.height / 2 },
      ],
    });
  await page.waitForTimeout(180);
  const displacement = Math.abs(await number(button, "dragX"));
  expect(displacement).toBeGreaterThan(2);
  // At the owner-selected 100%, the Flux envelope is 28px (was 16.8px at 60%).
  expect(displacement).toBeLessThan(29);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() => number(button, "dragX"), { timeout: 5000 })
    .toBeCloseTo(0, 1);
  await expect(button).not.toContainText("Нажатий:");
  await expect(button).not.toHaveAttribute("data-moving");
  await context.close();
});
test("Flux companions: cursor gaze, eight states and three speech modes without overlap", async ({
  page,
}) => {
  await page.goto("/#/flux/pets");
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".crew-card .companion").first().scrollIntoViewIfNeeded();
  const pet = page.locator(".crew-card .companion").first(),
    box = (await pet.boundingBox())!;
  await expect(pet).toHaveAttribute("data-visible", "true");
  await page.mouse.move(box.x + box.width + 60, box.y + 35);
  await expect.poll(() => number(pet, "gazeX")).toBeGreaterThan(1);
  const events = page.getByRole("group", { name: "Событие для помощника" });
  expect(await events.getByRole("button").count()).toBe(8);
  for (const id of ["listening", "thinking", "rest", "agentError", "success"]) {
    await events.locator(`[data-id="${id}"]`).click();
    await expect(page.locator(".pet-dialogue .companion")).toHaveAttribute(
      "data-reaction",
      id,
    );
  }
  await page.setViewportSize({ width: 320, height: 740 });
  const conversation = page.locator(".conversation-specimen");
  for (const mode of ["quiet", "advice", "dialogue"]) {
    await conversation.locator(`[data-id="${mode}"]`).click();
    const overlap = await conversation.evaluate((el) => {
      const a = el.querySelector(".speech-pet")!.getBoundingClientRect(),
        b = el.querySelector(".speech-bubble")!.getBoundingClientRect();
      return (
        a.left < b.right &&
        a.right > b.left &&
        a.top < b.bottom &&
        a.bottom > b.top
      );
    });
    expect(overlap).toBe(false);
  }
  await conversation
    .getByRole("button", { name: "Скрыть пример подсказки" })
    .click();
  await expect(
    conversation.getByRole("button", { name: "Вернуть помощника" }),
  ).toBeVisible();
});
test("Flux quiet: instant selection, no gaze motion or active schedulers", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/flux/appearance");
  await expect(
    page.getByRole("switch", { name: "Спокойный режим" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.locator('.flux-page-nav button[data-id="pets"]').click();
  await expect(page.locator(".flux-page-nav .living-pill")).not.toHaveAttribute(
    "data-moving",
  );
  const pet = page.locator(".crew-card .companion").first();
  await pet.scrollIntoViewIfNeeded();
  await page.mouse.move(250, 420);
  expect(await number(pet, "gazeX")).toBe(0);
  expect(await page.locator("[data-moving]").count()).toBe(0);
});

test("Flux default and reusable atoms: glyph choices and action states are local", async ({
  page,
  context,
}) => {
  const mutations: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") mutations.push(r.url());
  });
  await page.goto("/");
  await expect(page.locator(".flux-studio")).toHaveAttribute(
    "data-material",
    "flux",
  );
  await expect(page.locator(".flux-studio")).toHaveAttribute(
    "data-palette",
    "toy",
  );
  expect(await page.locator(".glyph-grid button").count()).toBe(22);
  await page.getByRole("button", { name: "Иконка: Соединение" }).click();
  await expect(
    page.getByRole("button", { name: "Иконка: Соединение" }),
  ).toHaveAttribute("aria-pressed", "true");
  const action = page.getByRole("button", { name: "Попробуй действие" });
  await action.click();
  await expect(
    page.getByRole("button", { name: "Собирается…" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Сохранено", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("textbox", { name: "Название мысли" })
    .fill("Синтетическая мысль");
  expect(mutations).toEqual([]);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  expect(await context.cookies()).toEqual([]);
});
