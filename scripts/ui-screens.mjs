// Скриншоты всех экранов на ПК (1440×900) и телефоне (360×780) — чек-лист UI (DS-008).
// Нужен запущенный `just dev` (сайт :5173 + сервер) и owner. Запуск из корня:
//   QUBITE_E2E_EMAIL=… QUBITE_E2E_PASSWORD=… node scripts/ui-screens.mjs docs/design/screens/<папка>
// Тема — тёмная; `QUBITE_THEME=light` — светлая.
/* global process, URL, console, localStorage */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const out = process.argv[2] ?? 'screens';
const base = process.env.QUBITE_URL ?? 'http://127.0.0.1:5173';
const email = process.env.QUBITE_E2E_EMAIL;
const password = process.env.QUBITE_E2E_PASSWORD;
const theme = process.env.QUBITE_THEME ?? 'dark';
// только некоторые экраны: QUBITE_ONLY=home,bell-open
const only = process.env.QUBITE_ONLY?.split(',');
mkdirSync(out, { recursive: true });

const click = (name) => async (p) => {
  await p.getByRole('radio', { name, exact: true }).first().click();
};

/** [файл, адрес, действие перед снимком] */
const SHOTS = [
  ['home', '/home'],
  ['today', '/today'],
  ['inbox', '/inbox'],
  ['planner-week', '/planner'],
  ['planner-board', '/planner', click('Доска')],
  ['agent-feed', '/agent'],
  ['agent-records', '/agent', click('Записи')],
  ['agent-talk', '/agent', click('Разговор')],
  ['agent-pace', '/agent', click('Когда писать')],
  [
    'agent-skills',
    '/agent',
    async (p) => {
      await click('Записи')(p);
      await p.getByText('Навыки — все').first().click();
    },
  ],
  ['docs', '/docs'],
  ['settings', '/settings'],
  ['account', '/account'],
  ['console', '/console'],
  ['console-work', '/console/work'],
  ['lab-editor', '/lab/editor'],
  ['design', '/design'],
  [
    'bell-open',
    '/home',
    (p) =>
      p
        .getByRole('button', { name: /^Уведомления/ })
        .first()
        .click(),
  ],
  [
    'home-weather-settings',
    '/home',
    (p) =>
      p
        .getByRole('button', { name: /Настроить: Город погоды/ })
        .first()
        .click(),
  ],
];

// в облачном контейнере Chromium другой версии: QUBITE_CHROMIUM=/opt/pw-browsers/chromium
const browser = await chromium.launch({ executablePath: process.env.QUBITE_CHROMIUM || undefined });
for (const [dev, viewport] of [
  ['pc', { width: 1440, height: 900 }],
  ['phone', { width: 360, height: 780 }],
]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: theme });
  await ctx.addInitScript((t) => {
    try {
      const k = 'qubite.look.v1';
      const v = JSON.parse(localStorage.getItem(k) ?? '{}');
      localStorage.setItem(k, JSON.stringify({ ...v, theme: t }));
    } catch {
      // нет хранилища — тема по умолчанию
    }
  }, theme);
  const page = await ctx.newPage();
  // гость: вход и регистрация
  for (const [name, url] of [
    ['login', '/auth'],
    ['register', '/register'],
  ].filter(([n]) => !only || only.includes(n))) {
    await page.goto(base + url);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${name}-${dev}.png`, fullPage: true });
  }
  if (email && password) {
    await page.goto(base + '/auth');
    await page.getByLabel('Почта').fill(email);
    await page.getByLabel('Пароль', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.waitForURL(/\/home/, { timeout: 15000 }).catch(() => {});
  }
  for (const [name, url, act] of SHOTS.filter(([n]) => !only || only.includes(n))) {
    try {
      await page.goto(base + url);
      await page.waitForTimeout(1200);
      if (act) {
        await act(page);
        await page.waitForTimeout(900);
      }
      await page.screenshot({
        path: `${out}/${name}-${dev}.png`,
        fullPage: !name.startsWith('bell') && !name.includes('settings'),
      });
    } catch (e) {
      console.error(`${name}-${dev}: ${String(e).split('\n')[0]}`);
    }
  }
  await ctx.close();
}
await browser.close();
