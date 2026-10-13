import { test, expect } from "@playwright/test";
test("real touch gesture on the approved slider follows the finger and returns to idle", async ({
  page,
  context,
}) => {
  await page.goto("/#/settings");
  const slider = page.getByRole("slider", { name: "Податливость интерфейса" });
  await slider.scrollIntoViewIfNeeded();
  const bounds = (await slider.boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const y = bounds.y + 22;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: bounds.x + 18, y }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: bounds.x + bounds.width / 2, y }],
  });
  await expect(slider).toHaveValue("50");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".living-slider").first()).not.toHaveAttribute(
    "data-moving",
    "true",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
