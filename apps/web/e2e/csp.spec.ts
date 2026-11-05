import { expect, test } from '@playwright/test';
import { mockAi } from './ai-mock';
import { mockAuth, OWNER } from './auth-mock';
import { mockConsole } from './console-mock';
import { mockDocs } from './docs-mock';
import { mockSync } from './sync-mock';

/* SEC-002: главные экраны открываются под настоящей CSP из deploy/pi/qubite.caddy
   (pnpm e2e:csp) — ни одного нарушения политики. Под обычным `pnpm e2e` не идёт. */

const screens = [
  '/',
  '/home',
  '/planner',
  '/calendar',
  '/docs',
  '/agent?tab=english&view=talk',
  '/console/platform',
  '/auth',
];

for (const path of screens) {
  test(`CSP: ${path} без нарушений`, async ({ page }) => {
    test.skip(!process.env.QUBITE_CSP, 'нужен playwright.csp.config.ts');
    const problems: string[] = [];
    page.on('console', (message) => {
      if (/content security policy|refused to/i.test(message.text())) {
        problems.push(message.text());
      }
    });
    page.on('pageerror', (error) => problems.push(error.message));
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) =>
        console.error(`Content Security Policy: ${event.violatedDirective} ${event.blockedURI}`),
      );
    });
    const auth = await mockAuth(page, { me: path === '/auth' || path === '/' ? null : OWNER });
    const consoleMock = await mockConsole(page, auth);
    await mockAi(page, auth, consoleMock);
    await mockDocs(page);
    await mockSync(page);
    const response = await page.goto(path);
    expect(response?.headers()['content-security-policy']).toContain("default-src 'self'");
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    expect(problems).toEqual([]);
  });
}

test('CSP: проверка ловит нарушения (встроенный скрипт запрещён)', async ({ page }) => {
  test.skip(!process.env.QUBITE_CSP, 'нужен playwright.csp.config.ts');
  const violations: string[] = [];
  await page.exposeFunction('report', (text: string) => violations.push(text));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { report(text: string): void }).report(event.violatedDirective);
    });
  });
  await mockAuth(page, { me: null });
  await page.goto('/auth');
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__pwned = 1';
    document.body.append(script);
  });
  await expect.poll(() => violations).toContain('script-src-elem');
});
