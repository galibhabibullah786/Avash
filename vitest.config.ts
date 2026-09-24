import { defineConfig } from 'vitest/config';

/**
 * Three project shapes, one runner (docs/standards/testing.md). Only
 * *.test.ts is included anywhere here — *.spec.ts belongs to Playwright
 * and must never be picked up by a Vitest project.
 */
export default defineConfig({
  test: {
    coverage: {
      // istanbul, not v8: the "api" project runs inside workerd via
      // @cloudflare/vitest-pool-workers, and v8 coverage depends on
      // Node's inspector protocol, which workerd does not implement
      // (https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#module-resolution).
      // Istanbul instruments source at transform time instead, so it
      // works the same way regardless of which runtime a project runs in.
      provider: 'istanbul',
      reporter: ['text', 'html', 'json-summary'],
      include: ['packages/**/*.ts', 'apps/api/src/**/*.ts', 'apps/notify/src/**/*.ts', 'apps/notify/api/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.d.ts',
        'packages/*/scripts/**',
        'packages/db/types.ts',
        'packages/*/playwright.config.ts',
        'apps/api/vitest.config.ts',
      ],
      // docs/standards/testing.md § Coverage — per-path thresholds, a CI
      // merge gate, not advisory. Most specific glob wins.
      thresholds: {
        'packages/security/**': { statements: 90, branches: 85 },
        'packages/logger/**': { statements: 90, branches: 85 },
        'apps/api/src/routes/**': { statements: 85, branches: 80 },
        'apps/api/src/middleware/**': { statements: 85, branches: 80 },
        'packages/**': { statements: 70, branches: 60 },
        'apps/api/src/**': { statements: 70, branches: 60 },
      },
    },
    projects: [
      {
        test: {
          name: 'packages',
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts'],
          exclude: ['packages/*/node_modules/**'],
        },
      },
      'apps/api/vitest.config.ts',
      {
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/src/**/*.test.ts?(x)'],
        },
      },
      {
        test: {
          name: 'notify',
          environment: 'node',
          include: ['apps/notify/src/**/*.test.ts', 'apps/notify/api/**/*.test.ts'],
        },
      },
    ],
  },
});
