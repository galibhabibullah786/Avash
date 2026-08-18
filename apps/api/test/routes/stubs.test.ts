import { describe, test, expect } from 'vitest';
import { Hono } from 'hono';
import type { RateLimitRedisLike } from '@avash/security';
import { createAlerts } from '../../src/routes/alerts';
import { createAnnouncements } from '../../src/routes/announcements';
import { createAuditLog } from '../../src/routes/audit-log';
import { requestId } from '../../src/middleware/request-id';
import type { AppEnv, Bindings } from '../../src/types';
import { signTestJwt } from '../helpers/fakeJwt';

// `weather`, `risk-map`/`risk`, `symptom-check`, `reports`, and
// `resources` were unmounted, empty-body stubs at this point in the
// branch history; they are now mounted, contract-shaped stubs (parse the
// frozen schema, then 501) exercised in
// apps/api/test/routes/{weather,risk-map,symptom-check,reports,resources}.test.ts.
//
// `alerts`, `announcements`, and `audit-log` have real handlers now —
// apps/api/test/routes/{alerts,announcements,audit-log}.test.ts cover
// their success/failure paths in full. What remains here is the
// auth-boundary shape (401/403 before any handler body runs), still worth
// asserting at this coarse, cross-route level.

function fakeRedis(): RateLimitRedisLike {
  const sets = new Map<string, Map<string, number>>();
  return {
    async zadd(key, entry) {
      const set = sets.get(key) ?? new Map<string, number>();
      set.set(entry.member, entry.score);
      sets.set(key, set);
      return 1;
    },
    async zremrangebyscore() {
      return 0;
    },
    async zcard(key) {
      return sets.get(key)?.size ?? 0;
    },
    async expire() {
      return 1;
    },
  };
}

function fakeBindings(): Bindings {
  return {
    SUPABASE_URL: 'https://project.supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    SUPABASE_JWT_SECRET: 'test-jwt-secret-do-not-use-in-production',
    GEMINI_API_KEY: '',
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: '',
    TURNSTILE_SECRET_KEY: '',
    ENVIRONMENT: 'test',
    CORS_ALLOWED_ORIGINS: 'https://avash.pages.dev',
    CORS_PREVIEW_ORIGIN_SUFFIX: 'avash.pages.dev',
    CLOUDINARY_CLOUD_NAME: 'test-cloud',
    CLOUDINARY_API_KEY: 'test-cloudinary-key',
    CLOUDINARY_API_SECRET: 'test-cloudinary-secret',
  };
}

function buildApp(route: Hono<AppEnv>) {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.route('/', route);
  return app;
}

describe('mounted route stubs (contract-shaped placeholders where handlers remain 501; auth-boundary checks where they do not)', () => {
  test('alerts: POST /subscribe with no token → 401, not 501', async () => {
    const app = buildApp(createAlerts({ redisFactory: fakeRedis }));
    const res = await app.request('/subscribe', { method: 'POST' }, fakeBindings());
    expect(res.status).toBe(401);
  });

  test('alerts: POST /push-subscription with no token → 401, not 501', async () => {
    const app = buildApp(createAlerts({ redisFactory: fakeRedis }));
    const res = await app.request('/push-subscription', { method: 'POST' }, fakeBindings());
    expect(res.status).toBe(401);
  });

  test('announcements: POST / with no token → 401, not 501', async () => {
    const app = buildApp(createAnnouncements({ redisFactory: fakeRedis }));
    const res = await app.request('/', { method: 'POST' }, fakeBindings());
    expect(res.status).toBe(401);
  });

  test('announcements: POST / with a citizen token → 403, not 501', async () => {
    const app = buildApp(createAnnouncements({ redisFactory: fakeRedis }));
    const token = await signTestJwt({ role: 'citizen' });
    const res = await app.request(
      '/',
      { method: 'POST', headers: { authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(403);
  });

  test('announcements: GET / with no token → 401, not 501', async () => {
    const app = buildApp(createAnnouncements({ redisFactory: fakeRedis }));
    const res = await app.request('/', { method: 'GET' }, fakeBindings());
    expect(res.status).toBe(401);
  });

  test('announcements: DELETE /:id with no token → 401, not 501', async () => {
    const app = buildApp(createAnnouncements({ redisFactory: fakeRedis }));
    const res = await app.request('/abc', { method: 'DELETE' }, fakeBindings());
    expect(res.status).toBe(401);
  });

  test('audit-log: GET / with no token → 401, not 501', async () => {
    const app = buildApp(createAuditLog({ redisFactory: fakeRedis }));
    const res = await app.request('/', { method: 'GET' }, fakeBindings());
    expect(res.status).toBe(401);
  });

  test('audit-log: GET / with a moderator token → 403, not 501', async () => {
    const app = buildApp(createAuditLog({ redisFactory: fakeRedis }));
    const token = await signTestJwt({ role: 'moderator' });
    const res = await app.request(
      '/',
      { method: 'GET', headers: { authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(403);
  });
});
