import { describe, test, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { managedUserListResponseSchema, roleAssignmentResponseSchema } from '@avash/types';
import type { RateLimitRedisLike } from '@avash/security';
import { createAdminUsers } from '../../src/routes/admin-users';
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
  app.route('/', createAdminUsers({ redisFactory: fakeRedis }));
  return app;
}

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_USERS_PATH = '/auth/v1/admin/users';

function goTrueUser(id: string, role?: string, email = 'someone@example.com') {
  return {
    id,
    email,
    created_at: '2026-01-01T00:00:00.000Z',
    last_sign_in_at: '2026-08-01T00:00:00.000Z',
    app_metadata: role ? { provider: 'email', role } : { provider: 'email' },
    user_metadata: {},
    aud: 'authenticated',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/admin/users', () => {
  test('no token → 401', async () => {
    const res = await buildApp().request('/', {}, fakeBindings());
    expect(res.status).toBe(401);
  });

  test('a moderator → 403; roles:manage is admin-only', async () => {
    const token = await signTestJwt({ role: 'moderator' });
    const res = await buildApp().request(
      '/',
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(403);
  });

  test('a citizen → 403', async () => {
    const token = await signTestJwt({});
    const res = await buildApp().request(
      '/',
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(403);
  });

  test('an admin gets a schema-valid list with roles resolved', async () => {
    const token = await signTestJwt({ sub: ADMIN_ID, role: 'admin' });
    const fake = createFakeSupabase([
      {
        path: ADMIN_USERS_PATH,
        body: {
          users: [
            goTrueUser(ADMIN_ID, 'admin', 'admin@example.com'),
            goTrueUser(TARGET_ID, undefined, 'citizen@example.com'),
          ],
          aud: 'authenticated',
        },
      },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      '/',
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(200);

    const body = managedUserListResponseSchema.parse(await res.json());
    expect(body.users).toHaveLength(2);
    expect(body.users[0]?.role).toBe('admin');
    // No app_metadata.role at all resolves to citizen, never to null.
    expect(body.users[1]?.role).toBe('citizen');
    // A short page is the last page.
    expect(body.nextPage).toBeNull();
  });

  test('a full page reports a nextPage; a short one does not', async () => {
    const token = await signTestJwt({ sub: ADMIN_ID, role: 'admin' });
    const fullPage = Array.from({ length: 50 }, (_, i) =>
      goTrueUser(`3333333${(i % 10).toString()}-3333-4333-8333-333333333333`, 'citizen')
    );
    const fake = createFakeSupabase([
      { path: ADMIN_USERS_PATH, body: { users: fullPage, aud: 'authenticated' } },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      '/',
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    const body = managedUserListResponseSchema.parse(await res.json());
    expect(body.nextPage).toBe(2);
  });

  test('a user row in an unexpected shape is dropped, not rendered half-parsed', async () => {
    const token = await signTestJwt({ sub: ADMIN_ID, role: 'admin' });
    const fake = createFakeSupabase([
      {
        path: ADMIN_USERS_PATH,
        body: {
          users: [goTrueUser(ADMIN_ID, 'admin'), { id: 'not-a-uuid' }, { email: 'no-id@example.com' }],
          aud: 'authenticated',
        },
      },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      '/',
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    const body = managedUserListResponseSchema.parse(await res.json());
    expect(body.users).toHaveLength(1);
    expect(body.users[0]?.id).toBe(ADMIN_ID);
  });

  test('an unexpected failure building the Supabase client → 503, generic body', async () => {
    const token = await signTestJwt({ sub: ADMIN_ID, role: 'admin' });
    const res = await buildApp().request(
      '/',
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings({ SUPABASE_URL: INVALID_SUPABASE_URL })
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe('Something went wrong. Please try again.');
  });
});

describe('PATCH /api/admin/users/:id/role', () => {
  function assignRules(currentRole?: string, nextRole = 'moderator') {
    return [
      {
        path: `${ADMIN_USERS_PATH}/${TARGET_ID}`,
        match: (_sp: URLSearchParams, method: string) => method === 'GET',
        body: goTrueUser(TARGET_ID, currentRole),
      },
      {
        path: `${ADMIN_USERS_PATH}/${TARGET_ID}`,
        match: (_sp: URLSearchParams, method: string) => method === 'PUT',
        body: goTrueUser(TARGET_ID, nextRole),
      },
      { path: '/rest/v1/role_assignments', body: [{ id: 1 }] },
    ];
  }

  test('a moderator cannot assign roles → 403', async () => {
    const token = await signTestJwt({ role: 'moderator' });
    const res = await buildApp().request(
      `/${TARGET_ID}/role`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: 'admin' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(403);
  });

  test('a malformed target id → 400, not a database call', async () => {
    const token = await signTestJwt({ sub: ADMIN_ID, role: 'admin' });
    const res = await buildApp().request(
      '/not-a-uuid/role',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: 'moderator' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(400);
  });

  test('a role outside the enum → 400', async () => {
    const token = await signTestJwt({ sub: ADMIN_ID, role: 'admin' });
    const res = await buildApp().request(
      `/${TARGET_ID}/role`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: 'superuser' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(400);
  });

  test('an admin demoting themselves → 409, the lockout guard', async () => {
    const token = await signTestJwt({ sub: ADMIN_ID, role: 'admin' });
    const res = await buildApp().request(
      `/${ADMIN_ID}/role`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: 'citizen' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(409);
  });

  test('an admin re-asserting their own admin role is allowed through', async () => {
    const token = await signTestJwt({ sub: ADMIN_ID, role: 'admin' });
    const fake = createFakeSupabase([
      {
        path: `${ADMIN_USERS_PATH}/${ADMIN_ID}`,
        match: (_sp, method) => method === 'GET',
        body: goTrueUser(ADMIN_ID, 'admin'),
      },
      {
        path: `${ADMIN_USERS_PATH}/${ADMIN_ID}`,
        match: (_sp, method) => method === 'PUT',
        body: goTrueUser(ADMIN_ID, 'admin'),
      },
      { path: '/rest/v1/role_assignments', body: [{ id: 1 }] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/${ADMIN_ID}/role`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: 'admin' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(200);
  });

  test('a valid grant → 200, and writes an audit row recording the previous role', async () => {
    const token = await signTestJwt({ sub: ADMIN_ID, role: 'admin' });
    const fake = createFakeSupabase(assignRules('citizen', 'moderator'));
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/${TARGET_ID}/role`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: 'moderator', reason: 'joining the on-call rota' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(200);

    const body = roleAssignmentResponseSchema.parse(await res.json());
    expect(body.user.role).toBe('moderator');

    // The audit write actually happened — asserted on the outgoing call,
    // not inferred from the 200.
    expect(fake.calls.some((url) => url.pathname === '/rest/v1/role_assignments')).toBe(true);
  });

  test('app_metadata is merged, never replaced — Supabase’s own provider keys survive', async () => {
    const token = await signTestJwt({ sub: ADMIN_ID, role: 'admin' });
    const bodies: unknown[] = [];
    const fake = createFakeSupabase(assignRules('citizen', 'moderator'));
    const recordingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'PUT' && typeof init?.body === 'string') {
        bodies.push(JSON.parse(init.body));
      }
      return fake.fetch(input, init);
    }) as typeof fetch;
    vi.stubGlobal('fetch', recordingFetch);

    await buildApp().request(
      `/${TARGET_ID}/role`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: 'moderator' }),
      },
      fakeBindings()
    );

    const sent = bodies[0] as { app_metadata?: Record<string, unknown> } | undefined;
    expect(sent?.app_metadata?.role).toBe('moderator');
    expect(sent?.app_metadata?.provider).toBe('email');
  });

  test('a target that does not exist → 404', async () => {
    const token = await signTestJwt({ sub: ADMIN_ID, role: 'admin' });
    const fake = createFakeSupabase([
      {
        path: `${ADMIN_USERS_PATH}/${TARGET_ID}`,
        match: (_sp, method) => method === 'GET',
        body: { message: 'User not found' },
        status: 404,
      },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/${TARGET_ID}/role`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: 'moderator' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(404);
  });

  test('the role change succeeds but the audit write fails → still 200, because the grant did take effect', async () => {
    const token = await signTestJwt({ sub: ADMIN_ID, role: 'admin' });
    const fake = createFakeSupabase([
      ...assignRules('citizen', 'moderator').slice(0, 2),
      { path: '/rest/v1/role_assignments', body: { message: 'permission denied' }, status: 403 },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/${TARGET_ID}/role`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: 'moderator' }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(200);
  });

  test('401 and 403 bodies never differ by message, only by status', async () => {
    const moderatorToken = await signTestJwt({ role: 'moderator' });
    const res401 = await buildApp().request('/', {}, fakeBindings());
    const res403 = await buildApp().request(
      '/',
      { headers: { Authorization: `Bearer ${moderatorToken}` } },
      fakeBindings()
    );
    const body401 = (await res401.json()) as { error: { message: string } };
    const body403 = (await res403.json()) as { error: { message: string } };
    expect(body401.error.message).toBe(body403.error.message);
  });
});
