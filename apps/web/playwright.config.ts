import { defineConfig, devices } from '@playwright/test';

// Свой порт — если параллельно идут браузерные тесты из другой копии репозитория.
const port = Number(process.env.E2E_PORT ?? 4173);
const boardTouch = /@board-touch/;

// Браузерные тесты: Firefox и Chromium обязательно (D-134).
// Сервер Rust здесь не нужен: ответы /api перехватываются в самих тестах.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: /frames\.spec/,
      grepInvert: boardTouch,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /frames\.spec/,
      grepInvert: boardTouch,
    },
    {
      name: 'firefox-mobile',
      use: { ...devices['Desktop Firefox'], viewport: { width: 360, height: 780 } },
      testIgnore: /frames\.spec/,
      grepInvert: boardTouch,
    },
    {
      name: 'chromium-touch',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 360, height: 780 },
        hasTouch: true,
        reducedMotion: 'reduce',
      },
      testMatch: /planner\.spec\.ts/,
      grep: boardTouch,
    },
    // замер кадров — после всех остальных и в одиночку (DS-002)
    {
      name: 'frames',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /frames\.spec/,
      dependencies: ['firefox', 'chromium', 'firefox-mobile', 'chromium-touch'],
    },
  ],
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // настоящего сервера нет нарочно (порт 9 закрыт): запущенный рядом `just dev` не
    // подменит ответы, а без ответа /api/auth/me разделы открываются как без сети (D-229)
    env: { QUBITE_API: 'http://127.0.0.1:9' },
  },
});
