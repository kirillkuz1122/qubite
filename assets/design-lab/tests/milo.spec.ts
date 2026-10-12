import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const profiles = ["souffle", "flux", "halo", "orbit", "bloom"];
const screens = ["controls", "workspace", "auth", "landing", "pets"];
const sizes = [
  { name: "narrow", width: 320, height: 740 },
  { name: "phone", width: 360, height: 780 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 1000 },
  { name: "landscape", width: 844, height: 390 },
];
async function variable(locator: Locator, name: string) {
  return locator.evaluate(
    (el, key) => Number((el as HTMLElement).style.getPropertyValue(key)),
    name,
  );
}
async function hold(page: Page, locator: Locator, dx: number, dy = 0) {
  await locator.scrollIntoViewIfNeeded();
  const b = (await locator.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, {
    steps: 12,
  });
}
for (const profile of profiles) {
  for (const size of sizes)
    test(`Milo ${profile}/${size.name}: пять экранов и локальные assets`, async ({
      page,
    }, info) => {
      await page.setViewportSize(size);
      const errors: string[] = [],
        outside: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        if (!r.url().startsWith("http://127.0.0.1:4317/"))
          outside.push(r.url());
      });
      for (const screen of screens) {
        await page.goto(`/#/milo/v2/${profile}/${screen}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(
          page.locator(".milo-stage .morph-ghost").first(),
        ).toBeEmpty();
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        if (
          screen === "controls" &&
          (size.name === "phone" || size.name === "desktop")
        )
          await page.screenshot({
            path: info.outputPath(`${profile}-${size.name}.png`),
            fullPage: true,
            animations: "disabled",
          });
      }
      expect(errors).toEqual([]);
      expect(outside).toEqual([]);
    });
  for (const night of [false, true])
    test(`Milo ${profile}/${night ? "night" : "day"}: WCAG всех экранов и настроек`, async ({
      page,
    }) => {
      await page.goto(`/#/milo/v2/${profile}/controls`);
      if (night)
        await page.getByRole("button", { name: "Тёмный режим" }).click();
      await page.getByRole("button", { name: "Ощущения", exact: true }).click();
      for (const screen of screens) {
        if (screen !== "controls")
          await page
            .getByRole("group", { name: "Экран Milo" })
            .getByRole("button", {
              name: (
                {
                  workspace: "Интерфейс",
                  auth: "Вход",
                  landing: "Лендинг",
                  pets: "Помощники",
                } as Record<string, string>
              )[screen],
              exact: true,
            })
            .click();
        await expect(
          page.locator(".milo-stage .morph-ghost").first(),
        ).toBeEmpty();
        const result = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(result.violations).toEqual([]);
      }
    });
  test(`Milo ${profile}: ограниченное движение и возврат без случайного нажатия`, async ({
    page,
  }) => {
    await page.goto(`/#/milo/v2/${profile}/controls`);
    const target = page.getByRole("button", { name: "Потяни материал" });
    await hold(page, target, 120, 35);
    await expect.poll(() => variable(target, "--dragX")).toBeGreaterThan(4);
    expect(Math.abs(await variable(target, "--dragX"))).toBeLessThan(29);
    await page.mouse.up();
    await page.mouse.move(0, 0);
    await expect
      .poll(async () => Math.abs(await variable(target, "--dragX")))
      .toBeLessThan(0.05);
    await expect(target).not.toContainText("Нажатий:");
    await target.press("Enter");
    await expect(target).toContainText("Нажатий: 1");
    await hold(page, target, -50);
    await target.dispatchEvent("pointercancel", { pointerId: 1 });
    await page.mouse.up();
    await expect(target).toContainText("Нажатий: 1");
  });
}
test("Milo: slider точен при drag, keyboard и крайних значениях", async ({
  page,
}) => {
  await page.goto("/#/milo/v2/flux/controls");
  const slider = page.getByRole("slider", {
    name: "Интенсивность",
    exact: true,
  });
  await slider.scrollIntoViewIfNeeded();
  const b = (await slider.boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width + 100, b.y + 20, { steps: 14 });
  await page.mouse.up();
  await expect(slider).toHaveValue("100");
  await expect
    .poll(() =>
      variable(
        page.locator(".living-slider").filter({ has: slider }),
        "--value",
      ),
    )
    .toBeCloseTo(100, 1);
  await slider.press("Home");
  await expect(slider).toHaveValue("0");
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("1");
  await slider.press("End");
  await expect(slider).toHaveValue("100");
});
test("Milo: switch следует drag, отменяет cancel и доступен с клавиатуры", async ({
  page,
}) => {
  await page.goto("/#/milo/v2/orbit/controls");
  const toggle = page.getByRole("switch", { name: "Тихий вечер", exact: true });
  await hold(page, toggle, 35);
  await page.mouse.up();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await hold(page, toggle, -32);
  await toggle.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
});
test("Milo: выделение перемещается непрерывно, drag и keyboard выбирают пункт", async ({
  page,
}) => {
  await page.goto("/#/milo/v2/flux/controls");
  const tabs = page.getByRole("group", { name: "Период", exact: true });
  const day = tabs.getByRole("button", { name: "День", exact: true }),
    month = tabs.getByRole("button", { name: "Месяц", exact: true });
  await tabs.scrollIntoViewIfNeeded();
  const d = (await day.boundingBox())!,
    m = (await month.boundingBox())!;
  const pill = tabs.locator(".living-pill");
  const start = await variable(pill, "--pillX");
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
  await page.mouse.down();
  await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2, { steps: 14 });
  await expect
    .poll(() => variable(pill, "--pillX"))
    .toBeGreaterThan(start + 15);
  await page.mouse.up();
  await expect(month).toHaveAttribute("aria-pressed", "true");
  await month.press("Home");
  await expect(day).toHaveAttribute("aria-pressed", "true");
  await expect(day).toBeFocused();
  await day.press("ArrowRight");
  await expect(tabs.getByRole("button", { name: "Неделя" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
test("Milo: меню раскрывается в той же форме, dialog возвращает фокус", async ({
  page,
}) => {
  await page.goto("/#/milo/v2/bloom/controls");
  const menu = page.locator(".expanding-material > button");
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page
    .locator("#expanding-actions")
    .getByRole("button", { name: "Задача" })
    .click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toContainText("Задача");
  const trigger = page.getByRole("button", { name: "Открыть пространство" });
  await trigger.click();
  await expect(
    page.getByRole("dialog", { name: "Мы уже внутри." }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
test("Milo: настройки 0/100 и системное уменьшение движения, без хранения", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.locator(".milo-lab")).toHaveAttribute(
    "data-material",
    "souffle",
  );
  await page.getByRole("button", { name: "Ощущения", exact: true }).click();
  const strength = page.getByRole("slider", {
    name: "Податливость интерфейса",
  });
  await strength.press("Home");
  await expect(page.locator(".milo-lab")).toHaveClass(/quiet/);
  const target = page.getByRole("button", { name: "Потяни материал" });
  await hold(page, target, 110);
  expect(await variable(target, "--dragX")).toBe(0);
  await page.mouse.up();
  await expect(target).not.toContainText("Нажатий:");
  await strength.press("End");
  await expect(strength).toHaveValue("100");
  await expect(page.locator(".milo-lab")).not.toHaveClass(/quiet/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".milo-lab")).toHaveClass(/quiet/);
  await page.getByRole("button", { name: "Помощники", exact: true }).click();
  expect(
    await page
      .locator(".pet-body")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  expect(await context.cookies()).toEqual([]);
});
test("Milo: смена разделов сохраняет заметку, переход очищает inert-слой", async ({
  page,
}) => {
  await page.goto("/#/milo/v2/souffle/workspace");
  await page.getByLabel("Быстрая заметка").fill("Синтетическая мысль");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  for (const name of [
    "Документы",
    "Поиск",
    "VPN",
    "Writer",
    "Модули",
    "Сегодня",
  ])
    await page
      .locator(".sidebar")
      .getByRole("button", { name, exact: true })
      .click();
  await expect(page.locator(".workspace-content .morph-ghost")).toBeEmpty();
  await expect(page.locator(".captured-notes")).toContainText(
    "Синтетическая мысль",
  );
  const ids = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[id]")).map((el) => el.id),
  );
  expect(new Set(ids).size).toBe(ids.length);
});
test("Milo: четыре разных характера, контекстная подсказка и отключение", async ({
  page,
}) => {
  await page.goto("/#/milo/v2/souffle/pets");
  const names = ["Луми", "Кип", "Пип", "Сэйдж"],
    messages: string[] = [];
  for (const name of names) {
    await page
      .locator(".crew-cards")
      .getByRole("button", { name: new RegExp(name) })
      .click();
    await page.getByRole("button", { name: "Ошибка", exact: true }).click();
    messages.push(await page.locator(".pet-dialogue p").innerText());
  }
  expect(new Set(messages).size).toBe(4);
  await page.getByRole("button", { name: "Мой промах", exact: true }).click();
  await expect(page.locator(".pet-dialogue p")).toContainText(
    "вывод слишком рано",
  );
  await expect(page.locator(".pet-dialogue .pet-glasses")).toBeVisible();
  await expect(page.locator(".pet-dialogue .pet-book")).toBeVisible();
  await page.getByRole("button", { name: "Интерфейс", exact: true }).click();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".companion-hint strong")).toHaveText("Луми");
  await page
    .getByRole("button", { name: "Закрыть подсказку помощника" })
    .click();
  await expect(page.locator(".companion-hint")).toHaveCount(0);
  await page.getByRole("button", { name: "Ощущения", exact: true }).click();
  await page
    .getByRole("switch", { name: "Подсказки персонажей", exact: true })
    .click();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".companion-hint")).toHaveCount(0);
});
test("Milo: Ореол отзывается соседними кнопками и гаснет при уходе", async ({
  page,
}) => {
  await page.goto("/#/milo/v2/halo/controls");
  const button = page.getByRole("button", { name: "Отменить", exact: true });
  await button.hover();
  await expect.poll(() => variable(button, "--ambient")).toBeGreaterThan(0.1);
  await page.mouse.move(0, 0);
  await expect.poll(() => variable(button, "--ambient")).toBe(0);
});
test("Milo: сенсорное нажатие открывает меню и переключает экран", async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4317/#/milo/v2/souffle/controls");
  await page.locator(".expanding-material > button").tap();
  await expect(page.locator(".expanding-material > button")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.getByRole("button", { name: "Помощники", exact: true }).tap();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Четыре характера",
  );
  await context.close();
});
test("Milo: физический RAF останавливается после взаимодействия", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);
    (window as unknown as { frames: number }).frames = 0;
    window.requestAnimationFrame = (callback) =>
      original((time) => {
        (window as unknown as { frames: number }).frames++;
        callback(time);
      });
  });
  await page.goto("/#/milo/v2/souffle/controls");
  const target = page.getByRole("button", { name: "Потяни материал" });
  await hold(page, target, 70);
  await page.mouse.up();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(2300);
  const frames = await page.evaluate(
    () => (window as unknown as { frames: number }).frames,
  );
  await page.waitForTimeout(400);
  expect(
    await page.evaluate(() => (window as unknown as { frames: number }).frames),
  ).toBe(frames);
});
test("Milo: drag submit не отправляет форму, обычное нажатие работает", async ({
  page,
}) => {
  await page.goto("/#/milo/v2/souffle/auth");
  await page
    .getByPlaceholder("hello@example.com")
    .fill("synthetic@example.com");
  await page.getByPlaceholder("Не меньше 8 символов").fill("Synthetic123");
  const submit = page
    .locator("form")
    .getByRole("button", { name: "Войти", exact: true });
  await hold(page, submit, 75);
  await page.mouse.up();
  await expect(submit).toBeEnabled();
  await page.waitForTimeout(800);
  await expect(page.locator(".auth-complete")).toHaveCount(0);
  await submit.press("Enter");
  await expect(page.locator(".auth-complete")).toBeVisible();
});
