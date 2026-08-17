import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

/**
 * Runs inside workerd via Miniflare, not Node — the app under test is the
 * app that ships, with the same globals and the same Request/Response
 * (docs/standards/testing.md). CORS/env bindings mirror wrangler.toml's
 * [vars] shape but with test-safe values; no test reads a real credential.
 */
export default defineWorkersConfig({
  test: {
    name: 'api',
    include: ['test/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            ENVIRONMENT: 'test',
            CORS_ALLOWED_ORIGINS: 'https://avash.pages.dev',
            CORS_PREVIEW_ORIGIN_SUFFIX: 'avash.pages.dev',
            SUPABASE_URL: '',
            SUPABASE_SERVICE_ROLE_KEY: '',
            // Test-only values — never a real credential. jwtVerify.test.ts
            // and auth.test.ts sign fixtures against this same secret.
            SUPABASE_JWT_SECRET: 'test-jwt-secret-do-not-use-in-production',
            GEMINI_API_KEY: 'test-gemini-key',
            UPSTASH_REDIS_REST_URL: 'https://example-upstash-test.invalid',
            UPSTASH_REDIS_REST_TOKEN: 'test-upstash-token',
            TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
            // Test-only values — never a real credential.
            CLOUDINARY_CLOUD_NAME: 'test-cloud',
            CLOUDINARY_API_KEY: 'test-cloudinary-key',
            CLOUDINARY_API_SECRET: 'test-cloudinary-secret',
          },
        },
      },
    },
  },
});
