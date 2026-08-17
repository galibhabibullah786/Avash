import { describe, test, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { riskMapResponseSchema, riskDetailResponseSchema } from '@avash/types';
import { riskMap, riskDetail } from '../../src/routes/risk-map';
import { requestId } from '../../src/middleware/request-id';
import { createFakeSupabase, INVALID_SUPABASE_URL, postgrestErrorBody } from '../helpers/fakeSupabase';
import type { AppEnv, Bindings } from '../../src/types';

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

function riskMapApp() {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.route('/', riskMap);
  return app;
}

function riskDetailApp() {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.route('/', riskDetail);
  return app;
}

const REGION_ID = '11111111-1111-4111-8111-111111111111';

const geojsonRow = {
  region_id: REGION_ID,
  region_name: 'Dhaka',
  risk_score: '0.72',
  risk_level: 'high',
  horizon_weeks: 2,
  generated_at: '2026-08-10T00:00:00.000Z',
  geometry: { type: 'MultiPolygon', coordinates: [[[[90.4, 23.7], [90.5, 23.7], [90.5, 23.8], [90.4, 23.7]]]] },
  min_lon: 90.3,
  min_lat: 23.6,
  max_lon: 90.6,
  max_lat: 23.9,
};

const geojsonRowOlder = {
  ...geojsonRow,
  region_id: '22222222-2222-4222-8222-222222222222',
  region_name: 'Khulna',
  generated_at: '2026-08-01T00:00:00.000Z',
};

describe('GET /risk-map', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('no bbox: filters only by the default horizon', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/region_risk_geojson', body: [geojsonRow, geojsonRowOlder] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await riskMapApp().request('/', {}, fakeBindings());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(() => riskMapResponseSchema.parse(body)).not.toThrow();
    expect(body.horizonWeeks).toBe(2);
    expect(body.features).toHaveLength(2);
    // newest generated_at across returned features
    expect(body.generatedAt).toBe(geojsonRow.generated_at);

    const url = fake.calls.at(-1);
    expect(url?.searchParams.get('horizon_weeks')).toBe('eq.2');
    expect(url?.searchParams.has('max_lon')).toBe(false);
  });

  test('a null generated_at on a row never surfaces as the literal string "null"', async () => {
    const rowWithNullGeneratedAt = { ...geojsonRowOlder, generated_at: null };
    const fake = createFakeSupabase([
      { path: '/rest/v1/region_risk_geojson', body: [geojsonRow, rowWithNullGeneratedAt] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await riskMapApp().request('/', {}, fakeBindings());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(() => riskMapResponseSchema.parse(body)).not.toThrow();

    const nullRowFeature = body.features.find(
      (f: { properties: { regionId: string } }) => f.properties.regionId === rowWithNullGeneratedAt.region_id
    );
    expect(nullRowFeature.properties.generatedAt).not.toBe('null');
    // The real row (geojsonRow) still wins "newest" — the epoch sentinel
    // standing in for the null row must never win that comparison.
    expect(body.generatedAt).toBe(geojsonRow.generated_at);
  });

  test('bbox containing all seeded regions: carries exactly the four range filters', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/region_risk_geojson', body: [geojsonRow, geojsonRowOlder] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await riskMapApp().request('/?bbox=89,23,91,24', {}, fakeBindings());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.features).toHaveLength(2);

    const url = fake.calls.at(-1);
    expect(url?.searchParams.get('max_lon')).toBe('gte.89');
    expect(url?.searchParams.get('min_lon')).toBe('lte.91');
    expect(url?.searchParams.get('max_lat')).toBe('gte.23');
    expect(url?.searchParams.get('min_lat')).toBe('lte.24');
  });

  test('bbox containing no regions: 200 with features: []', async () => {
    const fake = createFakeSupabase([{ path: '/rest/v1/region_risk_geojson', body: [] }]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await riskMapApp().request('/?bbox=1,1,2,2', {}, fakeBindings());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.features).toEqual([]);
    expect(body.generatedAt).toBeNull();
  });

  test('malformed bbox: generic 400, no outgoing request', async () => {
    const fake = createFakeSupabase([]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await riskMapApp().request('/?bbox=not-a-bbox', {}, fakeBindings());
    expect(res.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });

  test('over-span bbox: generic 400', async () => {
    const fake = createFakeSupabase([]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await riskMapApp().request('/?bbox=-170,-80,170,80', {}, fakeBindings());
    expect(res.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });

  test('horizon=4: filters by the requested horizon', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/region_risk_geojson', match: (sp) => sp.get('horizon_weeks') === 'eq.4', body: [] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await riskMapApp().request('/?horizon=4', {}, fakeBindings());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.horizonWeeks).toBe(4);
  });

  test('horizon=3: generic 400', async () => {
    const fake = createFakeSupabase([]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await riskMapApp().request('/?horizon=3', {}, fakeBindings());
    expect(res.status).toBe(400);
  });

  test('upstream failure: 503 with the generic body', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/region_risk_geojson', body: postgrestErrorBody(), status: 500 },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await riskMapApp().request('/', {}, fakeBindings());
    expect(res.status).toBe(503);
  });

  test('unexpected failure building the Supabase client (invalid SUPABASE_URL): 503 with the generic body', async () => {
    const res = await riskMapApp().request('/', {}, fakeBindings({ SUPABASE_URL: INVALID_SUPABASE_URL }));
    expect(res.status).toBe(503);
  });
});

const predictionRow2Weeks = {
  id: 1,
  region_id: REGION_ID,
  prediction_date: '2026-08-10',
  horizon_weeks: 2,
  risk_score: '0.55',
  risk_level: 'moderate',
  top_factors: [{ feature: 'rainfall_14d', contribution: 0.3, direction: 'increases' }],
  model_version: 'stub-0.0.0',
  generated_at: '2026-08-10T00:00:00.000Z',
};

const predictionRow4Weeks = {
  ...predictionRow2Weeks,
  id: 2,
  horizon_weeks: 4,
  risk_score: '0.61',
  risk_level: 'high',
};

const regionRow = { id: REGION_ID, code: 'dhaka', name: 'Dhaka' };

const weatherRow = {
  id: 1,
  region_id: REGION_ID,
  region_code: 'dhaka',
  region_name: 'Dhaka',
  observed_at: '2026-08-10T00:00:00.000Z',
  temp_mean_c: '29.5',
  temp_min_c: '25.1',
  temp_max_c: '34.2',
  humidity_pct: '80',
  precipitation_mm: '2.3',
  source: 'openweathermap',
};

describe('GET /risk/:regionId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('malformed UUID: generic 400, no outgoing request', async () => {
    const fake = createFakeSupabase([]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await riskDetailApp().request('/not-a-uuid', {}, fakeBindings());
    expect(res.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });

  test('unknown UUID: 404 (no risk_predictions rows)', async () => {
    const fake = createFakeSupabase([{ path: '/rest/v1/risk_predictions', body: [] }]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await riskDetailApp().request(`/${REGION_ID}`, {}, fakeBindings());
    expect(res.status).toBe(404);
  });

  test('found, with weather: both horizons present, latestWeather populated', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/risk_predictions', body: [predictionRow4Weeks, predictionRow2Weeks] },
      { path: '/rest/v1/regions', body: [regionRow] },
      { path: '/rest/v1/region_latest_weather', body: [weatherRow] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await riskDetailApp().request(`/${REGION_ID}`, {}, fakeBindings());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(() => riskDetailResponseSchema.parse(body)).not.toThrow();
    expect(body.regionCode).toBe('dhaka');
    expect(body.regionName).toBe('Dhaka');
    expect(body.predictions).toHaveLength(2);
    expect(body.predictions.map((p: { horizonWeeks: number }) => p.horizonWeeks).sort()).toEqual([2, 4]);
    expect(body.predictions[0].isStub).toBe(true);
    expect(body.predictions[0].topFactors).toEqual([
      { feature: 'rainfall_14d', contribution: 0.3, direction: 'increases' },
    ]);
    expect(body.latestWeather).not.toBeNull();
    expect(body.latestWeather.tempMeanC).toBe(29.5);
  });

  test('found, without weather: latestWeather is null', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/risk_predictions', body: [predictionRow2Weeks] },
      { path: '/rest/v1/regions', body: [regionRow] },
      { path: '/rest/v1/region_latest_weather', body: [] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await riskDetailApp().request(`/${REGION_ID}`, {}, fakeBindings());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.latestWeather).toBeNull();
  });

  test('malformed top_factors: [] on the affected prediction', async () => {
    const badPrediction = { ...predictionRow2Weeks, top_factors: [{ feature: 'x' }] }; // missing contribution/direction
    const fake = createFakeSupabase([
      { path: '/rest/v1/risk_predictions', body: [badPrediction] },
      { path: '/rest/v1/regions', body: [regionRow] },
      { path: '/rest/v1/region_latest_weather', body: [] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await riskDetailApp().request(`/${REGION_ID}`, {}, fakeBindings());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.predictions[0].topFactors).toEqual([]);
  });

  test('upstream failure on predictions read: 503 with the generic body', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/risk_predictions', body: postgrestErrorBody(), status: 500 },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await riskDetailApp().request(`/${REGION_ID}`, {}, fakeBindings());
    expect(res.status).toBe(503);
  });

  test('upstream failure on region read: 503 with the generic body', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/risk_predictions', body: [predictionRow2Weeks] },
      { path: '/rest/v1/regions', body: postgrestErrorBody(), status: 500 },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await riskDetailApp().request(`/${REGION_ID}`, {}, fakeBindings());
    expect(res.status).toBe(503);
  });

  test('upstream failure on weather read: 503 with the generic body', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/risk_predictions', body: [predictionRow2Weeks] },
      { path: '/rest/v1/regions', body: [regionRow] },
      { path: '/rest/v1/region_latest_weather', body: postgrestErrorBody(), status: 500 },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await riskDetailApp().request(`/${REGION_ID}`, {}, fakeBindings());
    expect(res.status).toBe(503);
  });

  test('unexpected failure building the Supabase client (invalid SUPABASE_URL): 503 with the generic body', async () => {
    const res = await riskDetailApp().request(
      `/${REGION_ID}`,
      {},
      fakeBindings({ SUPABASE_URL: INVALID_SUPABASE_URL })
    );
    expect(res.status).toBe(503);
  });
});
