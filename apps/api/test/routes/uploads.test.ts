import { describe, test, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { uploadSignatureResponseSchema } from '@avash/types';
import type { RateLimitRedisLike } from '@avash/security';
import { createUploads } from '../../src/routes/uploads';
import { requestId } from '../../src/middleware/request-id';
import { createFakeSupabase, INVALID_SUPABASE_URL } from '../helpers/fakeSupabase';
import type { AppEnv, Bindings } from '../../src/types';
import { signTestJwt } from '../helpers/fakeJwt';

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

function fakeBindings(overrides: Partial<Bindings> = {}): Bindings {
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
    ...overrides,
  };
}

function buildApp(redisFactory: () => RateLimitRedisLike = fakeRedis) {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.route('/', createUploads({ redisFactory }));
  return app;
}

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('POST /api/uploads/signature', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('no token → 401', async () => {
    const res = await buildApp().request(
      '/',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purpose: 'avatar' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(401);
  });

  test('the 11th call in a window → 429', async () => {
    const token = await signTestJwt({ sub: USER_ID });
    const fake = createFakeSupabase([{ path: '/rest/v1/audit_log', body: [{ id: 1 }] }]);
    vi.stubGlobal('fetch', fake.fetch);

    const sharedRedis = fakeRedis();
    const app = buildApp(() => sharedRedis);
    const makeRequest = () =>
      app.request(
        '/',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ purpose: 'avatar' }),
        },
        fakeBindings()
      );

    const results = [];
    for (let i = 0; i < 11; i += 1) {
      results.push(await makeRequest());
    }
    expect(results[9]?.status).toBe(200);
    expect(results[10]?.status).toBe(429);
  });

  test('an unknown purpose → 400', async () => {
    const token = await signTestJwt({ sub: USER_ID });
    const res = await buildApp().request(
      '/',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ purpose: 'anything-else' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(400);
  });

  test('a valid request → 200, schema-valid body, folder is server-derived', async () => {
    const token = await signTestJwt({ sub: USER_ID });
    const fake = createFakeSupabase([{ path: '/rest/v1/audit_log', body: [{ id: 1 }] }]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      '/',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        // A client-supplied "folder" must be ignored entirely (decision H).
        body: JSON.stringify({ purpose: 'avatar', folder: 'attacker/anywhere' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(200);

    const body = uploadSignatureResponseSchema.parse(await res.json());
    expect(body.folder).toBe(`avash/avatars/${USER_ID}`);
    expect(body.folder).not.toBe('attacker/anywhere');
    expect(body.cloudName).toBe('test-cloud');
    expect(body.apiKey).toBe('test-cloudinary-key');
  });

  test('a report-photo purpose derives the shared reports folder', async () => {
    const token = await signTestJwt({ sub: USER_ID });
    const fake = createFakeSupabase([{ path: '/rest/v1/audit_log', body: [{ id: 1 }] }]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      '/',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ purpose: 'report-photo' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(200);
    const body = uploadSignatureResponseSchema.parse(await res.json());
    expect(body.folder).toBe('avash/reports');
  });

  test('an audit_log write failure (sink returns an error) does not fail the mint — still 200', async () => {
    const token = await signTestJwt({ sub: USER_ID });
    const fake = createFakeSupabase([
      { path: '/rest/v1/audit_log', body: { message: 'permission denied' }, status: 403 },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      '/',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ purpose: 'avatar' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(200);
  });

  test('the audit sink itself throwing (e.g. building the Supabase client fails) still yields a 200', async () => {
    const token = await signTestJwt({ sub: USER_ID });

    const res = await buildApp().request(
      '/',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ purpose: 'avatar' }),
      },
      fakeBindings({ SUPABASE_URL: INVALID_SUPABASE_URL })
    );
    expect(res.status).toBe(200);
    const body = uploadSignatureResponseSchema.parse(await res.json());
    expect(body.folder).toBe(`avash/avatars/${USER_ID}`);
  });
});
