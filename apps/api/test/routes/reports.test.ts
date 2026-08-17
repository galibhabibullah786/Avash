import { describe, test, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { RateLimitRedisLike } from '@avash/security';
import type { GenericErrorBody } from '@avash/logger';
import type { BreedingReportResponse } from '@avash/types';
import { createReports } from '../../src/routes/reports';
import { requestId } from '../../src/middleware/request-id';
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

function buildApp(redisFactory: () => RateLimitRedisLike = fakeRedis) {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.route('/', createReports({ redisFactory }));
  return app;
}

function fakeBindings(overrides: Partial<Bindings> = {}): Bindings {
  return {
    SUPABASE_URL: 'https://project.supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    SUPABASE_JWT_SECRET: 'test-jwt-secret-do-not-use-in-production',
    GEMINI_API_KEY: 'test-gemini-key',
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: '',
    TURNSTILE_SECRET_KEY: 'test-secret',
    ENVIRONMENT: 'test',
    CORS_ALLOWED_ORIGINS: 'https://avash.pages.dev',
    CORS_PREVIEW_ORIGIN_SUFFIX: 'avash.pages.dev',
    CLOUDINARY_CLOUD_NAME: '',
    CLOUDINARY_API_KEY: '',
    CLOUDINARY_API_SECRET: '',
    ...overrides,
  };
}

interface CapturedCall {
  url: URL;
  method: string;
  body?: Record<string, unknown>;
}

interface CombinedFetchOptions {
  turnstileSuccess?: boolean;
  /** `'unreachable'` simulates a thrown network error; omit for a default plausible/low-spam reply. */
  gemini?: { status?: number; data?: unknown } | 'unreachable';
  /** Row(s) the fake PostgREST insert/update returns. `null` on update simulates "no row matched" (404 path). */
  insertResult?: { status?: number; row?: Record<string, unknown> };
  updateResult?: { status?: number; row?: Record<string, unknown> | null };
}

/**
 * A single `fetch` double covering every outbound call this route's
 * handler makes: Turnstile siteverify, Gemini structured generation, and
 * the Supabase PostgREST insert/update. `apps/api/test/helpers/fakeSupabase.ts`
 * only records request URLs, not bodies, and the create-route test cases
 * need to assert on the inserted payload (reporter_id, geom, ai_validation)
 * — hence a small local double rather than reusing/extending that shared
 * helper (out of this route's owned-files scope).
 */
function combinedFetch(options: CombinedFetchOptions = {}) {
  const calls: CapturedCall[] = [];
  let geminiCallCount = 0;

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    const method = init?.method ?? 'GET';

    if (url.hostname === 'challenges.cloudflare.com') {
      return new Response(JSON.stringify({ success: options.turnstileSuccess ?? true }), { status: 200 });
    }

    if (url.hostname === 'generativelanguage.googleapis.com') {
      geminiCallCount += 1;
      if (options.gemini === 'unreachable') {
        throw new Error('network unreachable');
      }
      const gemini = options.gemini ?? { data: { isPlausible: true, category: 'standing-water', spamLikelihood: 0.1 } };
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(gemini.data) }] } }] }),
        { status: gemini.status ?? 200 }
      );
    }

    let body: Record<string, unknown> | undefined;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = undefined;
      }
    }
    calls.push({ url, method, body });

    if (url.pathname === '/rest/v1/breeding_reports' && method === 'POST') {
      const result = options.insertResult ?? { row: { id: '99999999-9999-4999-8999-999999999999', status: 'pending' } };
      if (!result.row) {
        return new Response(JSON.stringify({ message: 'insert failed' }), { status: result.status ?? 500 });
      }
      // `.single()` sets Accept: application/vnd.pgrst.object+json — the client trusts the
      // response body IS the single row, not an array (see PostgrestBuilder.ts).
      return new Response(JSON.stringify(result.row), { status: result.status ?? 201 });
    }

    if (url.pathname === '/rest/v1/breeding_reports' && method === 'PATCH') {
      const result = options.updateResult ?? { row: { id: '11111111-1111-4111-8111-111111111111', status: 'verified', ai_validation: null } };
      if (result.status && result.status >= 400) {
        return new Response(JSON.stringify({ message: 'update failed' }), { status: result.status });
      }
      // `.maybeSingle()` unwraps a 0-or-1-length array client-side.
      return new Response(JSON.stringify(result.row ? [result.row] : []), { status: 200 });
    }

    throw new Error(`combinedFetch: no rule matched ${method} ${url.pathname}`);
  }) as typeof fetch;

  return {
    fetch: fetchFn,
    calls,
    get geminiCallCount() {
      return geminiCallCount;
    },
  };
}

const validId = '11111111-1111-4111-8111-111111111111';

describe('POST /api/reports/breeding-site', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('missing turnstileToken → 403 before the body is even schema-checked', async () => {
    const res = await buildApp().request(
      '/breeding-site',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lat: 23.78, lng: 90.4 }) },
      fakeBindings()
    );
    expect(res.status).toBe(403);
  });

  test('lat out of range → 400 (schema-level, before any DB/LLM call)', async () => {
    const { fetch } = combinedFetch();
    vi.stubGlobal('fetch', fetch);

    const res = await buildApp().request(
      '/breeding-site',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lat: 999, lng: 90.4, turnstileToken: 'good-token' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(400);
  });

  test('rate limit exceeded (perMinute=5) → 429', async () => {
    const redis = fakeRedis();
    const { fetch } = combinedFetch();
    vi.stubGlobal('fetch', fetch);

    const app = buildApp(() => redis);
    const makeRequest = () =>
      app.request(
        '/breeding-site',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.20' },
          body: JSON.stringify({ lat: 23.78, lng: 90.4, turnstileToken: 'good-token' }),
        },
        fakeBindings()
      );

    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await makeRequest());
    }
    expect(results[0]?.status).toBe(201);
    expect(results[5]?.status).toBe(429);
  });

  test('a valid anonymous submission → 201, reporter_id is null, status is pending', async () => {
    const combined = combinedFetch();
    vi.stubGlobal('fetch', combined.fetch);

    const res = await buildApp().request(
      '/breeding-site',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lat: 23.78, lng: 90.4, turnstileToken: 'good-token' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as BreedingReportResponse;
    expect(body).toMatchObject({ status: 'pending', flaggedForReview: false });
    expect(typeof body.id).toBe('string');

    const insertCall = combined.calls.find((c) => c.method === 'POST');
    expect(insertCall?.body?.reporter_id).toBeNull();
    expect(insertCall?.body?.geom).toEqual({ type: 'Point', coordinates: [90.4, 23.78] });
  });

  test('a valid, signed-in submission records reporter_id from the bearer token', async () => {
    const combined = combinedFetch();
    vi.stubGlobal('fetch', combined.fetch);
    const token = await signTestJwt({ sub: '22222222-2222-4222-8222-222222222222' });

    const res = await buildApp().request(
      '/breeding-site',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lat: 23.78, lng: 90.4, turnstileToken: 'good-token' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(201);
    const insertCall = combined.calls.find((c) => c.method === 'POST');
    expect(insertCall?.body?.reporter_id).toBe('22222222-2222-4222-8222-222222222222');
  });

  test('an invalid/expired bearer token is ignored, not a 401 — anonymous submission still succeeds', async () => {
    const combined = combinedFetch();
    vi.stubGlobal('fetch', combined.fetch);

    const res = await buildApp().request(
      '/breeding-site',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer not-a-real-token' },
        body: JSON.stringify({ lat: 23.78, lng: 90.4, turnstileToken: 'good-token' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(201);
    const insertCall = combined.calls.find((c) => c.method === 'POST');
    expect(insertCall?.body?.reporter_id).toBeNull();
  });

  test('a client-supplied extra "status" field in the body is ignored — row is always pending', async () => {
    const combined = combinedFetch();
    vi.stubGlobal('fetch', combined.fetch);

    const res = await buildApp().request(
      '/breeding-site',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lat: 23.78, lng: 90.4, turnstileToken: 'good-token', status: 'verified' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as BreedingReportResponse;
    expect(body.status).toBe('pending');
    const insertCall = combined.calls.find((c) => c.method === 'POST');
    expect(insertCall?.body?.status).toBeUndefined();
  });

  test('high spam likelihood → still stored (201, pending), but flaggedForReview is true', async () => {
    const combined = combinedFetch({ gemini: { data: { isPlausible: true, category: 'other', spamLikelihood: 0.95 } } });
    vi.stubGlobal('fetch', combined.fetch);

    const res = await buildApp().request(
      '/breeding-site',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lat: 23.78, lng: 90.4, description: 'buy cheap watches now', turnstileToken: 'good-token' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as BreedingReportResponse;
    expect(body.status).toBe('pending');
    expect(body.flaggedForReview).toBe(true);

    const insertCall = combined.calls.find((c) => c.method === 'POST');
    expect((insertCall?.body?.ai_validation as { spamLikelihood: number })?.spamLikelihood).toBe(0.95);
  });

  test('spamLikelihood exactly at SPAM_LIKELIHOOD_REJECT_THRESHOLD (0.7) is NOT flagged — the comparison is strictly greater-than', async () => {
    const combined = combinedFetch({ gemini: { data: { isPlausible: true, category: 'other', spamLikelihood: 0.7 } } });
    vi.stubGlobal('fetch', combined.fetch);

    const res = await buildApp().request(
      '/breeding-site',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lat: 23.78, lng: 90.4, description: 'standing water near the drain', turnstileToken: 'good-token' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as BreedingReportResponse;
    expect(body.flaggedForReview).toBe(false);
  });

  test('Gemini unavailable (HTTP failure) → still stored (201, pending), flagged for manual review', async () => {
    const combined = combinedFetch({ gemini: { status: 503, data: {} } });
    vi.stubGlobal('fetch', combined.fetch);

    const res = await buildApp().request(
      '/breeding-site',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lat: 23.78, lng: 90.4, description: 'standing water in a barrel', turnstileToken: 'good-token' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as BreedingReportResponse;
    expect(body.status).toBe('pending');
    expect(body.flaggedForReview).toBe(true);
  });

  test('Gemini quota/network failure (thrown) → still stored (201, pending), flagged, never 500', async () => {
    const combined = combinedFetch({ gemini: 'unreachable' });
    vi.stubGlobal('fetch', combined.fetch);

    const res = await buildApp().request(
      '/breeding-site',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lat: 23.78, lng: 90.4, description: 'blocked drain near the market', turnstileToken: 'good-token' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as BreedingReportResponse;
    expect(body.status).toBe('pending');
    expect(body.flaggedForReview).toBe(true);
  });

  test('no description → skips the Gemini call entirely, not flagged', async () => {
    const combined = combinedFetch();
    vi.stubGlobal('fetch', combined.fetch);

    const res = await buildApp().request(
      '/breeding-site',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lat: 23.78, lng: 90.4, turnstileToken: 'good-token' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(201);
    expect(combined.geminiCallCount).toBe(0);
    const body = (await res.json()) as BreedingReportResponse;
    expect(body.flaggedForReview).toBe(false);
  });

  test('Supabase insert failure → 503 generic body, never leaks upstream detail', async () => {
    const combined = combinedFetch({ insertResult: { row: undefined as unknown as Record<string, unknown>, status: 500 } });
    vi.stubGlobal('fetch', combined.fetch);

    const res = await buildApp().request(
      '/breeding-site',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lat: 23.78, lng: 90.4, turnstileToken: 'good-token' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as GenericErrorBody;
    expect(body.error?.message).toBeDefined();
    expect(JSON.stringify(body)).not.toContain('insert failed');
  });
});

describe('PATCH /api/reports/breeding-site/:id/verify', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('no token → 401', async () => {
    const res = await buildApp().request(
      `/breeding-site/${validId}/verify`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'verified' }) },
      fakeBindings()
    );
    expect(res.status).toBe(401);
  });

  test('authenticated non-moderator → 403', async () => {
    const token = await signTestJwt({});
    const res = await buildApp().request(
      `/breeding-site/${validId}/verify`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'verified' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(403);
  });

  test('moderator, malformed id → 400, not a database error', async () => {
    const token = await signTestJwt({ role: 'moderator' });
    const res = await buildApp().request(
      '/breeding-site/not-a-uuid/verify',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'verified' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(400);
  });

  test('moderator, invalid status ("pending" is deliberately excluded) → 400', async () => {
    const token = await signTestJwt({ role: 'moderator' });
    const res = await buildApp().request(
      `/breeding-site/${validId}/verify`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'pending' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(400);
  });

  test('unknown id → 404, generic body', async () => {
    const combined = combinedFetch({ updateResult: { row: null } });
    vi.stubGlobal('fetch', combined.fetch);
    const token = await signTestJwt({ role: 'moderator' });

    const res = await buildApp().request(
      `/breeding-site/${validId}/verify`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'verified' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as GenericErrorBody;
    expect(body.error?.message).toBeDefined();
  });

  test('moderator, valid status → 200, verified_by set to the caller\'s id', async () => {
    const moderatorId = '33333333-3333-4333-8333-333333333333';
    const combined = combinedFetch({
      updateResult: { row: { id: validId, status: 'verified', ai_validation: null } },
    });
    vi.stubGlobal('fetch', combined.fetch);
    const token = await signTestJwt({ sub: moderatorId, role: 'moderator' });

    const res = await buildApp().request(
      `/breeding-site/${validId}/verify`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'verified' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as BreedingReportResponse;
    expect(body).toMatchObject({ id: validId, status: 'verified', flaggedForReview: false });

    const updateCall = combined.calls.find((c) => c.method === 'PATCH');
    expect(updateCall?.body?.verified_by).toBe(moderatorId);
    expect(updateCall?.body?.status).toBe('verified');
  });

  test('admin (a higher role than moderator) is also permitted', async () => {
    const combined = combinedFetch({
      updateResult: { row: { id: validId, status: 'rejected', ai_validation: null } },
    });
    vi.stubGlobal('fetch', combined.fetch);
    const token = await signTestJwt({ role: 'admin' });

    const res = await buildApp().request(
      `/breeding-site/${validId}/verify`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'rejected' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(200);
  });

  test('Supabase update failure → 503 generic body', async () => {
    const combined = combinedFetch({ updateResult: { status: 500 } });
    vi.stubGlobal('fetch', combined.fetch);
    const token = await signTestJwt({ role: 'moderator' });

    const res = await buildApp().request(
      `/breeding-site/${validId}/verify`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'verified' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(503);
  });
});
