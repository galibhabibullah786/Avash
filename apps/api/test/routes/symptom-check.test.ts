import { describe, test, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { RateLimitRedisLike, QuotaGuardRedisLike } from '@avash/security';
import type { SymptomCheckResponse } from '@avash/types';
import { createSymptomCheck } from '../../src/routes/symptom-check';
import { requestId } from '../../src/middleware/request-id';
import type { AppEnv } from '../../src/types';

async function readSuccess(res: Response): Promise<SymptomCheckResponse> {
  return (await res.json()) as SymptomCheckResponse;
}

/** A shared in-memory fake so the minute+day rate-limit checks and the Gemini quota
 * guard can all be driven from one object, mirroring the real Upstash client's
 * ability to serve both. `startingQuotaCount` lets a test simulate an
 * already-exhausted daily quota. */
function fakeRedis(startingQuotaCount = 0): RateLimitRedisLike & QuotaGuardRedisLike {
  const sets = new Map<string, Map<string, number>>();
  let quotaCount = startingQuotaCount;
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
    async incr() {
      quotaCount += 1;
      return quotaCount;
    },
  };
}

/** Rate-limiting (zadd/zcard/expire) succeeds normally, but the Gemini quota
 * guard's own command (incr) fails — isolates "the guard call itself fails"
 * from the rate-limit middleware's own (separately tested) fail-closed 429. */
function buildApp(redisFactory: () => RateLimitRedisLike & QuotaGuardRedisLike) {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.route('/', createSymptomCheck({ redisFactory }));
  return app;
}

const env = { GEMINI_API_KEY: 'test-gemini-key' } as never;

const emptyChecklistPayload = {
  fever: false,
  severeAbdominalPain: false,
  persistentVomiting: false,
  mucosalBleeding: false,
  lethargyOrRestlessness: false,
  liverEnlargement: false,
  fluidAccumulation: false,
  nauseaOrVomiting: false,
  rash: false,
  achesAndPains: false,
  positiveTourniquetTest: false,
  leukopenia: false,
};

describe('POST /api/symptom-check', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('a missing/malformed body → generic 400, never throws', async () => {
    const app = buildApp(() => fakeRedis());
    const res = await app.request('/', { method: 'POST', body: 'not json' }, env);
    expect(res.status).toBe(400);
  });

  test('an empty body ({}) is valid per the frozen contract → 200 monitor', async () => {
    const app = buildApp(() => fakeRedis());
    const res = await app.request(
      '/',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ qaPairs: [], checklist: emptyChecklistPayload }) },
      env
    );
    expect(res.status).toBe(200);
    const body = await readSuccess(res);
    expect(body.outcome).toBe('monitor');
  });

  test('guidance is always one of the three fixed strings', async () => {
    const app = buildApp(() => fakeRedis());
    const res = await app.request(
      '/',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ qaPairs: [], checklist: { ...emptyChecklistPayload, severeAbdominalPain: true } }),
      },
      env
    );
    const body = await readSuccess(res);
    const knownGuidance = [
      'Your answers include warning signs that can indicate severe dengue. Please go to the nearest hospital or emergency department now, or call for emergency help.',
      'Your answers suggest you should see a doctor within the next 24 hours. Keep resting, drink fluids, and avoid aspirin or ibuprofen in the meantime.',
      'Your answers do not currently suggest an urgent warning sign. Rest, stay hydrated, and keep watching for new or worsening symptoms — check again if anything changes.',
    ];
    expect(knownGuidance).toContain(body.guidance);
  });

  test('a severe sign alone (no fever, no consult criteria) still triggers emergency end-to-end', async () => {
    const app = buildApp(() => fakeRedis());
    const res = await app.request(
      '/',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ qaPairs: [], checklist: { ...emptyChecklistPayload, mucosalBleeding: true } }),
      },
      env
    );
    const body = await readSuccess(res);
    expect(body.outcome).toBe('emergency');
  });
});
