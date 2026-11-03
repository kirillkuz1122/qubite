import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import * as Y from 'yjs';
import { join, resolve } from 'node:path';
import { mockDocs } from './docs-mock';

const text = (page: import('@playwright/test').Page) =>
  page.getByRole('textbox', { name: 'Текст документа' });

const backlinks = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Ссылаются сюда', exact: true });

for (const width of [1440, 360]) {
  for (const theme of ['light', 'dark']) {
    test(`обратные ссылки ${width}px, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
      await page.addInitScript((value) => {
        localStorage.setItem('qubite.look.v1', JSON.stringify({ theme: value }));
      }, theme);
      const server = await mockDocs(page);
      const target = server.add('Целевой документ', 'Текст цели');
      const sources = Array.from({ length: 6 }, (_, index) => {
        const title = index === 5 ? '' : `Источник ${index + 1} ${'длинноеназвание'.repeat(12)}`;
        const id = server.add(title, `Упоминание [@Целевой документ](qubite://${target})`);
        server.mentions.set(id, [target]);
        return id;
      });
      await page.goto(`/docs/${target}`);
      await expect(text(page)).toContainText('Текст цели');
      const panel = backlinks(page);
      await expect(panel.getByRole('link')).toHaveCount(5);
      await panel.scrollIntoViewIfNeeded();
      await expect(panel).toContainText('6');
      const more = panel.getByRole('button', { name: 'Ещё 1' });
      for (const row of [...(await panel.getByRole('link').all()), more]) {
        await expect
          .poll(async () => (await row.boundingBox())?.height ?? 0)
          .toBeGreaterThanOrEqual(44);
        await expect
          .poll(async () => (await row.boundingBox())?.width ?? 0)
          .toBeGreaterThanOrEqual(44);
      }
      await more.click();
      await expect(panel.getByRole('link')).toHaveCount(6);
      await expect(panel.getByRole('link', { name: 'Без названия · Документ' })).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);

      const rows = panel.getByRole('link');
      await rows.first().focus();
      await page.keyboard.press('ArrowDown');
      await expect(rows.nth(1)).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(rows.first()).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(rows.last()).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(rows.first()).toBeFocused();
      await expect(rows.first()).toHaveAttribute('href', `/docs/${sources[0]}`);
      await page.keyboard.press(width === 360 ? 'Space' : 'Enter');
      await expect(page).toHaveURL(new RegExp(`/docs/${sources[0]}$`));
      await expect(text(page)).toContainText('Упоминание');
    });
  }

  test(`обратные ссылки: набор и офлайн ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    const server = await mockDocs(page);
    const target = server.add('Целевой документ', 'Текст цели\n\n'.repeat(24));
    const source = server.add('Источник', `[@Целевой документ](qubite://${target})`);
    server.mentions.set(source, [target]);
    await page.goto(`/docs/${target}`);
    await expect(text(page)).toContainText('Текст цели');
    await expect(backlinks(page).getByRole('link')).toHaveCount(1);
    await text(page).click();
    if (width === 360) {
      await expect(page.locator('.docs-backlinks')).toHaveAttribute('inert', '');
      await expect(backlinks(page)).toHaveCount(0);
      // Обычная прокрутка пальцем/колесом раскрывает ссылки, не уводя фокус из текста.
      await page.mouse.wheel(0, 2000);
      await expect(page.locator('.docs-backlinks')).not.toHaveAttribute('inert', '');
      await expect(backlinks(page).getByRole('link')).toBeVisible();
      await expect(text(page)).toBeFocused();
      await page.keyboard.insertText('Дополнение');
      await expect(page.locator('.docs-backlinks')).toHaveAttribute('inert', '');
    } else {
      await expect(backlinks(page)).toBeVisible();
    }
    await page.getByRole('button', { name: 'К документам' }).click();
    const row = page.getByRole('button', { name: /Целевой документ/ });
    await expect(row).toBeVisible();
    server.sync.offline = true;
    await row.click();
    await expect(backlinks(page).getByRole('link', { name: 'Источник · Документ' })).toBeVisible();
    await expect(backlinks(page)).toContainText('Без сети');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  });

  test(`обратные ссылки: синк и нулевой список ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    const server = await mockDocs(page);
    const target = server.add('Цель', 'Текст цели');
    const source = server.add('Источник');
    await page.goto(`/docs/${target}`);
    await expect(text(page)).toContainText('Текст цели');
    await expect.poll(() => server.backlinkQueries.includes(target)).toBe(true);
    await expect(backlinks(page)).toHaveCount(0);

    // Упоминание пришло с другого устройства; WebSocket запускает синк документов.
    server.mentions.set(source, [target]);
    server.sync.patch(source, {});
    server.sync.ping();
    await expect(backlinks(page).getByRole('link', { name: 'Источник · Документ' })).toBeVisible();
    server.sync.objects.set(source, { ...server.sync.objects.get(source)!, deleted: true });
    server.sync.patch(source, {});
    server.sync.ping();
    await expect(backlinks(page)).toHaveCount(0);
  });

  test(`обратные ссылки: дело и проект ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    const server = await mockDocs(page);
    const project = server.sync.addProject('Проект', { tag: 'проект', notes: '' });
    const task = server.sync.addTask('Дело', { project_id: project });
    const source = server.add('План работы');
    server.mentions.set(source, [task, project]);
    await page.route(`**/api/v1/projects/${project}`, (route) =>
      route.fulfill({
        json: {
          project: { id: project, title: 'Проект', color: 'orange', tag: 'проект', notes: '' },
          tasks: [],
          files: [],
          docs: [],
          events: [],
          feed: [],
          memory: null,
        },
      }),
    );
    await page.goto(`/planner?task=${task}`);
    const sheet = page.getByRole('dialog', { name: 'Место и дорога' });
    const taskPanel = sheet.getByRole('region', { name: 'Ссылаются сюда' });
    await expect(taskPanel.getByRole('link', { name: 'План работы · Документ' })).toBeVisible();
    await expect.poll(() => server.backlinkQueries.includes(task)).toBe(true);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.goto(`/planner/project/${project}`);
    await expect(backlinks(page).getByRole('link', { name: 'План работы · Документ' })).toBeVisible();
    await expect.poll(() => server.backlinkQueries.includes(project)).toBe(true);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  });
}

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
      expect(box!.width).toBeLessThanOrEqual(325);
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
      `/docs/${target}`,
      '_blank',
      'noopener,noreferrer',
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
