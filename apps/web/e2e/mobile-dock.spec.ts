import { expect, test } from '@playwright/test';
import { mockAuth, OWNER } from './auth-mock';
import { mockSync } from './sync-mock';

/* MOB-001, D-1110: нижнее меню телефона после перезагрузки сразу в итоговом виде. */
test.use({ viewport: { width: 360, height: 780 } });

test('владелец: «Пульт» в нижнем меню с первого кадра, пока /api/auth/me ещё в пути', async ({
  page,
}) => {
  await mockSync(page);
  await mockAuth(page, { me: OWNER });
  // прошлый вход — владелец; ответ «кто вошёл» задерживаем
  await page.addInitScript(() => localStorage.setItem('qubite.owner', '1'));
  await page.route('**/api/auth/me', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ json: OWNER });
  });
  await page.goto('/home');
  const nav = page.getByRole('navigation', { name: 'Разделы' });
  await nav.waitFor();
  const names = ['Главная', 'Сегодня', 'Пульт', 'Planner', 'Ещё'];
  // ответ сервера ещё не пришёл (1,5 с), а все пять пунктов уже на месте
  for (const name of names) {
    await expect(nav.getByRole('button', { name: new RegExp(name) }).first()).toBeVisible({
      timeout: 1000,
    });
  }
  // после ответа сервера набор не меняется
  await page.waitForTimeout(1800);
  await expect(nav.getByRole('button', { name: /Пульт/ })).toHaveCount(1);
});

test('не владелец: подсказка стирается, в меню 4 пункта', async ({ page }) => {
  await mockSync(page);
  await mockAuth(page, { me: { ...OWNER, is_owner: false } });
  await page.addInitScript(() => localStorage.setItem('qubite.owner', '1'));
  await page.goto('/home');
  const nav = page.getByRole('navigation', { name: 'Разделы' });
  await expect(nav.getByRole('button', { name: 'Ещё', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: /Пульт/ })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('qubite.owner'))).toBeNull();
});

/* MOB-001, D-1111: клавиатура и строка браузера. Снимки — в MOB_SHOTS (по умолчанию не пишутся). */
const shots = process.env.MOB_SHOTS;
async function shot(page: import('@playwright/test').Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

for (const theme of ['light', 'dark'] as const) {
  test(`клавиатура (раскладка сжимается, Android): поле Command видно, ${theme}`, async ({
    page,
  }) => {
    await mockSync(page);
    await mockAuth(page, { me: OWNER });
    await page.goto('/today');
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.getByRole('button', { name: 'Открыть Command' }).click();
    const input = page.getByRole('combobox', { name: 'Строка Command' });
    await expect(input).toBeFocused();
    await shot(page, `command-closed-keyboard-${theme}`);
    await page.setViewportSize({ width: 360, height: 460 }); // клавиатура ~320 px
    await expect
      .poll(async () => (await input.boundingBox())?.y ?? 9999, { timeout: 3000 })
      .toBeLessThan(460);
    const box = (await input.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(460);
    await shot(page, `command-keyboard-${theme}`);
  });

  test(`клавиатура (окно не меняется, iPhone): лист «Ещё» над клавиатурой, ${theme}`, async ({
    page,
  }) => {
    await mockSync(page);
    await mockAuth(page, { me: OWNER });
    // подмена visualViewport: клавиатура 320 px, innerHeight прежний
    await page.addInitScript(() => {
      const vv = Object.assign(new EventTarget(), { height: 780, offsetTop: 0, width: 360 });
      Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
      (window as unknown as { __kb: (h: number) => void }).__kb = (h) => {
        vv.height = 780 - h;
        vv.dispatchEvent(new Event('resize'));
      };
    });
    await page.goto('/today');
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page
      .getByRole('navigation', { name: 'Разделы' })
      .getByRole('button', { name: 'Ещё', exact: true })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Ещё' });
    await expect(sheet).toBeVisible();
    await page.evaluate(() => (window as unknown as { __kb: (h: number) => void }).__kb(320));
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--app-vh')))
      .toBe('460px');
    await expect
      .poll(async () => {
        const b = (await sheet.boundingBox())!;
        return b.y + b.height;
      })
      .toBeLessThanOrEqual(461);
    await shot(page, `sheet-keyboard-${theme}`);
    // «строка браузера» (−56 px, без клавиатуры): переменная не выставляется, раскладку ведёт dvh
    await page.evaluate(() => (window as unknown as { __kb: (h: number) => void }).__kb(56));
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--app-vh')))
      .toBe('');
  });
}
