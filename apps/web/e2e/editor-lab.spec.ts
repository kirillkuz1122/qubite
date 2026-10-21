import { expect, test, type Locator, type Page } from '@playwright/test';

// Лаборатория редактора (DOC-001): оба прототипа проходят один и тот же сценарий.
// Сервер не нужен — две копии документа сливаются прямо в браузере.

const PROTOS = [
  { v: 'a', name: 'А · Tiptap' },
  { v: 'b', name: 'Б · Lexical' },
];

const doc = (page: Page, copy: 'Ноутбук' | 'Телефон') =>
  page.getByRole('textbox', { name: `Документ: ${copy}` });

/**
 * Каретка в конец или начало блока — щелчком у края текста. Клавиши End/Home не
 * годятся: на узком экране строка переносится, и End ведёт в конец видимой строки.
 */
async function clickAt(target: Locator, edge: 'end' | 'start') {
  const box = (await target.boundingBox())!;
  // force: у перенесённой строки Lexical (span) угол рамки — уже на абзаце вокруг
  await target.click({
    force: true,
    position: edge === 'end' ? { x: box.width - 1, y: box.height - 4 } : { x: 1, y: 4 },
  });
  // Lexical узнаёт о новой каретке из события selectionchange — даём ему дойти
  await target
    .page()
    .evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function open(page: Page, v: string) {
  await page.goto(`/lab/editor?v=${v}`);
  await expect(doc(page, 'Ноутбук')).toContainText('Конспект: графы');
  await expect(doc(page, 'Телефон')).toContainText('Конспект: графы');
}

for (const p of PROTOS) {
  test.describe(p.name, () => {
    test('правка в сети сразу видна во второй копии', async ({ page }) => {
      await open(page, p.v);
      await clickAt(doc(page, 'Ноутбук').getByText('Граф — это вершины'), 'end');
      await page.keyboard.type(' Бывают ориентированные.');
      await expect(doc(page, 'Телефон')).toContainText('Бывают ориентированные.');
      await expect(page.getByRole('status')).toHaveText('Копии совпадают');
    });

    test('без сети копии расходятся и сливаются без потерь', async ({ page }) => {
      await open(page, p.v);
      await page.getByRole('switch', { name: 'Сеть' }).click();
      // обе правят один и тот же абзац одновременно
      await clickAt(doc(page, 'Ноутбук').getByText('Граф — это вершины'), 'start');
      await page.keyboard.type('НОУТ ');
      await clickAt(doc(page, 'Телефон').getByText('Граф — это вершины'), 'end');
      await page.keyboard.type(' ТЕЛЕФОН');
      // и каждая — свой пункт чек-листа
      await clickAt(doc(page, 'Ноутбук').getByText('повторить Дейкстру').last(), 'end');
      await page.keyboard.press('Enter');
      await page.keyboard.type('дело с ноутбука');
      await clickAt(doc(page, 'Телефон').getByText('решить задачу 3').last(), 'end');
      await page.keyboard.press('Enter');
      await page.keyboard.type('дело с телефона');
      await expect(page.getByRole('status')).toHaveText('Копии разошлись');
      await expect(doc(page, 'Ноутбук')).not.toContainText('ТЕЛЕФОН');

      await page.getByRole('button', { name: 'Слить две копии' }).click();
      await expect(page.getByRole('status')).toHaveText('Копии совпадают');
      for (const copy of ['Ноутбук', 'Телефон'] as const) {
        await expect(doc(page, copy)).toContainText('НОУТ Граф — это вершины');
        await expect(doc(page, copy)).toContainText('между ними. ТЕЛЕФОН');
        await expect(doc(page, copy)).toContainText('дело с ноутбука');
        await expect(doc(page, copy)).toContainText('дело с телефона');
      }
      const a = await doc(page, 'Ноутбук').innerText();
      expect(await doc(page, 'Телефон').innerText()).toBe(a);
    });

    test('/-меню и Markdown-шорткаты делают блоки', async ({ page }) => {
      await open(page, p.v);
      await clickAt(doc(page, 'Ноутбук').getByText('Граф — это вершины'), 'end');
      await page.keyboard.press('Enter');
      await page.keyboard.type('/цит');
      const menu = page.getByRole('listbox', { name: 'Вид блока' });
      await expect(menu.getByRole('option')).toHaveText(['Цитата>']);
      await page.keyboard.press('Enter');
      await expect(menu).toBeHidden();
      await page.keyboard.type('мысль из меню');
      await expect(
        doc(page, 'Телефон').locator('blockquote', { hasText: 'мысль из меню' }),
      ).toBeVisible();

      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.type('## подзаголовок markdown');
      await expect(doc(page, 'Телефон').locator('h2')).toHaveText('подзаголовок markdown');
      await page.keyboard.press('Enter');
      await page.keyboard.type('[ ] новое дело');
      await expect(doc(page, 'Телефон').locator('li', { hasText: 'новое дело' })).toBeVisible();
    });

    test('панель блоков работает касанием', async ({ page }) => {
      await open(page, p.v);
      await doc(page, 'Телефон').getByText('Граф — это вершины').click();
      await page
        .getByRole('toolbar', { name: 'Блоки: Телефон' })
        .getByTitle('Заголовок', { exact: true })
        .click();
      await expect(doc(page, 'Ноутбук').locator('h1').nth(1)).toHaveText(
        'Граф — это вершины и рёбра между ними.',
      );
    });
  });
}

test('лаборатория — ссылкой с витрины', async ({ page }) => {
  await page.goto('/design');
  await page.getByRole('link', { name: 'Лаборатория редактора' }).click();
  await expect(page.getByRole('heading', { name: 'Лаборатория редактора' })).toBeVisible();
});
