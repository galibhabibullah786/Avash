import { test, expect } from '@playwright/test';
import { SignJWT } from 'jose';
import { managedUserSchema, paginatedResponseSchema } from '@avash/types';

/**
 * Boundary/contract suite only — real HTTP against a live server
 * (ADR-012, API_TEST_TARGET=container). The exhaustive case matrix
 * (self-demotion 409, `app_metadata` merge, audit-write-fails-but-grant-
 * stands, etc.) lives in `apps/api/test/routes/admin-users.test.ts` under
 * workerd Vitest — this proves the new list-query envelope once, over the
 * wire, against the frozen contract
 * (`packages/types/pagination.ts` + `managedUserSchema`).
 *
 * Per decision I: written and compile-checked here
 * (`playwright test --list`); this worktree's `apps/api/src/routes/admin-users.ts`
 * still returns the pre-slice `{ users, nextPage, requestId }` shape, so a
 * live run against it would fail by construction until the branch
 * implementing `A-T04`'s pagination retrofit (see
 * `docs/features/platform-primitives.md`) merges — that is expected here,
 * not a defect this spec should chase.
 *
 * A JWT is signed locally against the same `SUPABASE_JWT_SECRET`
 * `wrangler dev` loads from `.dev.vars`, the same pattern
 * `apps/api/e2e/reports.spec.ts` uses.
 */

const JWT_SECRET =
  process.env.E2E_SUPABASE_JWT_SECRET ??
  'xm9NRM47B37/2RT88AsL1l/ce2MNLRR8zYm1E0edV9Cj9hs8FK9lhSeOA9riwPZljG49Vwf3O/4FR2ed0QW+UA==';

async function signJwt(role: 'admin' | undefined, sub: string): Promise<string> {
  const key = new TextEncoder().encode(JWT_SECRET);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: `${sub}@example.test`, app_metadata: role ? { role } : {} })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
}

const adminUserListResponseSchema = paginatedResponseSchema(managedUserSchema);

test.describe('GET /api/admin/users', () => {
  test('no token → 401', async ({ request }) => {
    const res = await request.get('/api/admin/users');
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error?.message).toBeTruthy();
  });

  test('authenticated, non-admin role → 403', async ({ request }) => {
    const token = await signJwt(undefined, 'e2e-admin-users-non-admin');
    const res = await request.get('/api/admin/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(403);
  });

  test('?pageSize=101 clamps or 400s — never a raw 500', async ({ request }) => {
    const token = await signJwt('admin', `e2e-admin-users-pagesize-${Date.now()}`);
    const res = await request.get('/api/admin/users?pageSize=101', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body).toLowerCase()).not.toContain('stack');
  });

  test('?sort=email → 400 — the Admin API has no sortable columns (listQueryFor([]))', async ({ request }) => {
    const token = await signJwt('admin', `e2e-admin-users-sort-${Date.now()}`);
    const res = await request.get('/api/admin/users?sort=email', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
  });

  test('a valid admin request returns the shared paginated envelope with page.total === null', async ({
    request,
  }) => {
    const token = await signJwt('admin', `e2e-admin-users-list-${Date.now()}`);
    const res = await request.get('/api/admin/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(() => adminUserListResponseSchema.parse(body)).not.toThrow();
    const parsed = adminUserListResponseSchema.parse(body);
    // Baseline fact 3: the Supabase Admin API cannot count (decision A).
    expect(parsed.page.total).toBeNull();
  });
});
