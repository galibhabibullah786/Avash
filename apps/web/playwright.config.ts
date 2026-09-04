import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'corepack pnpm build && corepack pnpm preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      VITE_PUBLIC_API_BASE_URL: process.env.VITE_PUBLIC_API_BASE_URL ?? 'http://localhost:8787',
      VITE_PUBLIC_SUPABASE_URL:
        process.env.VITE_PUBLIC_SUPABASE_URL ?? 'https://playwright.supabase.test',
      VITE_PUBLIC_SUPABASE_ANON_KEY:
        process.env.VITE_PUBLIC_SUPABASE_ANON_KEY ?? 'playwright-test-anon-key',
      VITE_PUBLIC_TURNSTILE_SITE_KEY:
        process.env.VITE_PUBLIC_TURNSTILE_SITE_KEY ?? 'playwright-test-site-key',
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
