import { defineConfig, devices } from '@playwright/test';

// Свой порт — если параллельно идут браузерные тесты из другой копии репозитория.
const port = Number(process.env.E2E_PORT ?? 4173);

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
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: /frames\.spec/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /frames\.spec/ },
    {
      name: 'firefox-mobile',
      use: { ...devices['Desktop Firefox'], viewport: { width: 360, height: 780 } },
      testIgnore: /frames\.spec/,
    },
    // замер кадров — после всех остальных и в одиночку (DS-002)
    {
      name: 'frames',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /frames\.spec/,
      dependencies: ['firefox', 'chromium', 'firefox-mobile'],
    },
  ],
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
