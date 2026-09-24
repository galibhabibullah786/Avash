import { describe, test, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { paginatedResponseSchema, auditEntrySchema } from '@avash/types';
import type { RateLimitRedisLike } from '@avash/security';
import { createAuditLog } from '../../src/routes/audit-log';
import { requestId } from '../../src/middleware/request-id';
import { createFakeSupabase } from '../helpers/fakeSupabase';
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
  app.route('/', createAuditLog({ redisFactory: fakeRedis }));
  return app;
}

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

function auditRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    action: 'upload.sign',
    entity_type: 'upload',
    entity_id: 'x',
    actor_id: ADMIN_ID,
    actor_role: 'admin',
    outcome: 'success',
    request_id: 'req-1',
    detail: null,
    occurred_at: '2026-08-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('GET /api/admin/audit-log', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('no token → 401', async () => {
    const res = await buildApp().request('/', {}, fakeBindings());
    expect(res.status).toBe(401);
  });

  test('a moderator → 403', async () => {
    const token = await signTestJwt({ role: 'moderator' });
    const res = await buildApp().request('/', { headers: { Authorization: `Bearer ${token}` } }, fakeBindings());
    expect(res.status).toBe(403);
  });

  test('an admin → 200, schema-valid body', async () => {
    const token = await signTestJwt({ sub: ADMIN_ID, role: 'admin' });
    const fake = createFakeSupabase([{ path: '/rest/v1/audit_log', body: [auditRow()] }]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request('/', { headers: { Authorization: `Bearer ${token}` } }, fakeBindings());
    expect(res.status).toBe(200);
    const body = paginatedResponseSchema(auditEntrySchema).parse(await res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.action).toBe('upload.sign');
  });

  test('?pageSize=500 is clamped to LIST_PAGE_SIZE_MAX (100), not honored or rejected', async () => {
    const token = await signTestJwt({ sub: ADMIN_ID, role: 'admin' });
    const fake = createFakeSupabase([{ path: '/rest/v1/audit_log', body: [] }]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      '/?pageSize=500',
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(200);
    const body = paginatedResponseSchema(auditEntrySchema).parse(await res.json());
    expect(body.page.pageSize).toBe(100);
  });

  test('?action= filters the query', async () => {
    const token = await signTestJwt({ sub: ADMIN_ID, role: 'admin' });
    const fake = createFakeSupabase([{ path: '/rest/v1/audit_log', body: [auditRow({ action: 'role.assign' })] }]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      '/?action=role.assign',
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(200);
    const url = fake.calls.at(-1);
    expect(url?.searchParams.get('action')).toBe('eq.role.assign');
  });

  test('an unknown action value → 400', async () => {
    const token = await signTestJwt({ sub: ADMIN_ID, role: 'admin' });
    const res = await buildApp().request(
      '/?action=not-a-real-action',
      { headers: { Authorization: `Bearer ${token}` } },
      fakeBindings()
    );
    expect(res.status).toBe(400);
  });
});
