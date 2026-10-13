import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 30000,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    headless: true,
    trace: "retain-on-failure",
    launchOptions: process.env.QUBITE_WEB_CHROMIUM
      ? { executablePath: process.env.QUBITE_WEB_CHROMIUM }
      : {},
  },
  projects: [
    {
      name: "desktop",
      testMatch: "shell.spec.ts",
      use: {
        baseURL: "http://127.0.0.1:4321",
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "phone",
      testMatch: "shell.spec.ts",
      use: {
        baseURL: "http://127.0.0.1:4321",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "live",
      testMatch: "runtime.spec.ts",
      use: {
        baseURL: "http://127.0.0.1:4322",
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
  webServer: [
    {
      command:
        "npx vite preview --host 127.0.0.1 --port 4321 --strictPort --outDir dist-demo",
      url: "http://127.0.0.1:4321",
      reuseExistingServer: false,
    },
    {
      command:
        "npx vite preview --host 127.0.0.1 --port 4322 --strictPort --outDir dist",
      url: "http://127.0.0.1:4322",
      reuseExistingServer: false,
    },
  ],
});
