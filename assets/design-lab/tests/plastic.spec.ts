import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const kits = ["Игрушечная", "Аква", "Поп", "Лимон", "Блоки"];
const screens = [
  "components",
  "appearance",
  "marks",
  "pets",
  "workspace",
  "auth",
];
for (const kit of kits)
  for (const night of [false, true])
    test(`Plastic ${kit}/${night ? "dark" : "light"}: mobile hierarchy, contrast and all screens`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 780 });
      await page.goto("/#/flux/appearance");
      if (night)
        await page.getByRole("button", { name: "Тёмный режим" }).click();
      await page
        .getByRole("button", { name: `Цветной пластик: ${kit}`, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: `${kit} в деле.` }),
      ).toBeVisible();
      for (const screen of screens) {
        await page
          .locator(`.flux-page-nav button[data-id="${screen}"]`)
          .click();
        await expect(
          page.locator(".flux-stage .morph-ghost").first(),
        ).toBeEmpty();
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        const result = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(result.violations, `${kit}/${screen}/${night}`).toEqual([]);
      }
    });
test("Plastic: owner choices survive kit/section changes; selected motion settings and old palettes remain usable", async ({
  page,
}) => {
  await page.goto("/#/flux/appearance");
  const root = page.locator(".flux-studio");
  await expect(root).toHaveAttribute("data-heading", "unbounded");
  await expect(root).toHaveAttribute("data-body", "manrope");
  await expect(
    page.getByRole("slider", { name: "Податливость интерфейса" }),
  ).toHaveValue("100");
  await expect(
    page.getByRole("slider", { name: "Перетекание выбора" }),
  ).toHaveValue("503");
  expect(await page.locator(".plastic-palette-choice").count()).toBe(5);
  for (const kit of kits) {
    await page
      .getByRole("button", { name: `Цветной пластик: ${kit}`, exact: true })
      .click();
    await page.locator('.flux-page-nav button[data-id="marks"]').click();
    await expect(page.locator(".flux-brand .brand-mark")).toHaveClass(
      /mark-ribbon/,
    );
    await expect(root).toHaveAttribute("data-heading", "unbounded");
    await expect(root).toHaveAttribute("data-body", "manrope");
    await page.locator('.flux-page-nav button[data-id="appearance"]').click();
  }
  await page.locator(".legacy-palettes summary").click();
  await page.locator(".palette-choice").filter({ hasText: "Берег" }).click();
  await expect(root).not.toHaveAttribute("data-plastic");
  await expect(page.locator(".plastic-playground")).toHaveCount(0);
});
test("Plastic: colors follow roles on actual controls; success/error/disabled are distinguishable and local", async ({
  page,
  context,
}) => {
  const outside: string[] = [],
    mutations: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:4317/")) outside.push(r.url());
    if (r.method() !== "GET") mutations.push(r.url());
  });
  await page.goto("/#/flux/components");
  const fill = async (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  const action = await fill(".save-material"),
    select = await fill(".flux-page-nav .living-pill"),
    slider = await fill(".slider-thumb"),
    toggle = await fill(".living-switch > span");
  expect(action).not.toBe(select);
  expect(slider).toBe(select);
  expect(toggle).not.toBe(action);
  expect(toggle).not.toBe(select);
  await page
    .getByRole("button", { name: "Сохранить мысль", exact: true })
    .click();
  expect(await fill(".save-material")).toBe(toggle);
  await page.locator('.flux-page-nav button[data-id="appearance"]').click();
  const example = page.locator(".plastic-workbench");
  await example
    .getByRole("textbox", { name: "Твоя мысль" })
    .fill("Только локальный черновик");
  await example.getByRole("button", { name: "Положить в заметки" }).click();
  await expect(
    example.getByRole("button", { name: "Мысль сохранена" }),
  ).toBeVisible();
  await example.getByRole("button", { name: "Посмотреть ошибку" }).click();
  await expect(example.getByRole("alert")).toContainText(
    "Черновик остался на месте",
  );
  await expect(
    example.getByRole("textbox", { name: "Твоя мысль" }),
  ).toHaveValue("Только локальный черновик");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(mutations).toEqual([]);
  expect(outside).toEqual([]);
  expect(await context.cookies()).toEqual([]);
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
});
test("Plastic: five distinct distributions remain contained at 320px and landscape", async ({
  page,
}, info) => {
  for (const size of [
    { width: 320, height: 740 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/#/flux/appearance");
    for (const kit of kits) {
      await page
        .getByRole("button", { name: `Цветной пластик: ${kit}`, exact: true })
        .click();
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.locator(".plastic-workbench").screenshot({
        path: info.outputPath(`${kit}-${size.width}.png`),
        animations: "disabled",
      });
    }
  }
});
