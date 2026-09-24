import { test, expect } from '@playwright/test';
import { SignJWT } from 'jose';
import { uploadSignatureResponseSchema } from '@avash/types';

/**
 * Boundary/contract suite only — real HTTP against a live server
 * (ADR-012, API_TEST_TARGET=container), mirroring
 * `apps/api/e2e/resources.spec.ts`'s shape. The exhaustive case matrix
 * (every purpose, every rate-limit edge, the exact signed-parameter set)
 * lives in the workerd Vitest suite (`apps/api/test/routes/uploads.test.ts`),
 * not here — this proves each boundary once, over the wire, against the
 * frozen contract (`packages/types/uploads.ts`, ADR-015).
 *
 * Per decision I (`temp/platform-foundation.md` is gitignored; see
 * `docs/features/platform-primitives.md` for the durable version of that
 * reasoning): this spec is written and compile-checked
 * (`playwright test --list`) in this worktree, and runs for real only
 * once the branch implementing `POST /api/uploads/signature` for real is
 * merged — the route in this worktree is still Phase 0's `501` stub, so a
 * live run here would fail by construction, not by a defect this spec
 * should chase.
 *
 * A JWT is signed locally against the same `SUPABASE_JWT_SECRET`
 * `wrangler dev` loads from `.dev.vars`, the same pattern
 * `apps/api/e2e/reports.spec.ts` and `apps/api/test/helpers/fakeJwt.ts`
 * use.
 */

const JWT_SECRET =
  process.env.E2E_SUPABASE_JWT_SECRET ??
  'xm9NRM47B37/2RT88AsL1l/ce2MNLRR8zYm1E0edV9Cj9hs8FK9lhSeOA9riwPZljG49Vwf3O/4FR2ed0QW+UA==';

async function signJwt(sub: string): Promise<string> {
  const key = new TextEncoder().encode(JWT_SECRET);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: `${sub}@example.test`, app_metadata: { role: 'citizen' } })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
}

test.describe('POST /api/uploads/signature', () => {
  test('no token → 401', async ({ request }) => {
    const res = await request.post('/api/uploads/signature', {
      data: { purpose: 'avatar' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error?.message).toBeTruthy();
    expect(body.error?.requestId).toBeTruthy();
    expect(JSON.stringify(body).toLowerCase()).not.toContain('stack');
  });

  test('an unknown purpose is a generic 400', async ({ request }) => {
    const token = await signJwt(`e2e-uploads-${Date.now()}`);
    const res = await request.post('/api/uploads/signature', {
      headers: { Authorization: `Bearer ${token}` },
      data: { purpose: 'not-a-real-purpose' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body).toLowerCase()).not.toContain('stack');
  });

  test('a valid request returns a schema-valid 200 whose folder ignores any client-supplied value', async ({
    request,
  }) => {
    const token = await signJwt(`e2e-uploads-${Date.now()}`);
    const res = await request.post('/api/uploads/signature', {
      headers: { Authorization: `Bearer ${token}` },
      // `folder` here is an attempted override — decision H says the
      // server derives it from `purpose` alone and never reads this.
      data: { purpose: 'avatar', folder: 'attacker-controlled/path' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(() => uploadSignatureResponseSchema.parse(body)).not.toThrow();
    const parsed = uploadSignatureResponseSchema.parse(body);
    expect(parsed.folder).not.toBe('attacker-controlled/path');
    expect(parsed.folder.startsWith('avash/avatars/')).toBe(true);
  });

  test('a disallowed CORS origin gets no Access-Control-Allow-Origin header', async ({ request }) => {
    const token = await signJwt(`e2e-uploads-cors-${Date.now()}`);
    const res = await request.post('/api/uploads/signature', {
      headers: { Origin: 'https://evil.example', Authorization: `Bearer ${token}` },
      data: { purpose: 'avatar' },
    });
    expect(res.headers()['access-control-allow-origin']).toBeUndefined();
  });
});
