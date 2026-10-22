import { expect, test, type Page } from '@playwright/test';
import { mockSync, type SyncMock } from './sync-mock';

/*
 * Агент раскладывает Входящие (CMD-004): сервер и модель подделаны, браузер настоящий. Элик думает
 * над мыслью, «разложил → Русский · дело на чт» с «Откатить», вопрос «посмотри сам» кнопками.
 */

interface Filed {
  item_id: string;
  thought: string;
  label: string;
  action_id: string;
  batch_id: string;
  at: string;
  reason: string | null;
}

async function mockAgent(page: Page, server: SyncMock) {
  const state = { thinking: [] as string[], filed: [] as Filed[] };
  const asked: { item: string; answer: string }[] = [];
  const why: string[] = [];
  let reverted = 0;
  await page.route('**/api/v1/agent/triage', (route) => route.fulfill({ json: state }));
  await page.route('**/api/v1/agent/triage/*/answer', async (route) => {
    const item = route.request().url().split('/').at(-2)!;
    asked.push({ item, answer: (route.request().postDataJSON() as { answer: string }).answer });
    state.thinking = [item];
    await route.fulfill({ status: 202, body: '' });
  });
  await page.route('**/api/v1/agent/batches/*/revert', async (route) => {
    reverted += 1;
    const filed = state.filed.shift();
    if (filed) server.patch(filed.item_id, { status: 'new' });
    await route.fulfill({
      json: { status: 'reverted', actions: [{ id: 'undo-1', batch_id: 'undo-batch-1' }] },
    });
  });
  await page.route('**/api/v1/agent/batches/*/why', async (route) => {
    why.push((route.request().postDataJSON() as { answer: string }).answer);
    await route.fulfill({ json: { answer: 'ошибся', kind: 'mistake' } });
  });
  return {
    state,
    asked,
    why,
    get reverted() {
      return reverted;
    },
  };
}

test('Элик думает над мыслью, раскладывает сам, «Откатить» возвращает мысль', async ({ page }) => {
  const server = await mockSync(page);
  const agent = await mockAgent(page, server);
  const id = server.addElsewhere('упр. 145 по русскому', 'web');
  agent.state.thinking = [id];
  await page.goto('/inbox');

  const row = page.locator('.items .item').filter({ hasText: 'упр. 145 по русскому' }).first();
  await expect(row).toContainText('Элик: думаю, куда положить…');
  await expect(row.getByRole('img', { name: 'Элик думает' })).toBeVisible();

  // Агент разложил: мысль ушла из Входящих, ниже — «разложил → …» и «Откатить».
  server.patch(id, { status: 'archived' });
  agent.state.thinking = [];
  agent.state.filed = [
    {
      item_id: id,
      thought: 'упр. 145 по русскому',
      label: 'Русский · дело на чт',
      action_id: 'a1',
      batch_id: 'b1',
      at: new Date().toISOString(),
      reason: 'ДЗ по русскому',
    },
  ];
  server.ping();
  const filed = page.locator('.filed-row').filter({ hasText: 'упр. 145 по русскому' });
  await expect(filed).toBeVisible({ timeout: 10_000 });
  await expect(filed).toContainText('разложил → Русский · дело на чт');
  await expect(filed.getByRole('img', { name: 'Элик радуется' })).toBeVisible();

  await filed.getByRole('button', { name: 'Откатить' }).click();
  expect(agent.reverted).toBe(1);
  await expect(filed).toContainText('Почему откатил?');
  await expect(filed.getByRole('img', { name: 'Элик ошибся' })).toBeVisible();
  await filed.getByRole('button', { name: 'Ошибся' }).click();
  await expect.poll(() => agent.why).toEqual(['ошибся']);
  await expect(filed).toHaveCount(0);
  // мысль снова во Входящих
  await expect(
    page.locator('.items .item').filter({ hasText: 'упр. 145 по русскому' }),
  ).toBeVisible();
});

test('агент не уверен — спрашивает, ответ кнопкой уходит агенту', async ({ page }) => {
  const server = await mockSync(page);
  const agent = await mockAgent(page, server);
  const id = server.addElsewhere('олимпиада в субботу', 'web', {
    needs_review: true,
    review_reason: 'Это к «Информатике» или к «Математике»?',
    triage: {
      status: 'suggested',
      details: { by: 'ai', options: ['Информатика', 'Математика'] },
    },
  });
  await page.goto('/inbox');
  const row = page.locator('.items .item').filter({ hasText: 'олимпиада в субботу' });
  await expect(row).toContainText('посмотри сам: Это к «Информатике» или к «Математике»?');
  await expect(row.getByRole('img', { name: 'Элик спрашивает' })).toBeVisible();
  await row.getByRole('button', { name: 'Информатика' }).click();
  await expect.poll(() => agent.asked).toEqual([{ item: id, answer: 'Информатика' }]);
  await expect(row.getByRole('img', { name: 'Элик думает' })).toBeVisible();
});
