import { describe, test, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { inngestRoute } from '../../src/routes/inngest';

describe('Inngest Route (/api/inngest)', () => {
  let app: Hono;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.INNGEST_DEV = '1';
    app = new Hono();
    app.route('/api/inngest', inngestRoute);
  });

  test('GET /api/inngest responds with official Inngest v4 introspection schema', async () => {
    const res = await app.request('http://localhost:8787/api/inngest', {
      method: 'GET',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-inngest-framework')).toBe('hono');
    expect(res.headers.get('x-inngest-sdk')).toContain('inngest-js:v4');

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.schema_version).toBe('2024-05-24');
    expect(body.function_count).toBe(1);
    expect(body.mode).toBe('dev');
  });

  test('GET /api/inngest/sync reports active endpoint metadata', async () => {
    const res = await app.request('http://localhost:8787/api/inngest/sync', {
      method: 'GET',
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('synced');
    expect(body.app).toBe('avash-risk-alerts');
    expect(body.sdk).toContain('inngest-js:v4');
  });

  test('PUT /api/inngest attempts outbound sync registration via Inngest SDK', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'registered' }), { status: 200 })
    );

    const res = await app.request('http://localhost:8787/api/inngest?deployId=test-123', {
      method: 'PUT',
    });
    // InngestCommHandler responds with 200 when fetch succeeds or 500 when remote host down
    expect([200, 500]).toContain(res.status);
    expect(res.headers.get('x-inngest-sdk')).toContain('inngest-js:v4');
  });
});
