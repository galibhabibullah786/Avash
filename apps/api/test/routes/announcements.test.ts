import { describe, test, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { announcementSchema, paginatedResponseSchema } from '@avash/types';
import type { RateLimitRedisLike } from '@avash/security';
import { createAnnouncements } from '../../src/routes/announcements';
import { requestId } from '../../src/middleware/request-id';
import { createFakeSupabase, INVALID_SUPABASE_URL, postgrestErrorBody } from '../helpers/fakeSupabase';
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
  app.route('/', createAnnouncements({ redisFactory: fakeRedis }));
  return app;
}

const AUTHOR_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_MODERATOR_ID = '22222222-2222-4222-8222-222222222222';
const ANNOUNCEMENT_ID = '33333333-3333-4333-8333-333333333333';
const FUTURE = '2099-01-01T00:00:00.000Z';

describe('POST /api/announcements', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const validBody = {
    title: 'Standing water reported',
    body: 'Clear standing water near the park by Friday.',
    lat: 23.7,
    lng: 90.4,
    radiusM: 5000,
    targetRoles: [],
    expiresAt: FUTURE,
  };

  test('a citizen JWT → 403', async () => {
    const token = await signTestJwt({ role: 'citizen' });
    const res = await buildApp().request(
      '/',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(validBody),
      },
      fakeBindings()
    );
    expect(res.status).toBe(403);
  });

  test('a moderator → 201', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'moderator' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/announcements',
        match: (_sp, method) => method === 'GET',
        body: [],
      },
      {
        path: '/rest/v1/announcements',
        match: (_sp, method) => method === 'POST',
        // `.single()` sets Accept: application/vnd.pgrst.object+json — the
        // client trusts the response body IS the single row, not an array
        // (see reports.test.ts's combinedFetch for the same convention).
        body: { id: ANNOUNCEMENT_ID, author_id: AUTHOR_ID, created_at: '2026-08-18T00:00:00.000Z' },
      },
      { path: '/rest/v1/audit_log', body: [{ id: 1 }] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      '/',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(validBody),
      },
      fakeBindings()
    );
    expect(res.status).toBe(201);
    const body = announcementSchema.parse(await res.json());
    expect(body.id).toBe(ANNOUNCEMENT_ID);
  });

  test('a title over 120 chars → 400', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'moderator' });
    const res = await buildApp().request(
      '/',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...validBody, title: 'x'.repeat(121) }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(400);
  });

  test('at the active cap (20 live announcements already) → 409', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'moderator' });
    const liveRows = Array.from({ length: 20 }, (_, i) => ({ id: `live-${i}` }));
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/announcements',
        match: (_sp, method) => method === 'GET',
        body: liveRows,
      },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      '/',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(validBody),
      },
      fakeBindings()
    );
    expect(res.status).toBe(409);
  });

  test('a successful create writes an audit_log row whose detail has ≤ 12 scalar keys and no array/object value', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'moderator' });
    const bodies: unknown[] = [];
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/announcements',
        match: (_sp, method) => method === 'GET',
        body: [],
      },
      {
        path: '/rest/v1/announcements',
        match: (_sp, method) => method === 'POST',
        body: { id: ANNOUNCEMENT_ID, author_id: AUTHOR_ID, created_at: '2026-08-18T00:00:00.000Z' },
      },
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
      '/',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...validBody, targetRoles: ['admin', 'moderator'] }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(201);
    expect(bodies).toHaveLength(1);
    const entry = bodies[0] as { action?: string; detail?: Record<string, unknown> | null };
    expect(entry.action).toBe('announcement.create');
    const detail = entry.detail ?? {};
    expect(Object.keys(detail).length).toBeLessThanOrEqual(12);
    for (const value of Object.values(detail)) {
      expect(typeof value === 'object' && value !== null).toBe(false);
    }
    expect(detail['target.roles']).toBe('admin,moderator');
  });

  test('an unexpected failure building the Supabase client → 503', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'moderator' });
    const res = await buildApp().request(
      '/',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(validBody),
      },
      fakeBindings({ SUPABASE_URL: INVALID_SUPABASE_URL })
    );
    expect(res.status).toBe(503);
  });
});

describe('GET /api/announcements', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const CALLER_LAT = 23.7;
  const CALLER_LNG = 90.4;
  // ~2.0km north of the caller.
  const NEAR_LAT = CALLER_LAT + 0.018;
  // ~6.0km north of the caller.
  const FAR_LAT = CALLER_LAT + 0.054;

  function row(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: '44444444-4444-4444-8444-444444444444',
      author_id: AUTHOR_ID,
      title: 'Notice',
      body: 'Body text',
      geom: { type: 'Point', coordinates: [CALLER_LNG, CALLER_LAT] },
      radius_m: 5000,
      target_roles: [],
      expires_at: FUTURE,
      created_at: '2026-08-18T00:00:00.000Z',
      ...overrides,
    };
  }

  test('an expired announcement is absent from results', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'citizen' });
    const fake = createFakeSupabase([
      // The route filters on expires_at > now() in the query itself, so a
      // fake that only ever returns live rows models that filter — the
      // expired fixture below is never returned by the stubbed query.
      { path: '/rest/v1/announcements', body: [] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/?lat=${CALLER_LAT}&lng=${CALLER_LNG}`,
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(200);
    const body = paginatedResponseSchema(announcementSchema).parse(await res.json());
    expect(body.items).toHaveLength(0);
  });

  test('an announcement targeting only admin is absent for a citizen caller', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'citizen' });
    const fake = createFakeSupabase([
      { path: '/rest/v1/announcements', body: [row({ target_roles: ['admin'] })] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/?lat=${CALLER_LAT}&lng=${CALLER_LNG}`,
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(200);
    const body = paginatedResponseSchema(announcementSchema).parse(await res.json());
    expect(body.items).toHaveLength(0);
  });

  test('a moderator caller sees a moderator-targeted announcement', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'moderator' });
    const fake = createFakeSupabase([
      { path: '/rest/v1/announcements', body: [row({ target_roles: ['moderator'] })] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/?lat=${CALLER_LAT}&lng=${CALLER_LNG}`,
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(200);
    const body = paginatedResponseSchema(announcementSchema).parse(await res.json());
    expect(body.items).toHaveLength(1);
  });

  test('6km away with radiusM 5000 is absent while 2km away is present', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'citizen' });
    const nearId = '55555555-5555-4555-8555-555555555555';
    const farId = '66666666-6666-4666-8666-666666666666';
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/announcements',
        body: [
          row({ id: nearId, geom: { type: 'Point', coordinates: [CALLER_LNG, NEAR_LAT] }, radius_m: 5000 }),
          row({ id: farId, geom: { type: 'Point', coordinates: [CALLER_LNG, FAR_LAT] }, radius_m: 5000 }),
        ],
      },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/?lat=${CALLER_LAT}&lng=${CALLER_LNG}`,
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(200);
    const body = paginatedResponseSchema(announcementSchema).parse(await res.json());
    const ids = body.items.map((item) => item.id);
    expect(ids).toContain(nearId);
    expect(ids).not.toContain(farId);
  });

  test('no token → 401', async () => {
    const res = await buildApp().request(`/?lat=${CALLER_LAT}&lng=${CALLER_LNG}`, {}, fakeBindings());
    expect(res.status).toBe(401);
  });

  test('a missing lat/lng → 400', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'citizen' });
    const res = await buildApp().request('/', { headers: { Authorization: `Bearer ${token}` } }, fakeBindings());
    expect(res.status).toBe(400);
  });

  test('an unrecognised scope → 400', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'moderator' });
    const res = await buildApp().request(
      `/?scope=everything&lat=${CALLER_LAT}&lng=${CALLER_LNG}`,
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(400);
  });

  test('scope=manage is refused for a citizen — it exposes rows the nearby filter would have withheld', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'citizen' });
    const res = await buildApp().request(
      '/?scope=manage',
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(403);
  });

  test('scope=manage needs no lat/lng — a management list is not filtered by where the moderator is standing', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'moderator' });
    const fake = createFakeSupabase([{ path: '/rest/v1/announcements', body: [row()] }]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      '/?scope=manage',
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(200);
    const body = paginatedResponseSchema(announcementSchema).parse(await res.json());
    expect(body.items).toHaveLength(1);
  });

  test('scope=manage narrows to the caller\'s own rows for a moderator', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'moderator' });
    const fake = createFakeSupabase([{ path: '/rest/v1/announcements', body: [row()] }]);
    vi.stubGlobal('fetch', fake.fetch);

    await buildApp().request('/?scope=manage', { headers: { Authorization: `Bearer ${token}` } }, fakeBindings());

    const call = fake.calls.find((u) => u.pathname === '/rest/v1/announcements');
    // Mirrors the DELETE handler's author-or-admin rule, so the list shows
    // exactly the rows the caller is allowed to remove.
    expect(call?.searchParams.get('author_id')).toBe(`eq.${AUTHOR_ID}`);
  });

  test('scope=manage returns every row for an admin, matching what an admin may delete', async () => {
    const token = await signTestJwt({ sub: OTHER_MODERATOR_ID, role: 'admin' });
    const fake = createFakeSupabase([{ path: '/rest/v1/announcements', body: [row()] }]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      '/?scope=manage',
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(200);

    const call = fake.calls.find((u) => u.pathname === '/rest/v1/announcements');
    expect(call?.searchParams.get('author_id')).toBeNull();
    // Another moderator's row, returned because an admin may delete it.
    const body = paginatedResponseSchema(announcementSchema).parse(await res.json());
    expect(body.items).toHaveLength(1);
  });

  test('scope=manage keeps EXPIRED rows — their author is the one person who needs to see they lapsed', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'moderator' });
    const fake = createFakeSupabase([
      { path: '/rest/v1/announcements', body: [row({ expires_at: '2020-01-01T00:00:00.000Z' })] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      '/?scope=manage',
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );

    const call = fake.calls.find((u) => u.pathname === '/rest/v1/announcements');
    expect(call?.searchParams.get('expires_at')).toBeNull();
    const body = paginatedResponseSchema(announcementSchema).parse(await res.json());
    expect(body.items).toHaveLength(1);
  });

  test('scope=manage applies no role targeting or proximity filter', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'moderator' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/announcements',
        // Targeted at admins only and 6km from anywhere the caller might
        // be — the nearby scope would drop it on both counts.
        body: [row({ target_roles: ['admin'], geom: { type: 'Point', coordinates: [CALLER_LNG, FAR_LAT] } })],
      },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      '/?scope=manage',
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    const body = paginatedResponseSchema(announcementSchema).parse(await res.json());
    expect(body.items).toHaveLength(1);
  });

  test('the default scope is unchanged — no scope param still means the nearby feed', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'moderator' });
    const fake = createFakeSupabase([
      { path: '/rest/v1/announcements', body: [row({ target_roles: ['admin'] })] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/?lat=${CALLER_LAT}&lng=${CALLER_LNG}`,
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    const call = fake.calls.find((u) => u.pathname === '/rest/v1/announcements');
    expect(call?.searchParams.get('expires_at')).toContain('gt.');
    const body = paginatedResponseSchema(announcementSchema).parse(await res.json());
    // Admin-targeted, so still filtered out for a moderator.
    expect(body.items).toHaveLength(0);
  });
});

describe('GET /api/announcements/:id', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function row(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: ANNOUNCEMENT_ID,
      author_id: AUTHOR_ID,
      title: 'Notice',
      body: 'Body text',
      geom: { type: 'Point', coordinates: [90.4, 23.7] },
      radius_m: 5000,
      target_roles: [],
      expires_at: FUTURE,
      created_at: '2026-08-18T00:00:00.000Z',
      ...overrides,
    };
  }

  test('a non-UUID id → 400, not a database call', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'citizen' });
    const res = await buildApp().request(
      '/not-a-uuid',
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(400);
  });

  test('an unknown id → 404', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'citizen' });
    const fake = createFakeSupabase([{ path: '/rest/v1/announcements', body: [] }]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/${ANNOUNCEMENT_ID}`,
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(404);
  });

  test('an announcement targeted at a different role → 404, not 403 — a 403 would confirm the id exists', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'citizen' });
    const fake = createFakeSupabase([
      { path: '/rest/v1/announcements', body: [row({ target_roles: ['admin'] })] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/${ANNOUNCEMENT_ID}`,
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(404);
  });

  test('an expired announcement → 404', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'citizen' });
    const fake = createFakeSupabase([
      { path: '/rest/v1/announcements', body: [row({ expires_at: '2020-01-01T00:00:00.000Z' })] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/${ANNOUNCEMENT_ID}`,
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(404);
  });

  test('a matching id → 200 with a body that parses under announcementSchema, resolving independent of geolocation (no lat/lng supplied)', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'citizen' });
    const fake = createFakeSupabase([{ path: '/rest/v1/announcements', body: [row()] }]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/${ANNOUNCEMENT_ID}`,
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(200);
    const body = announcementSchema.parse(await res.json());
    expect(body.id).toBe(ANNOUNCEMENT_ID);
  });

  test('no token → 401', async () => {
    const res = await buildApp().request(`/${ANNOUNCEMENT_ID}`, {}, fakeBindings());
    expect(res.status).toBe(401);
  });

  test('a Supabase client construction failure (invalid SUPABASE_URL) → 503', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'citizen' });
    const res = await buildApp().request(
      `/${ANNOUNCEMENT_ID}`,
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings({ SUPABASE_URL: INVALID_SUPABASE_URL })
    );
    expect(res.status).toBe(503);
  });

  test('a PostgREST read error (non-2xx response) → 503', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'citizen' });
    const fake = createFakeSupabase([
      { path: '/rest/v1/announcements', body: postgrestErrorBody(), status: 500 },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/${ANNOUNCEMENT_ID}`,
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(503);
  });

  test('a row whose geom cannot be parsed into a DTO → 404, not a 500 — malformed stored data never leaks as a server error', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'citizen' });
    const fake = createFakeSupabase([
      { path: '/rest/v1/announcements', body: [row({ geom: null })] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/${ANNOUNCEMENT_ID}`,
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/announcements/:id', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('a different moderator (not the author, not admin) → 403', async () => {
    const token = await signTestJwt({ sub: OTHER_MODERATOR_ID, role: 'moderator' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/announcements',
        match: (_sp, method) => method === 'GET',
        body: [{ id: ANNOUNCEMENT_ID, author_id: AUTHOR_ID }],
      },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/${ANNOUNCEMENT_ID}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(403);
  });

  test('the author → 204', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'moderator' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/announcements',
        match: (_sp, method) => method === 'GET',
        body: [{ id: ANNOUNCEMENT_ID, author_id: AUTHOR_ID }],
      },
      {
        path: '/rest/v1/announcements',
        match: (_sp, method) => method === 'DELETE',
        body: [],
      },
      { path: '/rest/v1/audit_log', body: [{ id: 1 }] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/${ANNOUNCEMENT_ID}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(204);
  });

  test('an admin who is not the author → 204', async () => {
    const token = await signTestJwt({ sub: OTHER_MODERATOR_ID, role: 'admin' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/announcements',
        match: (_sp, method) => method === 'GET',
        body: [{ id: ANNOUNCEMENT_ID, author_id: AUTHOR_ID }],
      },
      {
        path: '/rest/v1/announcements',
        match: (_sp, method) => method === 'DELETE',
        body: [],
      },
      { path: '/rest/v1/audit_log', body: [{ id: 1 }] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/${ANNOUNCEMENT_ID}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(204);
  });

  test('a missing id → 404', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'moderator' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/announcements',
        match: (_sp, method) => method === 'GET',
        body: [],
      },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/${ANNOUNCEMENT_ID}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(404);
  });

  test('a malformed id → 400, not a database call', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'moderator' });
    const res = await buildApp().request(
      '/not-a-uuid',
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(400);
  });

  test('a successful delete writes an audit_log row with action announcement.delete whose detail has no body field', async () => {
    const token = await signTestJwt({ sub: AUTHOR_ID, role: 'moderator' });
    const bodies: unknown[] = [];
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/announcements',
        match: (_sp, method) => method === 'GET',
        body: [{ id: ANNOUNCEMENT_ID, author_id: AUTHOR_ID }],
      },
      {
        path: '/rest/v1/announcements',
        match: (_sp, method) => method === 'DELETE',
        body: [],
      },
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
      `/${ANNOUNCEMENT_ID}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(204);
    expect(bodies).toHaveLength(1);
    const entry = bodies[0] as { action?: string; entity_id?: string; detail?: Record<string, unknown> | null };
    expect(entry.action).toBe('announcement.delete');
    expect(entry.entity_id).toBe(ANNOUNCEMENT_ID);
    expect(entry.detail ?? {}).not.toHaveProperty('body');
  });
});
