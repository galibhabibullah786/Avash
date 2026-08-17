import { describe, test, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { latestWeatherResponseSchema, weatherHistoryResponseSchema } from '@avash/types';
import { weather } from '../../src/routes/weather';
import { requestId } from '../../src/middleware/request-id';
import { createFakeSupabase, INVALID_SUPABASE_URL, postgrestErrorBody } from '../helpers/fakeSupabase';
import type { AppEnv, Bindings } from '../../src/types';

// Mirrors health.test.ts: weather reads `c.get('requestId')`, which only
// exists once the request-id middleware has run, and global `fetch` must
// be stubbed in-process (not via SELF, a separate Worker isolate) for the
// stub to take effect — see health.test.ts's `/health/db` describe block.
function fakeBindings(overrides: Partial<Bindings> = {}): Bindings {
  return {
    SUPABASE_URL: 'https://project.supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
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

function weatherApp() {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.route('/', weather);
  return app;
}

const dhakaRow = {
  id: 1,
  region_id: '11111111-1111-4111-8111-111111111111',
  region_code: 'dhaka',
  region_name: 'Dhaka',
  observed_at: '2026-08-10T00:00:00.000Z',
  temp_mean_c: '29.5', // PostgREST numeric columns arrive as strings
  temp_min_c: '25.1',
  temp_max_c: '34.2',
  humidity_pct: '80',
  precipitation_mm: '2.3',
  source: 'openweathermap',
};

const khulnaRow = {
  id: 2,
  region_id: '22222222-2222-4222-8222-222222222222',
  region_code: 'khulna',
  region_name: 'Khulna',
  observed_at: '2026-08-10T00:00:00.000Z',
  temp_mean_c: null,
  temp_min_c: null,
  temp_max_c: null,
  humidity_pct: null,
  precipitation_mm: null,
  source: null,
};

describe('GET /latest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('no regionCode: returns all regions ordered by region_name', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/region_latest_weather', body: [dhakaRow, khulnaRow] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await weatherApp().request('/latest', {}, fakeBindings());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(() => latestWeatherResponseSchema.parse(body)).not.toThrow();
    expect(body.observations).toHaveLength(2);
    expect(body.observations[0]).toEqual({
      regionId: dhakaRow.region_id,
      regionCode: 'dhaka',
      regionName: 'Dhaka',
      observedAt: dhakaRow.observed_at,
      tempMeanC: 29.5,
      tempMinC: 25.1,
      tempMaxC: 34.2,
      humidityPct: 80,
      precipitationMm: 2.3,
      source: 'openweathermap',
    });
    expect(body.observations[1].tempMeanC).toBeNull();

    const url = fake.calls.at(-1);
    expect(url?.pathname).toBe('/rest/v1/region_latest_weather');
    expect(url?.searchParams.get('order')).toBe('region_name.asc');
    expect(url?.searchParams.has('region_code')).toBe(false);
  });

  test('filters by regionCode', async () => {
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/region_latest_weather',
        match: (sp) => sp.get('region_code') === 'eq.dhaka',
        body: [dhakaRow],
      },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await weatherApp().request('/latest?regionCode=dhaka', {}, fakeBindings());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.observations).toHaveLength(1);
    expect(body.observations[0].regionCode).toBe('dhaka');

    const url = fake.calls.at(-1);
    expect(url?.searchParams.get('region_code')).toBe('eq.dhaka');
  });

  test('unknown regionCode: 200 with observations: []', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/region_latest_weather', body: [] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await weatherApp().request('/latest?regionCode=nowhere', {}, fakeBindings());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.observations).toEqual([]);
  });

  test('upstream failure: 503 with the generic body, no PostgREST detail leaked', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/region_latest_weather', body: postgrestErrorBody('permission denied for table region_latest_weather'), status: 500 },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await weatherApp().request('/latest', {}, fakeBindings());
    expect(res.status).toBe(503);
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.error.requestId).toBeTruthy();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('permission denied');
  });

  test('unexpected failure building the Supabase client (invalid SUPABASE_URL): 503 with the generic body', async () => {
    const res = await weatherApp().request('/latest', {}, fakeBindings({ SUPABASE_URL: INVALID_SUPABASE_URL }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.error.requestId).toBeTruthy();
  });

  test('carries the weather cache-control header', async () => {
    const fake = createFakeSupabase([{ path: '/rest/v1/region_latest_weather', body: [] }]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await weatherApp().request('/latest', {}, fakeBindings());
    expect(res.headers.get('cache-control')).toContain('s-maxage=900');
  });
});

describe('GET /history', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('missing regionCode: generic 400, no outgoing request', async () => {
    const fake = createFakeSupabase([]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await weatherApp().request('/history', {}, fakeBindings());
    expect(res.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });

  test('default window: filters by region_code and observed_at, ascending order', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/region_weather_observations', body: [dhakaRow] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await weatherApp().request('/history?regionCode=dhaka', {}, fakeBindings());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(() => weatherHistoryResponseSchema.parse(body)).not.toThrow();
    expect(body.windowDays).toBe(14);
    expect(body.points).toHaveLength(1);

    const url = fake.calls.at(-1);
    expect(url?.searchParams.get('region_code')).toBe('eq.dhaka');
    expect(url?.searchParams.get('order')).toBe('observed_at.asc');
    expect(url?.searchParams.get('observed_at')).toMatch(/^gte\./);
  });

  test('explicit days=3 narrows the window', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/region_weather_observations', body: [] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await weatherApp().request('/history?regionCode=dhaka&days=3', {}, fakeBindings());
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.windowDays).toBe(3);
  });

  test('days=999 clamps to the 14-day ceiling', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/region_weather_observations', body: [] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await weatherApp().request('/history?regionCode=dhaka&days=999', {}, fakeBindings());
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.windowDays).toBe(14);
  });

  test('unknown regionCode: 200 with points: [] and regionName falling back to the code', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/region_weather_observations', body: [] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await weatherApp().request('/history?regionCode=nowhere', {}, fakeBindings());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.points).toEqual([]);
    expect(body.regionName).toBe('nowhere');
  });

  test('upstream failure: 503 with the generic body', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/region_weather_observations', body: postgrestErrorBody(), status: 500 },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await weatherApp().request('/history?regionCode=dhaka', {}, fakeBindings());
    expect(res.status).toBe(503);
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.error.requestId).toBeTruthy();
  });

  test('unexpected failure building the Supabase client (invalid SUPABASE_URL): 503 with the generic body', async () => {
    const res = await weatherApp().request(
      '/history?regionCode=dhaka',
      {},
      fakeBindings({ SUPABASE_URL: INVALID_SUPABASE_URL })
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.error.requestId).toBeTruthy();
  });
});
