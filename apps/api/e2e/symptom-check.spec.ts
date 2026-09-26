import { test, expect } from '@playwright/test';
import { symptomCheckResponseSchema } from '@avash/types';

/**
 * Boundary/contract suite only — real HTTP against a live server, on both
 * runtimes (ADR-012, API_TEST_TARGET=container). This route (unlike the
 * still-stubbed weather/risk-map ones this pattern was copied from) is
 * fully implemented: a well-formed request always produces a schema-valid
 * 200, whether or not the live GEMINI_API_KEY / Upstash credentials behind
 * `wrangler dev`'s `.dev.vars` succeed — ADR-004's deterministic fallback
 * means there is no code path here that 500s just because an upstream
 * dependency is unavailable. Exhaustive branch coverage (quota exhausted,
 * Gemini failure, checklist-merge priority, prompt-injection safety) lives
 * in the workerd Vitest suite (`apps/api/test/routes/symptom-check.test.ts`);
 * this suite proves the contract once, over the wire.
 */

test.describe('POST /api/symptom-check', () => {
  test('a well-formed request returns a schema-valid 200 over real HTTP', async ({ request }) => {
    const res = await request.post('/api/symptom-check', {
      data: { qaPairs: [], checklist: { fever: true, rash: true, severeAbdominalPain: false, persistentVomiting: false, mucosalBleeding: false, lethargyOrRestlessness: false, liverEnlargement: false, fluidAccumulation: false, nauseaOrVomiting: false, achesAndPains: false, positiveTourniquetTest: false, leukopenia: false } },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(() => symptomCheckResponseSchema.parse(body)).not.toThrow();
  });

  test('an empty body is valid per the frozen contract and still returns a schema-valid 200', async ({
    request,
  }) => {
    const res = await request.post('/api/symptom-check', { data: { qaPairs: [], checklist: { fever: false, severeAbdominalPain: false, persistentVomiting: false, mucosalBleeding: false, lethargyOrRestlessness: false, liverEnlargement: false, fluidAccumulation: false, nauseaOrVomiting: false, rash: false, achesAndPains: false, positiveTourniquetTest: false, leukopenia: false } } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(() => symptomCheckResponseSchema.parse(body)).not.toThrow();
    expect(body.outcome).toBe('monitor');
  });


  test('a disallowed CORS origin gets no Access-Control-Allow-Origin header', async ({ request }) => {
    const res = await request.post('/api/symptom-check', {
      data: { qaPairs: [], checklist: { fever: false, severeAbdominalPain: false, persistentVomiting: false, mucosalBleeding: false, lethargyOrRestlessness: false, liverEnlargement: false, fluidAccumulation: false, nauseaOrVomiting: false, rash: false, achesAndPains: false, positiveTourniquetTest: false, leukopenia: false } },
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.headers()['access-control-allow-origin']).toBeUndefined();
  });
});
