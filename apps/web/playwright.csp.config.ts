import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// SEC-002: те же экраны, но из собранного сайта (vite build) с настоящей CSP из
// deploy/pi/qubite.caddy. Запуск: pnpm e2e:csp
const caddy = readFileSync(new URL('../../deploy/pi/qubite.caddy', import.meta.url), 'utf8');
const csp = /Content-Security-Policy "([^"]+)"/.exec(caddy)?.[1];
if (!csp) throw new Error('В qubite.caddy нет Content-Security-Policy');
process.env.QUBITE_CSP = csp; // для тестов; webServer получает его ниже
const port = Number(process.env.E2E_CSP_PORT ?? 4174);

export default defineConfig({
  testDir: './e2e',
  testMatch: /csp\.spec/,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath: process.env.CHROMIUM_PATH },
      },
    },
  ],
  webServer: {
    command: `pnpm exec vite build && pnpm exec vite preview --port ${port} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { QUBITE_API: 'http://127.0.0.1:9', QUBITE_CSP: csp },
  },
});
