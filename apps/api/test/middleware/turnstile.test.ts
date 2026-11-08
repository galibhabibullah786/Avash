import { describe, test, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { turnstile } from '../../src/middleware/turnstile';
import { requestId } from '../../src/middleware/request-id';
import type { AppEnv } from '../../src/types';

const env = { TURNSTILE_SECRET_KEY: 'test-turnstile-secret' } as never;

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.post('/guarded', turnstile(), (c) => c.json({ ok: true }));
  return app;
}

describe('turnstile middleware', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('missing token in the body → 403, no verify call made', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const app = buildApp();
    const res = await app.request(
      '/guarded',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      env
    );

    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('a non-JSON body → 403, never throws', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const app = buildApp();
    const res = await app.request('/guarded', { method: 'POST', body: 'not json' }, env);
    expect(res.status).toBe(403);
  });

  test('Turnstile rejects the token → 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), { status: 200 }))
    );

    const app = buildApp();
    const res = await app.request(
      '/guarded',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnstileToken: 'bad-token' }) },
      env
    );

    expect(res.status).toBe(403);
  });

  test('Turnstile verification service unreachable → 403, never throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network unreachable');
      })
    );

    const app = buildApp();
    const res = await app.request(
      '/guarded',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnstileToken: 'some-token' }) },
      env
    );

    expect(res.status).toBe(403);
  });

  test('Turnstile accepts the token → handler runs, and the token is never sent as a query param the response echoes', async () => {
    let capturedBody: string | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = typeof init?.body === 'string' ? init.body : String(init?.body);
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      })
    );

    const app = buildApp();
    const res = await app.request(
      '/guarded',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ turnstileToken: 'good-token' }),
      },
      env
    );

    expect(res.status).toBe(200);
    expect(capturedBody).toContain('response=good-token');
    expect(capturedBody).toContain('secret=test-turnstile-secret');
  });

  test('local dev test tokens are verified with Cloudflare test secret key', async () => {
    let capturedBody = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = typeof init?.body === 'string' ? init.body : String(init?.body);
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      })
    );

    const app = buildApp();
    const res = await app.request(
      '/guarded',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ turnstileToken: 'XXXX.DUMMY.TOKEN' }),
      },
      Object.assign({}, env, { ENVIRONMENT: 'development' })
    );

    expect(res.status).toBe(200);
    expect(capturedBody).toContain('secret=1x0000000000000000000000000000000AA');
  });
});
