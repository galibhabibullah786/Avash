import { describe, test, expect } from 'vitest';
import { Hono } from 'hono';
import { corsMiddleware } from '../../src/middleware/cors';
import { isAllowedOrigin } from '../../src/config/cors';
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
    ENVIRONMENT: 'development',
    CORS_ALLOWED_ORIGINS: 'https://avash.pages.dev,http://localhost:5173,http://localhost:8080',
    CORS_PREVIEW_ORIGIN_SUFFIX: 'avash.pages.dev',
    CLOUDINARY_CLOUD_NAME: '',
    CLOUDINARY_API_KEY: '',
    CLOUDINARY_API_SECRET: '',
    ...overrides,
  };
}

function buildApp(bindings: Bindings) {
  const app = new Hono<AppEnv>();
  app.use('*', corsMiddleware());
  app.get('/test', (c) => c.json({ ok: true }));
  app.post('/test', (c) => c.json({ created: true }));
  app.get('/error', () => {
    throw new Error('route failed');
  });
  app.onError((_err, c) => {
    const origin = c.req.header('Origin');
    if (isAllowedOrigin(origin, c.env)) {
      c.header('Access-Control-Allow-Origin', origin as string);
      c.header('Vary', 'Origin');
    }
    return c.json({ error: 'internal error' }, 500);
  });
  return { app, bindings };
}

describe('corsMiddleware', () => {
  const bindings = fakeBindings();

  test('request without Origin gets no CORS headers', async () => {
    const { app } = buildApp(bindings);
    const res = await app.request('/test', {}, bindings);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('allowed exact origin gets Access-Control-Allow-Origin and Vary', async () => {
    const { app } = buildApp(bindings);
    const res = await app.request('/test', { headers: { Origin: 'http://localhost:5173' } }, bindings);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(res.headers.get('vary')).toContain('Origin');
  });

  test('allowed preview-suffix origin gets Access-Control-Allow-Origin', async () => {
    const { app } = buildApp(bindings);
    const res = await app.request('/test', { headers: { Origin: 'https://preview-123.avash.pages.dev' } }, bindings);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://preview-123.avash.pages.dev');
  });

  test('disallowed origin gets no CORS headers', async () => {
    const { app } = buildApp(bindings);
    const res = await app.request('/test', { headers: { Origin: 'https://malicious-site.example' } }, bindings);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('preflight OPTIONS from allowed origin returns 204 with methods and headers', async () => {
    const { app } = buildApp(bindings);
    const res = await app.request(
      '/test',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type, authorization',
        },
      },
      bindings
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toContain('content-type');
    expect(res.headers.get('access-control-max-age')).toBe('86400');
  });

  test('preflight OPTIONS from disallowed origin returns 403 with no CORS headers', async () => {
    const { app } = buildApp(bindings);
    const res = await app.request(
      '/test',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil.example',
          'Access-Control-Request-Method': 'GET',
        },
      },
      bindings
    );
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('route throwing an error still preserves CORS headers for allowed origin', async () => {
    const { app } = buildApp(bindings);
    const res = await app.request('/error', { headers: { Origin: 'http://localhost:5173' } }, bindings);
    expect(res.status).toBe(500);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });
});
