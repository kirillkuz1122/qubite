import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import * as Y from 'yjs';
import { join, resolve } from 'node:path';
import { mockDocs } from './docs-mock';

const text = (page: import('@playwright/test').Page) =>
  page.getByRole('textbox', { name: 'Текст документа' });

test('создать и написать без сети, пережить перезагрузку, отправить после восстановления', async ({
  page,
}) => {
  const server = await mockDocs(page);
  await page.goto('/docs');
  await expect(page.getByRole('button', { name: 'Создать первый документ' })).toBeVisible();
  server.sync.offline = true;
  await page.getByRole('button', { name: 'Создать первый документ' }).click();
  await expect(page).toHaveURL(/\/docs\/[\w-]+$/);
  await page.getByRole('textbox', { name: 'Название документа' }).fill('Без сети');
  await text(page).click();
  await page.keyboard.insertText('Записано на устройстве');
  await expect(text(page)).toContainText('Записано на устройстве');
  await page.reload();
  await expect(text(page)).toContainText('Записано на устройстве');
  await expect(page.getByRole('textbox', { name: 'Название документа' })).toHaveValue('Без сети');
  expect(server.pushes).toHaveLength(0);
  server.sync.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(() => server.pushes.some((push) => push.text.includes('Записано на устройстве')))
    .toBe(true);
  await expect(page.getByRole('status').filter({ hasText: /^Сохранено$/ })).toBeVisible();
  await page.reload();
  await expect(text(page)).toContainText('Записано на устройстве');
});

test('локальный поиск по названию и превью, сетевой — по полному тексту', async ({ page }) => {
  const server = await mockDocs(page);
  server.add('Графы', 'Обход в ширину');
  server.add('Алгебра', 'Матрицы');
  await page.goto('/docs');
  await expect(page.getByRole('button', { name: /Графы/ })).toBeVisible();
  server.sync.offline = true;
  const search = page.getByRole('searchbox', { name: 'Поиск документов' });
  await search.fill('ширину');
  await expect(page.getByRole('button', { name: /Графы/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Алгебра/ })).toBeHidden();
  await search.fill('алгебра');
  await expect(page.getByRole('button', { name: /Алгебра/ })).toBeVisible();
  server.sync.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await search.fill('матрицы');
  await expect.poll(() => server.queries.includes('матрицы')).toBe(true);
  await expect(page.getByRole('button', { name: /Алгебра/ })).toBeVisible();
});

test('вид блока, Markdown, чек-лист и отступы', async ({ page }) => {
  const server = await mockDocs(page);
  const id = server.add('Конспект', 'Первый абзац');
  await page.goto(`/docs/${id}`);
  await expect(text(page)).toContainText('Первый абзац');
  await text(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('/цит');
  const menu = page.getByRole('listbox', { name: 'Вид блока' });
  await expect(menu.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Мысль');
  await expect(text(page).locator('[data-kind="quote"]')).toContainText('Мысль');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[ ] Сделать');
  const todo = text(page).locator('[data-kind="todo"]');
  await expect(todo).toContainText('Сделать');
  await page.getByRole('checkbox', { name: 'Выполнено: Сделать' }).check();
  await expect(todo).toHaveAttribute('data-checked', 'true');
  await text(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Tab');
  await expect(todo).toHaveAttribute('data-indent', '1');
  await page.keyboard.press('Shift+Tab');
  await expect(todo).toHaveAttribute('data-indent', '0');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(text(page).locator('[data-kind="p"]').last()).toBeVisible();
});

test('WebSocket «есть новое» забирает Yjs открытого документа', async ({ page }) => {
  const server = await mockDocs(page);
  const id = server.add('Общий документ', 'Текст с другого устройства');
  await page.goto(`/docs/${id}`);
  await expect(text(page)).toContainText('Текст с другого устройства');
  await expect.poll(() => server.pushes.some((push) => push.id === id)).toBe(true);
  const root = server.documents.get(id)!.get('root', Y.XmlText);
  // Другая копия меняет свойство вида, сохраняя тот же совместный текст.
  for (const delta of root.toDelta()) {
    if (delta.insert instanceof Y.XmlText) delta.insert.setAttribute('__kind', 'h2');
  }
  server.sync.patch(id, {});
  server.sync.ping();
  await expect(
    text(page).locator('[data-kind="h2"]').filter({ hasText: 'Текст с другого устройства' }),
  ).toBeVisible();
});

test('в удалённый на другом устройстве блок дописали — можно вернуть', async ({ page }) => {
  const server = await mockDocs(page);
  const id = server.add('Общий', 'Первый\n\nВторой');
  await page.goto(`/docs/${id}`);
  await expect(text(page)).toContainText('Второй');
  await expect.poll(() => server.pushes.some((push) => push.id === id)).toBe(true);
  server.sync.offline = true;
  await text(page).getByText('Второй').click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' дописка');
  // Другое устройство тем временем удалило второй блок.
  const root = server.documents.get(id)!.get('root', Y.XmlText);
  const blocks = root.toDelta() as { insert: unknown }[];
  const second = blocks.findIndex(
    (delta) => delta.insert instanceof Y.XmlText && delta.insert.toString().includes('Второй'),
  );
  root.delete(second, 1);
  server.sync.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  server.sync.patch(id, {});
  server.sync.ping();
  const note = page.getByRole('status').filter({ hasText: 'Вернуть?' });
  await expect(note).toContainText('дописка');
  await note.getByRole('button', { name: 'Вернуть' }).click();
  await expect(text(page)).toContainText('дописка');
  await expect(note).toBeHidden();
});

for (const theme of ['light', 'dark']) {
  for (const width of [1440, 360]) {
    test(`раскладка ${width}px, тема ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
      // Тема — как её выбирает человек: холсты с точками берут цвета темы при появлении.
      await page.addInitScript((value) => {
        localStorage.setItem('qubite.look.v1', JSON.stringify({ theme: value }));
      }, theme);
      const server = await mockDocs(page);
      server.add('Заметки', '# Заголовок\nТекст документа\n- [ ] Пункт');
      await page.goto('/docs');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const row = page.getByRole('button', { name: /Заметки/ });
      await expect(row).toBeVisible();
      // Превью — чистый текст, без знаков Markdown.
      await expect(row.locator('.docs-row-preview')).toHaveText('Заголовок Текст документа Пункт');
      const directory = resolve(import.meta.dirname, '../../../docs/design/screens/doc-002');
      await mkdir(directory, { recursive: true });
      const shot = async (name: string) => {
        // Заголовок из точек собирается около секунды.
        await page.waitForTimeout(1200);
        await info.attach(`doc-002-${name}-${width}-${theme}`, {
          body: await page.screenshot({
            path: join(directory, `${info.project.name}-${name}-${width}-${theme}.png`),
          }),
          contentType: 'image/png',
        });
      };
      await shot('list');
      await row.click();
      await expect(text(page)).toContainText('Текст документа');
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      // Галочка стоит на первой строке пункта: центры совпадают.
      const gap = await page.evaluate(() => {
        const todo = document.querySelector('[data-kind="todo"]')!;
        const box = todo.querySelector('.q-check-box')!.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(todo.querySelector('.docs-block-content')!);
        const line = range.getClientRects()[0]!;
        return Math.abs(box.top + box.height / 2 - (line.top + line.height / 2));
      });
      expect(gap).toBeLessThanOrEqual(2);
      const tools = page.getByRole('toolbar', { name: 'Блоки', exact: true });
      // Без фокуса панели блоков нет: она не висит посреди экрана.
      await expect(tools).toBeHidden();
      await shot('editor');
      if (width === 360) {
        await expect(page.getByRole('complementary', { name: 'Список документов' })).toBeHidden();
        await text(page).click();
        await expect(tools).toBeVisible();
        // Над каплей у нижнего края, а не посреди экрана.
        await expect
          .poll(async () => {
            const box = await page.locator('.docs-tools').boundingBox();
            return box ? Math.round(780 - box.y - box.height) : -1;
          })
          .toBe(88);
        await shot('editor-focus');
        await page.getByRole('button', { name: 'К документам' }).click();
        await expect(tools).toBeHidden();
      } else {
        await page.getByRole('button', { name: 'К документам' }).click();
      }
      // После открытия превью пересобрано из текста редактора — тоже без разметки.
      await expect(row.locator('.docs-row-preview')).toHaveText('Заголовок Текст документа Пункт');
    });
  }
}


for (const width of [1440, 360]) {
  test(`упоминание: меню, переход, кэш без сети и удаление чипа — ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    const server = await mockDocs(page);
    const id = server.add('С упоминанием');
    const target = server.add('Графы');
    await page.goto(`/docs/${id}`);
    await text(page).click();
    await page.keyboard.insertText('почта a@b');
    await expect(page.getByRole('listbox', { name: 'Ссылка на объект' })).toBeHidden();
    await page.keyboard.insertText(' @');
    const menu = page.getByRole('listbox', { name: 'Ссылка на объект' });
    await expect(menu.getByRole('option', { name: /Графы/ })).toBeVisible();
    expect(server.targetQueries).toContain('');
    if (width === 360) {
      const box = await menu.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(324);
      expect(box!.y + box!.height).toBeLessThanOrEqual(780 - 88);
      const row = await menu.getByRole('option', { name: /Графы/ }).boundingBox();
      expect(row!.height).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(text(page)).toContainText('a@b @');
    // Выход из прежнего триггера, затем новый поиск.
    await page.keyboard.insertText(' @Гра');
    await expect(menu.getByRole('option', { name: /Графы/ })).toBeVisible();
    await page.keyboard.press('Tab');
    const chip = text(page).getByRole('link', { name: 'Документ: Графы' });
    await expect(chip).toBeVisible();
    await expect.poll(() => server.pushes.at(-1)?.links).toEqual([target]);
    expect(server.pushes.at(-1)?.text).toContain(`[@Графы](qubite://${target})`);

    // Проверяем запрос новой вкладки, не выводя её из поддельного API этой страницы.
    await page.evaluate(() => {
      window.open = (url, target, features) => {
        Object.assign(window, { mentionOpened: [String(url), target, features] });
        return null;
      };
    });
    await chip.click({ modifiers: ['Control'] });
    expect(await page.evaluate(() => Reflect.get(window, 'mentionOpened'))).toEqual([
      `/docs/${target}`, '_blank', 'noopener,noreferrer',
    ]);
    await chip.click();
    await expect(page).toHaveURL(new RegExp(`/docs/${target}$`));
    await page.goto(`/docs/${id}`);
    await expect(text(page).getByRole('link', { name: 'Документ: Графы' })).toBeVisible();

    server.sync.offline = true;
    await page.reload();
    await expect(text(page).getByRole('link', { name: 'Документ: Графы' })).toBeVisible();
    server.sync.offline = false;
    server.deletedTargets.add(target);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const deleted = text(page).getByRole('link', { name: 'Документ: Удалено' });
    await expect(deleted).toHaveAttribute('aria-disabled', 'true');
    server.deletedTargets.delete(target);
    server.targets.set(target, { id: target, type: 'docs.page', title: 'Теория графов' });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const restored = text(page).getByRole('link', { name: 'Документ: Теория графов' });
    await expect(restored).toBeVisible();

    await text(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Backspace');
    await expect(restored).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('Backspace');
    await expect(restored).toBeHidden();
    await expect.poll(() => server.pushes.at(-1)?.links).toEqual([]);
    expect(server.pushes.at(-1)?.text).not.toContain('qubite://');
  });
}
