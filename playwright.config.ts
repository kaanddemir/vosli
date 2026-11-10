import { defineConfig, devices } from '@playwright/test';

// Firefox runs in the manual full browser workflow. Locally it is opt-in because the Playwright build could not
// start on the development machine ("Could not find profile folder").
const includeFirefox = Boolean(process.env.CI || process.env.E2E_FIREFOX);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:4173/', trace: 'retain-on-failure' },
  webServer: [
    // The production build, for the app shell and offline tests.
    { command: 'npm run build && npx vite preview --port 4173 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:4173/', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    // The dev server serves the data-layer harness, which is never part of the build.
    { command: 'npx vite --port 4174 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:4174/e2e/harness.html', reuseExistingServer: !process.env.CI, timeout: 60_000 },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, testMatch: /(shell|vocabulary|pdf|validation|practice|review|article-colors|dictionary-view|cards|pronunciation|listening|test)\.spec\.ts/ },
    { name: 'mobile-webkit', use: { ...devices['iPhone 15'] }, testMatch: /(shell|vocabulary|pdf|validation|practice|review|article-colors|dictionary-view|cards|pronunciation|listening|test)\.spec\.ts/ },
    ...(includeFirefox ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }] : []),
  ],
});
