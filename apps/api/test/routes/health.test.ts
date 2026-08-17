import { SELF } from 'cloudflare:test';
import { describe, test, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { healthResponseSchema, healthDbResponseSchema } from '@avash/types';
import { handleError, type GenericErrorBody } from '@avash/logger';
import { health } from '../../src/routes/health';
import { requestId } from '../../src/middleware/request-id';
import type { AppEnv, Bindings } from '../../src/types';

function fakeBindings(overrides: Partial<Bindings> = {}): Bindings {
  return {
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    SUPABASE_JWT_SECRET: '',
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

describe('GET /health', () => {
  test('returns 200 with a schema-valid body', async () => {
    const res = await SELF.fetch('https://example.com/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => healthResponseSchema.parse(body)).not.toThrow();
  });

  test('carries all five §7.4 security headers', async () => {
    const res = await SELF.fetch('https://example.com/health');
    expect(res.headers.get('strict-transport-security')).toBeTruthy();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('permissions-policy')).toBeTruthy();
  });

  test('carries X-Request-Id', async () => {
    const res = await SELF.fetch('https://example.com/health');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  test('falls back to "development" when ENVIRONMENT is unset', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', requestId());
    app.route('/health', health);

    const res = await app.request('/health', {}, fakeBindings({ ENVIRONMENT: undefined as unknown as string }));
    const body = (await res.json()) as { environment: string };
    expect(body.environment).toBe('development');
  });
});

describe('GET /health/db', () => {
  // These run the health sub-app directly (same pattern as the error-boundary
  // describe below) rather than through SELF: SELF dispatches into a
  // genuinely separate Worker isolate, where a `fetch` stub set in this
  // test file's realm never reaches the outbound call the worker under
  // test makes. Calling the sub-app in-process keeps everything in one
  // realm, so stubbing global fetch here actually takes effect.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function appWithHealth() {
    const app = new Hono<AppEnv>();
    app.use('*', requestId());
    app.route('/health', health);
    return app;
  }

  test('returns ready:true when the bounded query succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
    );

    const res = await appWithHealth().request(
      '/health/db',
      {},
      fakeBindings({ SUPABASE_URL: 'https://project.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'test-key' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ready: true, reason: null, requestId: expect.any(String) });
  });

  test('returns ready:false when the query resolves with a PostgREST error (no throw)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'permission denied for table regions' }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          })
      )
    );

    const res = await appWithHealth().request(
      '/health/db',
      {},
      fakeBindings({ SUPABASE_URL: 'https://project.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'test-key' })
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    const parsed = healthDbResponseSchema.parse(body);
    expect(parsed.ready).toBe(false);
    expect(JSON.stringify(body)).not.toContain('permission denied');
  });

  test('returns a schema-valid, not-ready body when Supabase is unreachable', async () => {
    const res = await SELF.fetch('https://example.com/health/db');
    expect(res.status).toBe(503);
    const body = await res.json();
    const parsed = healthDbResponseSchema.parse(body);
    expect(parsed.ready).toBe(false);
    expect(parsed.reason).toBeTruthy();
  });

  test('never leaks a driver error, network detail, or the service-role key in the body', async () => {
    const res = await SELF.fetch('https://example.com/health/db');
    const serialized = await res.text();
    expect(serialized).not.toContain('fetch failed');
    expect(serialized).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  test('does not affect /health liveness — GET /health still returns 200', async () => {
    const res = await SELF.fetch('https://example.com/health');
    expect(res.status).toBe(200);
  });
});

describe('unknown routes', () => {
  test('returns a generic typed 404 JSON body', async () => {
    const res = await SELF.fetch('https://example.com/does-not-exist');
    expect(res.status).toBe(404);
    const body = (await res.json()) as GenericErrorBody;
    expect(body.error.message).toBeTruthy();
    expect(body.error.requestId).toBeTruthy();
  });

  test('rejects a malformed request method with a typed body, never a raw crash', async () => {
    const res = await SELF.fetch('https://example.com/health', { method: 'PATCH' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.text();
    expect(() => JSON.parse(body)).not.toThrow();
  });
});

describe('CORS allow-list (env-driven, wrangler.toml CORS_ALLOWED_ORIGINS / CORS_PREVIEW_ORIGIN_SUFFIX)', () => {
  test('gives a disallowed origin no CORS header back', async () => {
    const res = await SELF.fetch('https://example.com/health', {
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('gives the exact allowed production origin the matching CORS header back', async () => {
    const res = await SELF.fetch('https://example.com/health', {
      headers: { Origin: 'https://avash.pages.dev' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://avash.pages.dev');
  });

  test('gives a PR-preview-suffix origin the matching CORS header back', async () => {
    const res = await SELF.fetch('https://example.com/health', {
      headers: { Origin: 'https://pr-99.avash.pages.dev' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://pr-99.avash.pages.dev');
  });

  test('gives a missing Origin header no CORS header back', async () => {
    const res = await SELF.fetch('https://example.com/health');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('an allowed origin gets a successful OPTIONS preflight response', async () => {
    const res = await SELF.fetch('https://example.com/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://avash.pages.dev',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://avash.pages.dev');
    expect(res.headers.get('access-control-allow-methods')).toBeTruthy();
  });

  // Every PATCH route (report verification, role assignment) is otherwise
  // preflight-blocked in a real browser even though the handler itself is
  // fine — this only shows up cross-origin, never through an in-process
  // route mock, which is why it slipped through.
  test('the preflight response allows PATCH', async () => {
    const res = await SELF.fetch('https://example.com/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://avash.pages.dev',
        'Access-Control-Request-Method': 'PATCH',
      },
    });
    expect(res.headers.get('access-control-allow-methods')).toContain('PATCH');
  });

  test('a disallowed origin gets a rejected OPTIONS preflight response', async () => {
    const res = await SELF.fetch('https://example.com/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('health response contract (shared with apps/web)', () => {
  test('body parses against the shared schema with exactly the expected keys', async () => {
    const res = await SELF.fetch('https://example.com/health');
    const body = (await res.json()) as Record<string, unknown>;
    const parsed = healthResponseSchema.parse(body);
    expect(Object.keys(body).sort()).toEqual(Object.keys(parsed).sort());
  });
});

describe('error boundary (R10)', () => {
  // In-process, not against SELF: proving no production route exists
  // purely to be thrown at, this exercises the same onError wiring
  // pattern (requestId -> handler -> handleError) used in src/index.ts,
  // on a throwaway Hono instance built for the test — an ordinary
  // in-process construction inside the workerd runtime this project runs
  // under, so runtime fidelity isn't traded away for the convenience.
  test('returns a generic body with no stack trace when a handler throws', async () => {
    const throwingApp = new Hono<AppEnv>();
    throwingApp.use('*', requestId());
    throwingApp.get('/boom', () => {
      throw new Error('internal detail that must never leak');
    });
    throwingApp.onError((error, c) => c.json(handleError(error, c.get('requestId')), 500));

    const res = await throwingApp.request('/boom');
    expect(res.status).toBe(500);
    const body = (await res.json()) as GenericErrorBody;
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('internal detail');
    expect(serialized).not.toContain('stack');
    expect(body.error.requestId).toBeTruthy();
  });
});
