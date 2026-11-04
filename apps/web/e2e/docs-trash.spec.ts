import { expect, test } from '@playwright/test';
import { mockDocs } from './docs-mock';

for (const width of [1440, 360]) {
  for (const theme of ['dark', 'light']) {
    test(`корзина: создать, удалить и вернуть — ${width}px ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
      await page.addInitScript((value) => {
        localStorage.setItem('qubite.look.v1', JSON.stringify({ theme: value }));
      }, theme);
      const server = await mockDocs(page);
      await page.goto('/docs');
      await page.getByRole('button', { name: '+ Документ', exact: true }).click();
      const title = page.getByRole('textbox', { name: 'Название документа' });
      await title.fill('Заметка из корзины');
      const editor = page.getByRole('textbox', { name: 'Текст документа' });
      await editor.fill('Текст останется после возврата');
      const id = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1)!);
      await expect.poll(() => server.sync.objects.get(id)?.title).toBe('Заметка из корзины');
      await expect.poll(() => server.markdown.get(id)).toContain('Текст останется');
      const shot = async (state: string) => {
        await info.attach(`корзина-${state}-${width}-${theme}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
      };
      const noOverflow = async () => {
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true);
      };
      const remove = page
        .getByRole('article', { name: 'Документ' })
        .getByRole('button', { name: 'Удалить', exact: true });
      await noOverflow();
      await shot('документ');
      await remove.click();
      const dialog = page.getByRole('dialog', { name: 'Удалить документ' });
      await expect(dialog.getByText('Документ уйдёт в корзину. Его можно вернуть')).toBeVisible();
      expect(server.sync.objects.get(id)?.deleted).toBe(false);
      await noOverflow();
      await shot('подтверждение');
      await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();
      await expect(page).toHaveURL(/\/docs$/);
      const undo = page.getByRole('button', { name: 'Вернуть', exact: true });
      await expect(undo).toBeFocused();
      await expect(page.getByText('Документ в корзине ·')).toBeVisible();
      await expect.poll(() => server.sync.objects.get(id)?.deleted).toBe(true);
      await shot('заметка');
      await page.getByRole('radio', { name: 'Корзина', exact: true }).click();
      const trash = page.getByRole('region', { name: 'Корзина документов' });
      await expect(trash.getByText('Заметка из корзины', { exact: true })).toBeVisible();
      await expect(trash.getByText('Текст останется после возврата')).toBeVisible();
      await expect(trash.getByText(/^Удалён /)).toBeVisible();
      await expect(trash.getByRole('listitem')).toHaveCount(1);
      await expect(editor).toHaveCount(0);
      const restore = trash.getByRole('button', { name: 'Вернуть «Заметка из корзины»' });
      // Кнопка появляется с лёгким масштабом: ждём, пока анимация закончится.
      await expect
        .poll(async () => {
          const box = await restore.boundingBox();
          return Math.min(box?.width ?? 0, box?.height ?? 0);
        })
        .toBeGreaterThanOrEqual(44);
      await noOverflow();
      await shot('список');
      await restore.click();
      const index = page.getByRole('complementary', { name: 'Список документов' });
      const row = index.getByRole('button', { name: /Заметка из корзины/ });
      await expect(row).toBeVisible();
      await expect(row).toBeFocused();
      await expect.poll(() => server.sync.objects.get(id)?.deleted).toBe(false);
      await row.click();
      await expect(title).toHaveValue('Заметка из корзины');
      await expect(editor).toContainText('Текст останется после возврата');
      await page.getByRole('button', { name: 'К документам' }).click();
      await page.getByRole('radio', { name: 'Корзина', exact: true }).click();
      await expect(trash.getByText('Корзина пуста')).toBeVisible();
      await noOverflow();
      await shot('пусто');
    });
  }
}

test('корзина: удаление и возврат без сети отправляются при подключении', async ({
  page,
  context,
}) => {
  const server = await mockDocs(page);
  const id = server.add('Офлайн-документ', 'Сохранённый текст');
  await page.goto(`/docs/${id}`);
  await expect(page.getByRole('textbox', { name: 'Текст документа' })).toContainText(
    'Сохранённый текст',
  );
  await expect.poll(() => server.pushes.some((push) => push.id === id)).toBe(true);
  server.sync.offline = true;
  await context.setOffline(true);
  await page
    .getByRole('article', { name: 'Документ' })
    .getByRole('button', { name: 'Удалить', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Вернуть', exact: true })).toBeFocused();
  expect(server.sync.ops.some((op) => op.kind === 'delete')).toBe(false);
  await page.getByRole('radio', { name: 'Корзина', exact: true }).click();
  const trash = page.getByRole('region', { name: 'Корзина документов' });
  await expect(trash.getByText(/Без сети/)).toBeVisible();
  await trash.getByRole('button', { name: 'Вернуть «Офлайн-документ»' }).click();
  const row = page
    .getByRole('complementary', { name: 'Список документов' })
    .getByRole('button', { name: /Офлайн-документ/ });
  await expect(row).toBeFocused();
  expect(server.sync.ops.some((op) => op.kind === 'restore')).toBe(false);
  server.sync.offline = false;
  await context.setOffline(false);
  server.sync.ping();
  await expect
    .poll(() =>
      server.sync.ops
        .filter((op) => op.object_id === id && (op.kind === 'delete' || op.kind === 'restore'))
        .map((op) => op.kind),
    )
    .toEqual(['delete', 'restore']);
  await expect.poll(() => server.sync.objects.get(id)?.deleted).toBe(false);
  await row.click();
  await expect(page.getByRole('textbox', { name: 'Текст документа' })).toContainText(
    'Сохранённый текст',
  );
});

test('корзина: быстрый возврат из заметки', async ({ page }) => {
  const server = await mockDocs(page);
  const id = server.add('Вернуть сразу', 'Текст');
  await page.goto(`/docs/${id}`);
  await expect(page.getByRole('textbox', { name: 'Текст документа' })).toContainText('Текст');
  await page
    .getByRole('article', { name: 'Документ' })
    .getByRole('button', { name: 'Удалить', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.getByRole('button', { name: 'Вернуть', exact: true }).click();
  await expect(
    page
      .getByRole('complementary', { name: 'Список документов' })
      .getByRole('button', { name: /Вернуть сразу/ }),
  ).toBeFocused();
  await expect.poll(() => server.sync.objects.get(id)?.deleted).toBe(false);
});
