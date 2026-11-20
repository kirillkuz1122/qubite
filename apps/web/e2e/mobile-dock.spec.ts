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
