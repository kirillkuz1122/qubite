import { expect, test } from '@playwright/test';
import { mockDocs } from './docs-mock';

for (const width of [1440, 360]) {
  for (const theme of ['dark', 'light']) {
    test(`история: просмотр, сравнение, восстановление — ${width}px ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
      await page.addInitScript((value) => {
        localStorage.setItem('qubite.look.v1', JSON.stringify({ theme: value }));
      }, theme);
      const server = await mockDocs(page);
      const id = server.add('История заметки', 'Привет, старый мир!');
      await page.goto(`/docs/${id}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const editor = page.getByRole('textbox', { name: 'Текст документа' });
      await expect(editor).toContainText('Привет, старый мир!');
      await expect
        .poll(() => server.pushes.some((push) => push.id === id && push.text.includes('старый')))
        .toBe(true);
      const old = server.snapshot(id, 'До правок');
      await editor.fill('Привет, новый мир!');
      await expect.poll(() => server.markdown.get(id)).toContain('новый');
      const history = page
        .getByRole('article', { name: 'Документ' })
        .getByRole('button', { name: 'История', exact: true });
      await history.click();
      await expect(page.getByRole('button', { name: /До правок · Версия/ })).toBeVisible();
      await page.getByLabel('Имя версии', { exact: true }).fill('После правок');
      await page.getByRole('button', { name: 'Сохранить версию', exact: true }).click();
      await expect(page.getByRole('button', { name: /После правок · Версия/ })).toBeVisible();
      const shot = async (state: string) => {
        await info.attach(`история-${state}-${width}-${theme}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
      };
      await shot('список');
      await page.getByRole('button', { name: /До правок · Версия/ }).click();
      await expect(page.getByLabel('Текст версии', { exact: true })).toContainText(
        'Привет, старый мир!',
      );
      await expect(page.getByLabel('Просмотр версии')).toBeVisible();
      await shot('просмотр');
      await page.getByRole('switch', { name: 'Сравнить с текущей' }).click();
      await expect(page.getByText('± Изменено', { exact: true })).toBeVisible();
      await expect(page.getByText('−старый', { exact: true })).toBeVisible();
      await expect(page.getByText('+новый', { exact: true })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'Изменений: 1' })).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      const restore = page.getByRole('button', { name: 'Восстановить', exact: true });
      if (width === 360) {
        const box = await restore.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.y).toBeGreaterThan(780 / 2);
      }
      await shot('сравнение');
      await restore.click();
      await expect(page.getByText('Текущий текст сохранится в истории')).toBeVisible();
      await shot('подтверждение');
      expect(server.pushes.some((push) => push.reason === 'restore')).toBe(false);
      await page.getByRole('button', { name: 'Восстановить', exact: true }).last().click();
      await expect(page.getByText('Версия восстановлена. Прежний текст — в истории')).toBeVisible();
      await expect(editor).toContainText('Привет, старый мир!');
      await expect(editor).not.toContainText('новый');
      await expect(history).toBeFocused();
      await expect
        .poll(() =>
          server.pushes.some((push) => push.reason === 'restore' && push.restore_of === old.id),
        )
        .toBe(true);
      expect(
        server.versions
          .get(id)
          ?.some((item) => item.kind === 'before_restore' && item.text.includes('новый')),
      ).toBe(true);
      await history.click();
      await expect(page.getByText('Перед восстановлением', { exact: true })).toBeVisible();
    });
  }
}

test('история объясняет ошибку сети и даёт повторить запрос', async ({ page }) => {
  const server = await mockDocs(page);
  const id = server.add('Заметка', 'На устройстве');
  await page.goto(`/docs/${id}`);
  await expect(page.getByRole('textbox', { name: 'Текст документа' })).toContainText(
    'На устройстве',
  );
  server.sync.offline = true;
  await page
    .getByRole('article', { name: 'Документ' })
    .getByRole('button', { name: 'История', exact: true })
    .click();
  await expect(
    page.getByText('Не удалось загрузить историю. Проверьте связь и повторите.'),
  ).toBeVisible();
  server.sync.offline = false;
  await page.getByRole('button', { name: 'Повторить загрузку истории' }).click();
  await expect(
    page.getByText('Версий пока нет — они появляются, когда вы правите документ'),
  ).toBeVisible();
});
