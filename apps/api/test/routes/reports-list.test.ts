import { describe, test, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createReports } from '../../src/routes/reports';
import type { AppEnv } from '../../src/types';

describe('GET /api/reports - public approved reports list', () => {
  const dummyEnv = {
    ENVIRONMENT: 'development',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    SUPABASE_JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long',
    TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  };

  const sampleReports = [
    {
      id: 'report-1',
      description: 'water logging',
      photo_url: 'https://img.test/pic.jpg',
      status: 'verified',
      created_at: '2026-11-08T00:00:00Z',
      geom: { coordinates: [90.4125, 23.8103] },
    },
    {
      id: 'report-2',
      description: 'drain issue',
      photo_url: null,
      status: 'resolved',
      created_at: '2026-11-07T00:00:00Z',
      geom: { coordinates: [90.4200, 23.8200] },
    },
  ];

  function setupFetchMock() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
        if (url.pathname === '/rest/v1/breeding_reports' && (init?.method ?? 'GET') === 'GET') {
          return new Response(JSON.stringify(sampleReports), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      })
    );
  }

  test('allows unauthenticated requests and returns 200 with approved reports', async () => {
    setupFetchMock();
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('requestId', 'test-req-id');
      await next();
    });
    app.route('/api/reports', createReports());

    const res = await app.request('/api/reports', { method: 'GET' }, dummyEnv as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; requestId: string };
    expect(body.items.length).toBe(2);
    expect(body.requestId).toBe('test-req-id');
  });

  test('calculates distance and sorts by proximity when lat and lng are provided', async () => {
    setupFetchMock();
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('requestId', 'test-req-id');
      await next();
    });
    app.route('/api/reports', createReports());

    const res = await app.request('/api/reports?lat=23.8103&lng=90.4125', { method: 'GET' }, dummyEnv as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string; distance: number }> };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.id).toBe('report-1');
    expect(body.items[0]?.distance).toBeCloseTo(0, 3);
  });
});
