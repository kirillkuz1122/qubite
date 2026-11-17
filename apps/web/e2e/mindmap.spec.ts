import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { mockDocs } from './docs-mock';

// DOC-006: mind map в Docs. Макеты — docs/design/MINDMAP.md.
const canvas = (page: Page) => page.getByRole('tree', { name: /Mind map/ });
const node = (page: Page, name: string | RegExp) =>
  page.getByRole('treeitem', { name, exact: typeof name === 'string' });
const noScroll = (page: Page) =>
  expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);

async function createFromMenu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Ещё' }).first().click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  await expect(canvas(page)).toBeVisible();
}

/** Узел за краем экрана — сначала сдвинуть карту за пустое место, как сделал бы человек. */
async function show(page: Page, name: string) {
  const view = page.viewportSize()!;
  const area = (await canvas(page).boundingBox())!;
  for (let i = 0; i < 4; i++) {
    const box = (await node(page, name).boundingBox())!;
    const dx = Math.min(0, view.width - 24 - (box.x + box.width)) + Math.max(0, 24 - box.x);
    if (!dx) return;
    // Пустое место холста: не узел, не кнопки поверх.
    const spot = await page.evaluate(
      ({ area, left }) => {
        for (let y = area.y + 12; y < area.y + area.height - 200; y += 16)
          for (const x of left
            ? [area.x + 20, area.x + 60]
            : [area.x + area.width - 20, area.x + area.width - 60]) {
            const hit = document.elementFromPoint(x, y);
            if (hit?.closest('.mm-canvas') && !hit.closest('[data-node]')) return { x, y };
          }
        return null;
      },
      { area, left: dx > 0 },
    );
    if (!spot) return;
    const { x, y } = spot;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y, { steps: 3 });
    await page.mouse.move(x + dx, y, { steps: 3 });
    await page.mouse.up();
  }
}

/** Карта доезжает пружиной — нажимаем, когда узел встал. */
async function settled(page: Page, name: string) {
  await expect
    .poll(async () => {
      const a = await node(page, name).boundingBox();
      await page.waitForTimeout(120);
      const b = await node(page, name).boundingBox();
      return Math.abs((a?.x ?? 0) - (b?.x ?? 0)) + Math.abs((a?.y ?? 0) - (b?.y ?? 0));
    })
    .toBeLessThan(0.5);
}

async function tap(page: Page, name: string) {
  await settled(page, name);
  await show(page, name);
  await settled(page, name);
  const box = (await node(page, name).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

for (const width of [1440, 360]) {
  for (const theme of ['dark', 'light']) {
    test(`mind map ${width}px, ${theme}: шаблон, выделение, правка, свёртка, снимки`, async ({
      page,
    }, info) => {
      test.skip(info.project.name !== 'chromium', 'снимки и раскладка — один браузер');
      await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
      await page.addInitScript((value) => {
        localStorage.setItem('qubite.look.v1', JSON.stringify({ theme: value }));
      }, theme);
      const server = await mockDocs(page);
      server.add('Конспект', 'Текст');
      const directory = resolve(import.meta.dirname, '../../../docs/design/screens/DOC-006');
      await mkdir(directory, { recursive: true });
      const shot = async (name: string) => {
        await page.waitForTimeout(900);
        await info.attach(`${name}-${width}-${theme}`, {
          body: await page.screenshot({ path: join(directory, `${name}-${width}-${theme}.png`) }),
          contentType: 'image/png',
        });
      };
      await page.goto('/docs');
      // Создать — меню «Ещё» рядом с «+» (D-1003).
      await page.getByRole('button', { name: 'Ещё' }).first().click();
      await expect(page.getByRole('menuitem', { name: 'Mind map', exact: true })).toBeVisible();
      await shot('create');
      await page.getByRole('menuitem', { name: 'Mind map: collocations', exact: true }).click();
      await expect(canvas(page)).toBeVisible();
      await expect(node(page, 'information')).toBeVisible();
      await expect(node(page, 'noun + information')).toBeVisible();
      // Текст документа для поиска и версий — вложенный список (D-1002).
      await expect
        .poll(() => server.pushes.at(-1)?.text ?? '')
        .toContain('- information\n  - noun + information\n    - a piece of ~');
      await noScroll(page);

      // Свернуть ветку прилагательных: счётчик +5.
      await tap(page, 'adjective + information');
      if (width === 1440) await page.keyboard.press('Control+.');
      else
        await page
          .getByRole('toolbar', { name: 'Действия с узлом' })
          .getByRole('button', { name: 'Свернуть' })
          .click();
      await expect(node(page, 'adjective + information')).toContainText('+5');
      await expect(node(page, 'useful ~')).toHaveCount(0);
      await tap(page, 'a source of ~');
      await expect(node(page, 'a source of ~')).toHaveAttribute('aria-selected', 'true');
      await shot('overview');

      // Новый узел: Tab на ПК, «Ветка» на телефоне; текст пишется сразу в документ.
      await tap(page, 'noun + information');
      if (width === 1440) await page.keyboard.press('Tab');
      else
        await page
          .getByRole('toolbar', { name: 'Действия с узлом' })
          .getByRole('button', { name: 'Ветка' })
          .click();
      const input = page.getByRole('textbox', { name: 'Текст узла' });
      await expect(input).toBeFocused();
      await input.fill('a bit of');
      await shot('edit');
      await input.press('Enter');
      await expect(node(page, 'a bit of')).toBeVisible();
      await expect.poll(() => server.pushes.at(-1)?.text ?? '').toContain('    - a bit of');

      // Меню узла: ПК — «Ещё» у узла, телефон — лист.
      await tap(page, 'noun + information');
      if (width === 1440) {
        await page.getByRole('button', { name: 'Действия с узлом' }).click();
        await expect(page.getByRole('menuitem', { name: /Дочерний узел/ })).toBeVisible();
      } else {
        await page
          .getByRole('toolbar', { name: 'Действия с узлом' })
          .getByRole('button', { name: 'Ещё' })
          .click();
        await expect(
          page.getByRole('dialog', { name: /Ветка «noun \+ information»/ }),
        ).toBeVisible();
      }
      await shot('menu');
      await page.keyboard.press('Escape');
      await noScroll(page);
    });
  }
}

test('новая карта: центр сразу в правке, Tab — ветка, Enter — соседняя, Delete — удалить', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const server = await mockDocs(page);
  server.add('Конспект', 'Текст');
  await page.goto('/docs');
  await createFromMenu(page, 'Mind map');
  const input = page.getByRole('textbox', { name: 'Текст узла' });
  await expect(input).toBeFocused();
  await input.fill('information');
  await input.press('Tab');
  await page.keyboard.type('noun +');
  await page.keyboard.press('Enter');
  await expect(node(page, 'noun +')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await page.keyboard.type('verb +');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('provide ~');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => server.pushes.at(-1)?.text ?? '')
    .toBe('- information\n  - noun +\n  - verb +\n    - provide ~');
  // verb + — слева от центра: стрелка вправо от её листа ведёт к ней; Delete удаляет ветку.
  await page.keyboard.press('ArrowRight');
  await expect(node(page, 'verb +')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Delete');
  await expect(node(page, 'provide ~')).toHaveCount(0);
  await expect.poll(() => server.pushes.at(-1)?.text ?? '').toBe('- information\n  - noun +');
  // Esc на пустом новом узле — узла нет.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('treeitem')).toHaveCount(2);
  // В списке у карты — значок, после перезагрузки карта открывается картой.
  await page.reload();
  await expect(canvas(page)).toBeVisible();
  await expect(node(page, 'noun +')).toBeVisible();
});

test('палец: долгое нажатие переносит ветку, щипок меняет масштаб', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'касания — Chromium');
  await page.setViewportSize({ width: 360, height: 780 });
  const server = await mockDocs(page);
  server.add('Конспект', 'Текст');
  await page.goto('/docs');
  await createFromMenu(page, 'Mind map: collocations');
  await expect(node(page, 'noun + information')).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: { x: number; y: number }[],
  ) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p, id) => ({ ...p, id })),
    });
  // Щипок двумя пальцами — масштаб меняется (кнопок масштаба на телефоне нет).
  const center = (await canvas(page).boundingBox())!;
  const cx = center.x + center.width / 2;
  const cy = center.y + center.height / 2;
  const before = await page.evaluate(
    () => document.querySelector<HTMLElement>('.mm-layer')!.style.transform,
  );
  await touch('touchStart', [
    { x: cx - 40, y: cy },
    { x: cx + 40, y: cy },
  ]);
  await touch('touchMove', [
    { x: cx - 80, y: cy },
    { x: cx + 80, y: cy },
  ]);
  await touch('touchEnd', []);
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector<HTMLElement>('.mm-layer')!.style.transform),
    )
    .not.toBe(before);
  // «Вся карта» — центр снова виден.
  await page.getByRole('button', { name: 'Вся карта' }).click();
  await expect(node(page, 'information')).toBeInViewport();
  // Вид доезжает пружиной — координаты берём, когда он встал.
  await expect
    .poll(async () => {
      const a = await node(page, 'information').boundingBox();
      await page.waitForTimeout(150);
      const b = await node(page, 'information').boundingBox();
      return Math.abs((a?.x ?? 0) - (b?.x ?? 0)) + Math.abs((a?.width ?? 0) - (b?.width ?? 0));
    })
    .toBeLessThan(0.5);
  // Долгое нажатие на лист и бросок на другую ветку — лист переезжает.
  const leaf = (await node(page, 'a lack of ~').boundingBox())!;
  const into = (await node(page, 'information').boundingBox())!;
  const from = { x: leaf.x + leaf.width / 2, y: leaf.y + leaf.height / 2 };
  const to = { x: into.x + into.width / 2, y: into.y + into.height / 2 };
  await touch('touchStart', [from]);
  await page.waitForTimeout(500);
  await touch('touchMove', [{ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }]);
  await touch('touchMove', [to]);
  await touch('touchEnd', []);
  await expect.poll(() => server.pushes.at(-1)?.text ?? '').toContain('\n  - a lack of ~');
});

test('экспорт PNG и SVG, узел-ссылка @ на документ', async ({ page }, info) => {
  test.skip(info.project.name === 'firefox-mobile', 'ПК-сценарий');
  await page.setViewportSize({ width: 1440, height: 900 });
  const server = await mockDocs(page);
  const lesson = server.add('Урок английского', 'Домашнее задание');
  await page.goto('/docs');
  await createFromMenu(page, 'Mind map: collocations');
  await expect(node(page, 'information')).toBeVisible();

  // Ссылка: «Действия с узлом» → «Ссылка на объект…» → поиск → узел-ссылка под центром.
  await tap(page, 'information');
  await page.getByRole('button', { name: 'Действия с узлом' }).click();
  await page.getByRole('menuitem', { name: 'Ссылка на объект…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ссылка на объект' });
  await dialog.getByRole('textbox', { name: 'Дело, документ или событие' }).fill('Урок');
  await dialog.getByRole('button', { name: /Урок английского · Документ/ }).click();
  await expect(node(page, 'Урок английского')).toBeVisible();
  await expect(node(page, 'Урок английского')).toContainText('@');
  await expect
    .poll(() => server.pushes.at(-1)?.text ?? '')
    .toContain(`  - [@Урок английского](qubite://${lesson})`);
  await expect.poll(() => server.pushes.at(-1)?.links ?? []).toContain(lesson);

  // Скачать: SVG — рисунок с подписями, PNG — картинка.
  const save = async (item: string) => {
    await page.getByRole('button', { name: 'Скачать' }).click();
    const wait = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: item }).click();
    return wait;
  };
  const svg = await save('Рисунок SVG');
  expect(svg.suggestedFilename()).toBe('Collocations information.svg');
  const text = await (await svg.createReadStream()).toArray();
  const body = Buffer.concat(text).toString('utf8');
  expect(body).toContain('<svg');
  expect(body).toContain('noun + information');
  expect(body).toContain('@ Урок английского');
  const png = await save('Картинка PNG');
  expect(png.suggestedFilename()).toBe('Collocations information.png');
  const bytes = Buffer.concat(await (await png.createReadStream()).toArray());
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  expect(bytes.length).toBeGreaterThan(5000);
});

for (const width of [1440, 360]) {
  test(`AI: предложить подузлы ветки, ${width}px (ответ шлюза — мок)`, async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium', 'один браузер');
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    const server = await mockDocs(page);
    server.add('Конспект', 'Текст');
    const asked: unknown[] = [];
    let budget = false;
    await page.route('**/api/v1/docs/mindmap/suggest', async (route) => {
      asked.push(route.request().postDataJSON());
      if (budget)
        return route.fulfill({
          status: 409,
          json: { error: 'budget_exceeded', message: 'Дневной лимит AI исчерпан' },
        });
      return route.fulfill({
        json: { suggestions: ['valuable ~', 'reliable ~', 'first-hand ~'], cost_usd_micros: 120 },
      });
    });
    await page.goto('/docs');
    await createFromMenu(page, 'Mind map: collocations');
    await tap(page, 'adjective + information');
    if (width === 1440) {
      await page.getByRole('button', { name: 'Действия с узлом' }).click();
      await page.getByRole('menuitem', { name: 'Предложить подузлы · AI' }).click();
    } else
      await page
        .getByRole('toolbar', { name: 'Действия с узлом' })
        .getByRole('button', { name: 'AI' })
        .click();
    const dialog = page.getByRole('dialog', { name: 'Предложить подузлы' });
    await expect(dialog.getByRole('checkbox')).toHaveCount(3);
    await expect(dialog).toContainText('меньше цента');
    expect(asked[0]).toMatchObject({
      path: ['information', 'adjective + information'],
      existing: ['useful ~', 'detailed ~', 'accurate ~', 'up-to-date ~', 'background ~'],
    });
    await dialog.getByText('reliable ~').click();
    await dialog.getByRole('button', { name: 'Добавить 2' }).click();
    await expect(node(page, 'valuable ~')).toBeAttached();
    await expect(node(page, 'reliable ~')).toHaveCount(0);
    await expect
      .poll(() => server.pushes.at(-1)?.text ?? '')
      .toContain('    - background ~\n    - valuable ~\n    - first-hand ~');
    // Бюджет кончился — человек видит причину словами, карта не меняется.
    budget = true;
    await tap(page, 'adjective + information');
    if (width === 1440) {
      await page.getByRole('button', { name: 'Действия с узлом' }).click();
      await page.getByRole('menuitem', { name: 'Предложить подузлы · AI' }).click();
    } else
      await page
        .getByRole('toolbar', { name: 'Действия с узлом' })
        .getByRole('button', { name: 'AI' })
        .click();
    await expect(dialog).toContainText('Дневной лимит AI исчерпан');
    await expect(dialog.getByRole('button', { name: /Добавить/ })).toBeDisabled();
    await noScroll(page);
  });
}
