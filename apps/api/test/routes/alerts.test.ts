import { describe, test, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { RateLimitRedisLike } from '@avash/security';
import { createAlerts } from '../../src/routes/alerts';
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
    CLOUDINARY_CLOUD_NAME: '',
    CLOUDINARY_API_KEY: '',
    CLOUDINARY_API_SECRET: '',
    ...overrides,
  };
}

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.route('/', createAlerts({ redisFactory: fakeRedis }));
  return app;
}

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('POST /api/alerts/subscribe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('no token → 401', async () => {
    const res = await buildApp().request(
      '/subscribe',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lat: 23.7, lng: 90.4 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(401);
  });

  test('radiusM below the 100m floor → 400', async () => {
    const token = await signTestJwt({ sub: USER_ID });
    const res = await buildApp().request(
      '/subscribe',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lat: 23.7, lng: 90.4, radiusM: 50 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(400);
  });

  test('radiusM above the 20000m ceiling → 400', async () => {
    const token = await signTestJwt({ sub: USER_ID });
    const res = await buildApp().request(
      '/subscribe',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lat: 23.7, lng: 90.4, radiusM: 99999 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(400);
  });

  test('a valid body → 200', async () => {
    const token = await signTestJwt({ sub: USER_ID });
    const fake = createFakeSupabase([
      { path: '/rest/v1/alert_subscriptions', body: [{ id: 'sub-1' }] },
      { path: '/rest/v1/audit_log', body: [{ id: 1 }] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      '/subscribe',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lat: 23.7, lng: 90.4, radiusM: 2000 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(200);
  });

  test('subscribing twice at the same point upserts on (user_id, geom) — one call, not a plain insert twice', async () => {
    const token = await signTestJwt({ sub: USER_ID });
    const fake = createFakeSupabase([
      { path: '/rest/v1/alert_subscriptions', body: [{ id: 'sub-1' }] },
      { path: '/rest/v1/audit_log', body: [{ id: 1 }] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const makeRequest = () =>
      buildApp().request(
        '/subscribe',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ lat: 23.7, lng: 90.4, radiusM: 2000 }),
        },
        fakeBindings()
      );

    const first = await makeRequest();
    const second = await makeRequest();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const subscriptionCalls = fake.calls.filter((u) => u.pathname === '/rest/v1/alert_subscriptions');
    expect(subscriptionCalls).toHaveLength(2);
    // Both calls carry the same on_conflict target — proof this is an
    // upsert against (user_id, geom), never a bare insert that would
    // duplicate the row on a second call.
    for (const call of subscriptionCalls) {
      expect(call.searchParams.get('on_conflict')).toBe('user_id,geom');
    }
  });

  test('a successful subscribe writes an audit_log row with action alert.subscribe', async () => {
    const token = await signTestJwt({ sub: USER_ID });
    const bodies: unknown[] = [];
    const fake = createFakeSupabase([
      { path: '/rest/v1/alert_subscriptions', body: [{ id: 'sub-1' }] },
      { path: '/rest/v1/audit_log', body: [{ id: 1 }] },
    ]);
    const recordingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/rest/v1/audit_log' && typeof init?.body === 'string') {
        bodies.push(JSON.parse(init.body));
      }
      return fake.fetch(input, init);
    }) as typeof fetch;
    vi.stubGlobal('fetch', recordingFetch);

    const res = await buildApp().request(
      '/subscribe',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lat: 23.7, lng: 90.4, radiusM: 2000 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(200);
    expect(bodies).toHaveLength(1);
    const entry = bodies[0] as { action?: string; entity_type?: string };
    expect(entry.action).toBe('alert.subscribe');
    expect(entry.entity_type).toBe('alert_subscription');
  });

  test('an unexpected failure building the Supabase client → 503', async () => {
    const token = await signTestJwt({ sub: USER_ID });
    const res = await buildApp().request(
      '/subscribe',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lat: 23.7, lng: 90.4 }),
      },
      fakeBindings({ SUPABASE_URL: INVALID_SUPABASE_URL })
    );
    expect(res.status).toBe(503);
  });
});

describe('POST /api/alerts/push-subscription', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('no token → 401', async () => {
    const res = await buildApp().request(
      '/push-subscription',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: 'https://push.example.com/x', p256dh: 'key', authKey: 'auth' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(401);
  });

  test('a body missing p256dh → 400', async () => {
    const token = await signTestJwt({ sub: USER_ID });
    const res = await buildApp().request(
      '/push-subscription',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint: 'https://push.example.com/x', authKey: 'auth' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(400);
  });

  test('a valid body → 200', async () => {
    const token = await signTestJwt({ sub: USER_ID });
    const fake = createFakeSupabase([
      { path: '/rest/v1/push_subscriptions', body: [{ id: 'push-1' }] },
      { path: '/rest/v1/audit_log', body: [{ id: 1 }] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      '/push-subscription',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint: 'https://push.example.com/x', p256dh: 'key', authKey: 'auth' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(200);
  });

  test('registering the same endpoint twice upserts — 200 both times, not a unique-violation 500', async () => {
    const token = await signTestJwt({ sub: USER_ID });
    const fake = createFakeSupabase([
      { path: '/rest/v1/push_subscriptions', body: [{ id: 'push-1' }] },
      { path: '/rest/v1/audit_log', body: [{ id: 1 }] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const makeRequest = () =>
      buildApp().request(
        '/push-subscription',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ endpoint: 'https://push.example.com/x', p256dh: 'key', authKey: 'auth' }),
        },
        fakeBindings()
      );

    const first = await makeRequest();
    const second = await makeRequest();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const subscriptionCalls = fake.calls.filter((u) => u.pathname === '/rest/v1/push_subscriptions');
    for (const call of subscriptionCalls) {
      expect(call.searchParams.get('on_conflict')).toBe('endpoint');
    }
  });

  test('a successful registration writes an audit_log row with action push.subscribe', async () => {
    const token = await signTestJwt({ sub: USER_ID });
    const bodies: unknown[] = [];
    const fake = createFakeSupabase([
      { path: '/rest/v1/push_subscriptions', body: [{ id: 'push-1' }] },
      { path: '/rest/v1/audit_log', body: [{ id: 1 }] },
    ]);
    const recordingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/rest/v1/audit_log' && typeof init?.body === 'string') {
        bodies.push(JSON.parse(init.body));
      }
      return fake.fetch(input, init);
    }) as typeof fetch;
    vi.stubGlobal('fetch', recordingFetch);

    const res = await buildApp().request(
      '/push-subscription',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint: 'https://push.example.com/x', p256dh: 'key', authKey: 'auth' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(200);
    expect(bodies).toHaveLength(1);
    const entry = bodies[0] as { action?: string; entity_type?: string };
    expect(entry.action).toBe('push.subscribe');
    expect(entry.entity_type).toBe('push_subscription');
  });
});
