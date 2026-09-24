import { describe, test, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { recordAudit } from '../../src/lib/auditWrite';
import { requestId } from '../../src/middleware/request-id';
import { createFakeSupabase, INVALID_SUPABASE_URL, postgrestErrorBody } from '../helpers/fakeSupabase';
import type { AppEnv, Bindings } from '../../src/types';

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

const USER_ID = '11111111-1111-4111-8111-111111111111';

function baseEntry() {
  return {
    action: 'alert.subscribe' as const,
    entityType: 'alert_subscription' as const,
    entityId: 'sub-1',
    actorId: USER_ID,
    actorRole: 'citizen' as const,
    outcome: 'success' as const,
    requestId: 'test-request-id',
  };
}

describe('recordAudit', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('a returned { error } from the sink is swallowed, not thrown', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/audit_log', body: postgrestErrorBody(), status: 500 },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const app = new Hono<AppEnv>();
    app.use('*', requestId());
    app.get('/', async (c) => {
      await expect(recordAudit(c, baseEntry())).resolves.toBeUndefined();
      return c.json({ ok: true });
    });

    const res = await app.request('/', {}, fakeBindings());
    expect(res.status).toBe(200);
  });

  test('a thrown rejection building the Supabase client is swallowed, not thrown', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', requestId());
    app.get('/', async (c) => {
      await expect(recordAudit(c, baseEntry())).resolves.toBeUndefined();
      return c.json({ ok: true });
    });

    const res = await app.request('/', {}, fakeBindings({ SUPABASE_URL: INVALID_SUPABASE_URL }));
    expect(res.status).toBe(200);
  });

  test('a successful write reaches audit_log with the given action', async () => {
    const fake = createFakeSupabase([{ path: '/rest/v1/audit_log', body: [{ id: 1 }] }]);
    vi.stubGlobal('fetch', fake.fetch);

    const app = new Hono<AppEnv>();
    app.use('*', requestId());
    app.get('/', async (c) => {
      await recordAudit(c, baseEntry());
      return c.json({ ok: true });
    });

    await app.request('/', {}, fakeBindings());
    expect(fake.calls.some((u) => u.pathname === '/rest/v1/audit_log')).toBe(true);
  });
});
