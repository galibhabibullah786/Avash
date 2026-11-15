import { describe, test, expect, vi, beforeEach } from 'vitest';
import { inngestRoute, registerWithInngestDevServer } from '../../src/routes/inngest';

describe('Inngest Route (/api/inngest)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('GET / responds with Inngest introspection schema and dev headers', async () => {
    const req = new Request('http://localhost/', {
      method: 'GET',
    });
    const res = await inngestRoute.fetch(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-inngest-framework')).toBe('hono');
    expect(res.headers.get('x-inngest-sdk')).toBe('js:v3.31.2');

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.schema_version).toBe('2024-05-24');
    expect(body.app_id).toBe('avash-risk-alerts');
    expect(body.functionsFound).toBe(1);
    expect(body.mode).toBe('dev');
  });

  test('PUT / initiates sync with Inngest server and returns success', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'registered' }), { status: 200 })
    );

    const req = new Request('http://localhost/?deployId=test-deploy-123', {
      method: 'PUT',
    });
    const res = await inngestRoute.fetch(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.message).toBe('Successfully synced.');
    expect(body.modified).toBe(true);

    expect(mockFetch).toHaveBeenCalled();
    const [calledUrl, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain('/fn/register?deployId=test-deploy-123');
    expect(options.method).toBe('POST');
    const sentPayload = JSON.parse(options.body as string);
    expect(sentPayload.appName).toBe('avash-risk-alerts');
    expect(sentPayload.functions).toHaveLength(1);
    expect(sentPayload.functions[0].id).toBe('send-dengue-risk-alert');
  });

  test('GET /sync reports sync status correctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'registered' }), { status: 200 })
    );

    const req = new Request('http://localhost/sync', {
      method: 'GET',
    });
    const res = await inngestRoute.fetch(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('synced');
    expect(body.appUrl).toBe('http://localhost/api/inngest');
  });

  test('registerWithInngestDevServer falls back cleanly when dev server is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connection refused'));

    const res = await registerWithInngestDevServer('http://localhost:8787/api/inngest');
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });
});
