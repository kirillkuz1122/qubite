import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 45000,
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4317",
    headless: true,
    trace: "retain-on-failure",
    launchOptions: process.env.QUBITE_LAB_CHROMIUM
      ? { executablePath: process.env.QUBITE_LAB_CHROMIUM }
      : {},
  },
  webServer: {
    command: "npm run preview",
    url: "http://127.0.0.1:4317",
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
  },
});
