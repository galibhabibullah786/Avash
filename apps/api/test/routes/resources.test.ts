import { describe, test, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { hospitalsResponseSchema, bloodSearchResponseSchema, bloodAvailabilityDtoSchema } from '@avash/types';
import type { RateLimitRedisLike } from '@avash/security';
import { createResources } from '../../src/routes/resources';
import { requestId } from '../../src/middleware/request-id';
import { createFakeSupabase, INVALID_SUPABASE_URL, postgrestErrorBody } from '../helpers/fakeSupabase';
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
  app.route('/', createResources({ redisFactory: fakeRedis }));
  return app;
}

const HOSPITAL_X = '22222222-2222-4222-8222-222222222222';
const HOSPITAL_Y = '33333333-3333-4333-8333-333333333333';
const INVENTORY_ID = '11111111-1111-4111-8111-111111111111';

const hospitalRow = {
  id: HOSPITAL_X,
  name: 'Dhaka Medical College Hospital',
  address: 'Bakshibazar, Dhaka',
  phone: '+8801000000000',
  verified: true,
  updated_at: '2026-08-10T00:00:00.000Z',
  lon: 90.4,
  lat: 23.72,
};

const hospitalRowOutsideBbox = {
  ...hospitalRow,
  id: HOSPITAL_Y,
  name: 'Chittagong Medical College Hospital',
  lon: 91.8,
  lat: 22.35,
};

const bloodRow = {
  inventory_id: 1,
  hospital_id: HOSPITAL_X,
  hospital_name: hospitalRow.name,
  hospital_address: hospitalRow.address,
  hospital_phone: hospitalRow.phone,
  hospital_verified: hospitalRow.verified,
  hospital_lat: hospitalRow.lat,
  hospital_lon: hospitalRow.lon,
  blood_group: 'O+',
  units_available: 12,
  platelet_units: 3,
  updated_at: '2026-08-14T00:00:00.000Z',
  distance_m: 850.5,
};

const bloodRowFarther = {
  ...bloodRow,
  inventory_id: 2,
  hospital_id: HOSPITAL_Y,
  hospital_name: hospitalRowOutsideBbox.name,
  distance_m: 4200.1,
};

describe('GET /api/resources/hospitals', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('a valid bbox returns only schema-valid hospitals inside it, with the cache header', async () => {
    const fake = createFakeSupabase([{ path: '/rest/v1/hospital_locations', body: [hospitalRow] }]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request('/hospitals?bbox=89,23,91,24', {}, fakeBindings());
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    expect(() => hospitalsResponseSchema.parse(body)).not.toThrow();
    const parsed = hospitalsResponseSchema.parse(body);
    expect(parsed.hospitals).toHaveLength(1);
    expect(parsed.hospitals[0]?.id).toBe(HOSPITAL_X);
    expect(res.headers.get('cache-control')).toContain('s-maxage=60');
    expect(res.headers.get('cache-control')).toContain('stale-while-revalidate=120');

    const url = fake.calls.at(-1);
    expect(url?.searchParams.getAll('lon')).toEqual(['gte.89', 'lte.91']);
    expect(url?.searchParams.getAll('lat')).toEqual(['gte.23', 'lte.24']);
    expect(url?.searchParams.get('limit')).toBe('200');
  });

  test('a malformed bbox → 400', async () => {
    const res = await buildApp().request('/hospitals?bbox=not-a-bbox', {}, fakeBindings());
    expect(res.status).toBe(400);
  });

  test('a missing bbox → 400', async () => {
    const res = await buildApp().request('/hospitals', {}, fakeBindings());
    expect(res.status).toBe(400);
  });

  test('a bbox exceeding BBOX_MAX_SPAN_DEG → 400', async () => {
    const res = await buildApp().request('/hospitals?bbox=-170,-80,170,80', {}, fakeBindings());
    expect(res.status).toBe(400);
  });

  test('a Supabase error → 503, generic body', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/hospital_locations', body: postgrestErrorBody(), status: 500 },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request('/hospitals?bbox=89,23,91,24', {}, fakeBindings());
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { message: string } };
    expect(JSON.stringify(body).toLowerCase()).not.toContain('permission denied');
  });

  test('an unexpected failure building the Supabase client → 503', async () => {
    const res = await buildApp().request(
      '/hospitals?bbox=89,23,91,24',
      {},
      fakeBindings({ SUPABASE_URL: INVALID_SUPABASE_URL })
    );
    expect(res.status).toBe(503);
  });
});

describe('GET /api/resources/blood', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('a known group returns schema-valid results ordered by distance', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/rpc/blood_within_radius', body: [bloodRow, bloodRowFarther] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request('/blood?bloodGroup=O%2B&lat=23.78&lng=90.4', {}, fakeBindings());
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    expect(() => bloodSearchResponseSchema.parse(body)).not.toThrow();
    const parsed = bloodSearchResponseSchema.parse(body);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0]?.distanceM).toBeLessThan(parsed.results[1]?.distanceM ?? Infinity);
    expect(parsed.results[0]?.hospital.id).toBe(HOSPITAL_X);
  });

  test('an unknown blood group → 400', async () => {
    const res = await buildApp().request('/blood?bloodGroup=Z%2B&lat=23.78&lng=90.4', {}, fakeBindings());
    expect(res.status).toBe(400);
  });

  test('a missing lat/lng → 400', async () => {
    const res = await buildApp().request('/blood?bloodGroup=O%2B', {}, fakeBindings());
    expect(res.status).toBe(400);
  });

  test('an RPC error → 503, generic body', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/rpc/blood_within_radius', body: postgrestErrorBody(), status: 500 },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request('/blood?bloodGroup=O%2B&lat=23.78&lng=90.4', {}, fakeBindings());
    expect(res.status).toBe(503);
  });

  test('an unexpected failure building the Supabase client (invalid SUPABASE_URL) → 503', async () => {
    const res = await buildApp().request(
      '/blood?bloodGroup=O%2B&lat=23.78&lng=90.4',
      {},
      fakeBindings({ SUPABASE_URL: INVALID_SUPABASE_URL })
    );
    expect(res.status).toBe(503);
  });
});

describe('PATCH /api/resources/blood/:id', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('no token → 401', async () => {
    const res = await buildApp().request(
      `/blood/${INVENTORY_ID}`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unitsAvailable: 5, plateletUnits: 1 }) },
      fakeBindings()
    );
    expect(res.status).toBe(401);
  });

  test('authenticated, wildly implausible units → 400', async () => {
    const token = await signTestJwt({ role: 'hospital_staff' });
    const res = await buildApp().request(
      `/blood/${INVENTORY_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitsAvailable: 99999, plateletUnits: 1 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(400);
  });

  test('authenticated, negative units → 400', async () => {
    const token = await signTestJwt({ role: 'hospital_staff' });
    const res = await buildApp().request(
      `/blood/${INVENTORY_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitsAvailable: -1, plateletUnits: 1 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(400);
  });

  test('authenticated, malformed id → 400, not a database error', async () => {
    const token = await signTestJwt({ role: 'hospital_staff' });
    const res = await buildApp().request(
      '/blood/not-a-uuid',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitsAvailable: 5, plateletUnits: 1 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(400);
  });

  test('a citizen WITH a verified_hospital_staff row → 403 — the role claim gates before the row lookup', async () => {
    // The membership row exists and matches the target hospital, so the
    // handler's own staff check would pass. The request is refused anyway
    // because the token carries no `inventory:write` capability — this is
    // what makes revoking someone's hospital_staff role take effect
    // immediately, without having to also delete their membership rows.
    const userId = '44444444-4444-4444-8444-444444444444';
    const token = await signTestJwt({ sub: userId, role: 'citizen' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'GET',
        body: [{ id: 1, hospital_id: HOSPITAL_X }],
      },
      {
        path: '/rest/v1/verified_hospital_staff',
        body: [{ user_id: userId, hospital_id: HOSPITAL_X }],
      },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/blood/${INVENTORY_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitsAvailable: 5, plateletUnits: 1 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(403);
  });

  test('a moderator cannot write inventory — the roles are disjoint, not ranked', async () => {
    const token = await signTestJwt({ role: 'moderator' });
    const res = await buildApp().request(
      `/blood/${INVENTORY_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitsAvailable: 5, plateletUnits: 1 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(403);
  });

  test('authenticated non-staff (no verified_hospital_staff row anywhere) → 403', async () => {
    const userId = '44444444-4444-4444-8444-444444444444';
    const token = await signTestJwt({ sub: userId, role: 'hospital_staff' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'GET',
        body: [{ id: 1, hospital_id: HOSPITAL_X }],
      },
      { path: '/rest/v1/verified_hospital_staff', body: [] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/blood/${INVENTORY_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitsAvailable: 5, plateletUnits: 1 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(403);
  });

  test("staff at hospital X patching hospital Y's row → 403 — the authorization boundary itself", async () => {
    // The caller IS verified staff, but only at HOSPITAL_X. The target
    // inventory row belongs to HOSPITAL_Y. This is the specific case that
    // proves the handler checks the *row's* hospital, not merely "is this
    // user staff somewhere" — a bypass here would let any verified staff
    // member edit any hospital's blood stock.
    const userId = '55555555-5555-4555-8555-555555555555';
    const token = await signTestJwt({ sub: userId, role: 'hospital_staff' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'GET',
        body: [{ id: INVENTORY_ID, hospital_id: HOSPITAL_Y }],
      },
      {
        path: '/rest/v1/verified_hospital_staff',
        // Staff row exists for (userId, HOSPITAL_X) — never HOSPITAL_Y —
        // so the query filtered to HOSPITAL_Y must come back empty.
        match: (sp) => sp.get('hospital_id') === `eq.${HOSPITAL_Y}`,
        body: [],
      },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/blood/${INVENTORY_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitsAvailable: 5, plateletUnits: 1 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(403);
  });

  test('valid staff update → 200 with updated_by set, schema-valid body', async () => {
    const userId = '66666666-6666-4666-8666-666666666666';
    const token = await signTestJwt({ sub: userId, role: 'hospital_staff' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'GET',
        body: [{ id: 1, hospital_id: HOSPITAL_X }],
      },
      {
        path: '/rest/v1/verified_hospital_staff',
        body: [{ user_id: userId, hospital_id: HOSPITAL_X }],
      },
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'PATCH',
        body: [
          {
            id: 1,
            hospital_id: HOSPITAL_X,
            blood_group: 'O+',
            units_available: 20,
            platelet_units: 4,
            updated_by: userId,
            updated_at: '2026-08-15T00:00:00.000Z',
          },
        ],
      },
      { path: '/rest/v1/hospital_locations', body: [hospitalRow] },
      { path: '/rest/v1/audit_log', body: [{ id: 1 }] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/blood/${INVENTORY_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitsAvailable: 20, plateletUnits: 4 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    expect(() => bloodAvailabilityDtoSchema.parse(body)).not.toThrow();
    const parsed = bloodAvailabilityDtoSchema.parse(body);
    expect(parsed.unitsAvailable).toBe(20);
    expect(parsed.hospital.id).toBe(HOSPITAL_X);

    expect(fake.calls.some((u) => u.pathname === '/rest/v1/audit_log')).toBe(true);
  });

  test('a staff id that is not a UUID makes buildAuditEntry throw — still 200, isolated from the response', async () => {
    // auditEntrySchema requires actorId to be a UUID or null; a non-UUID
    // subject exercises the isolated try/catch around the audit write
    // without touching the network layer.
    const userId = 'not-a-uuid-staffer';
    const token = await signTestJwt({ sub: userId, role: 'hospital_staff' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'GET',
        body: [{ id: 1, hospital_id: HOSPITAL_X }],
      },
      {
        path: '/rest/v1/verified_hospital_staff',
        body: [{ user_id: userId, hospital_id: HOSPITAL_X }],
      },
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'PATCH',
        body: [
          {
            id: 1,
            hospital_id: HOSPITAL_X,
            blood_group: 'O+',
            units_available: 5,
            platelet_units: 1,
            updated_by: userId,
            updated_at: '2026-08-15T00:00:00.000Z',
          },
        ],
      },
      { path: '/rest/v1/hospital_locations', body: [hospitalRow] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/blood/${INVENTORY_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitsAvailable: 5, plateletUnits: 1 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(200);
  });

  test('target inventory row does not exist → 404', async () => {
    const token = await signTestJwt({ role: 'hospital_staff' });
    const fake = createFakeSupabase([
      { path: '/rest/v1/blood_inventory', match: (_sp, method) => method === 'GET', body: [] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/blood/${INVENTORY_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitsAvailable: 5, plateletUnits: 1 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(404);
  });

  test('inventory read fails → 503', async () => {
    const token = await signTestJwt({ role: 'hospital_staff' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'GET',
        body: postgrestErrorBody(),
        status: 500,
      },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/blood/${INVENTORY_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitsAvailable: 5, plateletUnits: 1 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(503);
  });

  test('staff read fails → 503', async () => {
    const token = await signTestJwt({ role: 'hospital_staff' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'GET',
        body: [{ id: 1, hospital_id: HOSPITAL_X }],
      },
      { path: '/rest/v1/verified_hospital_staff', body: postgrestErrorBody(), status: 500 },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/blood/${INVENTORY_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitsAvailable: 5, plateletUnits: 1 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(503);
  });

  test('the update itself fails → 503', async () => {
    const userId = '88888888-8888-4888-8888-888888888888';
    const token = await signTestJwt({ sub: userId, role: 'hospital_staff' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'GET',
        body: [{ id: 1, hospital_id: HOSPITAL_X }],
      },
      {
        path: '/rest/v1/verified_hospital_staff',
        body: [{ user_id: userId, hospital_id: HOSPITAL_X }],
      },
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'PATCH',
        body: postgrestErrorBody(),
        status: 500,
      },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/blood/${INVENTORY_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitsAvailable: 5, plateletUnits: 1 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(503);
  });

  test('the update reports no error but returns no row → 404', async () => {
    const userId = '12121212-1212-4121-8121-121212121212';
    const token = await signTestJwt({ sub: userId, role: 'hospital_staff' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'GET',
        body: [{ id: 1, hospital_id: HOSPITAL_X }],
      },
      {
        path: '/rest/v1/verified_hospital_staff',
        body: [{ user_id: userId, hospital_id: HOSPITAL_X }],
      },
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'PATCH',
        body: [],
      },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/blood/${INVENTORY_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitsAvailable: 5, plateletUnits: 1 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(404);
  });

  test('the post-update hospital lookup fails → 503', async () => {
    const userId = '99999999-9999-4999-8999-999999999999';
    const token = await signTestJwt({ sub: userId, role: 'hospital_staff' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'GET',
        body: [{ id: 1, hospital_id: HOSPITAL_X }],
      },
      {
        path: '/rest/v1/verified_hospital_staff',
        body: [{ user_id: userId, hospital_id: HOSPITAL_X }],
      },
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'PATCH',
        body: [
          {
            id: 1,
            hospital_id: HOSPITAL_X,
            blood_group: 'O+',
            units_available: 5,
            platelet_units: 1,
            updated_by: userId,
            updated_at: '2026-08-15T00:00:00.000Z',
          },
        ],
      },
      { path: '/rest/v1/hospital_locations', body: postgrestErrorBody(), status: 500 },
      { path: '/rest/v1/audit_log', body: [{ id: 1 }] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/blood/${INVENTORY_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitsAvailable: 5, plateletUnits: 1 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(503);
  });

  test('the post-update hospital lookup comes back empty: 200 with a placeholder hospital shape', async () => {
    const userId = '10101010-1010-4101-8101-101010101010';
    const token = await signTestJwt({ sub: userId, role: 'hospital_staff' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'GET',
        body: [{ id: 1, hospital_id: HOSPITAL_X }],
      },
      {
        path: '/rest/v1/verified_hospital_staff',
        body: [{ user_id: userId, hospital_id: HOSPITAL_X }],
      },
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'PATCH',
        body: [
          {
            id: 1,
            hospital_id: HOSPITAL_X,
            blood_group: 'O+',
            units_available: 5,
            platelet_units: 1,
            updated_by: userId,
            updated_at: '2026-08-15T00:00:00.000Z',
          },
        ],
      },
      { path: '/rest/v1/hospital_locations', body: [] },
      { path: '/rest/v1/audit_log', body: [{ id: 1 }] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    const res = await buildApp().request(
      `/blood/${INVENTORY_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitsAvailable: 5, plateletUnits: 1 }),
      },
      fakeBindings()
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    expect(() => bloodAvailabilityDtoSchema.parse(body)).not.toThrow();
    const parsed = bloodAvailabilityDtoSchema.parse(body);
    expect(parsed.hospital.id).toBe(HOSPITAL_X);
    expect(parsed.hospital.name).toBe('');
  });

  test('an unexpected failure building the Supabase client (invalid SUPABASE_URL) → 503', async () => {
    const token = await signTestJwt({ role: 'hospital_staff' });
    const res = await buildApp().request(
      `/blood/${INVENTORY_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unitsAvailable: 5, plateletUnits: 1 }),
      },
      fakeBindings({ SUPABASE_URL: INVALID_SUPABASE_URL })
    );
    expect(res.status).toBe(503);
  });

  test('rate limit exceeded → 429', async () => {
    const token = await signTestJwt({ sub: '77777777-7777-4777-8777-777777777777', role: 'hospital_staff' });
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'GET',
        body: [{ id: 1, hospital_id: HOSPITAL_X }],
      },
      { path: '/rest/v1/verified_hospital_staff', body: [{ user_id: 'x', hospital_id: HOSPITAL_X }] },
      {
        path: '/rest/v1/blood_inventory',
        match: (_sp, method) => method === 'PATCH',
        body: [
          {
            id: 1,
            hospital_id: HOSPITAL_X,
            blood_group: 'O+',
            units_available: 5,
            platelet_units: 1,
            updated_by: 'x',
            updated_at: '2026-08-15T00:00:00.000Z',
          },
        ],
      },
      { path: '/rest/v1/hospital_locations', body: [hospitalRow] },
      { path: '/rest/v1/audit_log', body: [{ id: 1 }] },
    ]);
    vi.stubGlobal('fetch', fake.fetch);

    // A single shared fake Redis instance across every request in this
    // loop — `fakeRedis()` builds a fresh in-memory store per call, so a
    // per-request factory (as `buildApp()` wires by default) would reset
    // the counter every time and this test would never observe a 429.
    const sharedRedis = fakeRedis();
    const app = new Hono<AppEnv>();
    app.use('*', requestId());
    app.route('/', createResources({ redisFactory: () => sharedRedis }));
    const env = fakeBindings();
    let last;
    for (let i = 0; i < 11; i += 1) {
      last = await app.request(
        `/blood/${INVENTORY_ID}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ unitsAvailable: 5, plateletUnits: 1 }),
        },
        env
      );
    }
    expect(last?.status).toBe(429);
  });
});
