import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

/**
 * Verifies the property `20260817000015_audit_log.sql` claims — append-only,
 * admin-readable, nothing else — against a real Postgres instance rather
 * than trusting the absence of a policy. A raw `pg` connection is used
 * (not PostgREST) so the test exercises RLS directly: it authenticates as
 * `postgres`, then per-check switches to the `anon` or `authenticated`
 * Postgres role and sets the `request.jwt.claims` GUC PostgREST would
 * normally set from a verified JWT, using `auth.uid()`/`auth.jwt()` — the
 * real functions Supabase Auth installs, not a stand-in.
 *
 * This deliberately targets the ADR-014 Supabase CLI local stack
 * (`pnpm docker:supabase`, port 54329, database `postgres`), not the
 * ADR-011 plain `db` container (port 54322, database `avash`): the latter
 * only carries `01-auth-shim.sql`'s two-column stand-in, which is enough
 * for policy-*shape* testing but cannot exercise `public.has_capability()`
 * / `public.app_role()` the way a real signed claim does.
 */
const DEFAULT_SUPABASE_LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54329/postgres';
const databaseUrl = process.env.SUPABASE_DB_URL_LOCAL?.trim() || DEFAULT_SUPABASE_LOCAL_DATABASE_URL;

let client: pg.Client | undefined;
let connectionError: string | undefined;

beforeAll(async () => {
  const candidate = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  try {
    await candidate.connect();
    client = candidate;
  } catch (error) {
    connectionError = error instanceof Error ? error.message : String(error);
  }
});

afterAll(async () => {
  await client?.end();
});

function requireDb(): pg.Client {
  if (!client) {
    throw new Error(
      `no local Supabase stack reachable at ${databaseUrl}: ${connectionError}. ` +
        `Run "pnpm docker:supabase && pnpm db:migrate" first (docs/docker.md § The local Supabase stack).`
    );
  }
  return client;
}

/**
 * `actor_id` is nullable and `on delete set null` (the migration's own
 * comment: "NULL only if the actor's account is later deleted; the row
 * survives it"), so the seed row deliberately carries no `actor_id` — a
 * real `auth.users` row would be an unrelated fixture dependency this
 * suite doesn't need. `CITIZEN_ID`/`ADMIN_ID` are only ever read out of the
 * `request.jwt.claims` GUC by `auth.uid()`/`public.app_role()`, never
 * foreign-keyed, so they don't need to exist in `auth.users` either.
 */
const CITIZEN_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_ID = '22222222-2222-2222-2222-222222222222';

/**
 * Runs `fn` inside its own transaction, switched to `role`, with
 * `request.jwt.claims` set to `claims` (the GUC PostgREST sets from a
 * verified JWT — `auth.uid()`/`auth.jwt()`/`public.app_role()` all read
 * it). Always rolled back, so no check can leak state into another.
 */
async function asRole<T>(
  db: pg.Client,
  role: 'anon' | 'authenticated',
  claims: Record<string, unknown> | null,
  fn: (db: pg.Client) => Promise<T>
): Promise<T> {
  await db.query('begin');
  try {
    await db.query(`set local role ${role}`);
    if (claims) {
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    }
    return await fn(db);
  } finally {
    await db.query('rollback');
  }
}

const citizenClaims = { sub: CITIZEN_ID, app_metadata: { role: 'citizen' } };
const adminClaims = { sub: ADMIN_ID, app_metadata: { role: 'admin' } };

describe('audit_log RLS (20260817000015_audit_log.sql)', () => {
  let seededId: number;

  beforeAll(async () => {
    const db = requireDb();
    const { rows } = await db.query(
      `insert into audit_log (actor_id, actor_role, action, entity_type, entity_id, outcome, request_id, detail)
       values (null, 'admin', 'role.assign', 'user', 'seed-user', 'success', 'seed-request', $1)
       returning id`,
      [JSON.stringify({ previousRole: 'citizen', newRole: 'moderator' })]
    );
    seededId = rows[0].id;
  });

  afterAll(async () => {
    const db = requireDb();
    // Cleans up as postgres, which bypasses RLS entirely.
    await db.query('delete from audit_log where id = $1', [seededId]);
  });

  it('exactly one policy exists on audit_log (a select-only policy)', async () => {
    const db = requireDb();
    const { rows } = await db.query(
      `select policyname, cmd from pg_policies where tablename = 'audit_log'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cmd).toBe('SELECT');
  });

  describe('anon — unauthenticated', () => {
    it('insert is refused', async () => {
      const db = requireDb();
      await expect(
        asRole(db, 'anon', null, (tx) =>
          tx.query(
            `insert into audit_log (action, entity_type, outcome) values ('role.assign', 'user', 'success')`
          )
        )
      ).rejects.toThrow(/row-level security policy/i);
    });

    it('update matches zero rows (RLS hides every row from the USING clause)', async () => {
      const db = requireDb();
      const result = await asRole(db, 'anon', null, (tx) =>
        tx.query(`update audit_log set outcome = 'failure' where id = $1`, [seededId])
      );
      expect(result.rowCount).toBe(0);
    });

    it('delete matches zero rows', async () => {
      const db = requireDb();
      const result = await asRole(db, 'anon', null, (tx) =>
        tx.query(`delete from audit_log where id = $1`, [seededId])
      );
      expect(result.rowCount).toBe(0);
    });

    it('select returns zero rows (no select policy covers anon)', async () => {
      const db = requireDb();
      const result = await asRole(db, 'anon', null, (tx) => tx.query(`select * from audit_log`));
      expect(result.rows).toHaveLength(0);
    });
  });

  describe('authenticated — signed in without roles:manage', () => {
    it('insert is refused', async () => {
      const db = requireDb();
      await expect(
        asRole(db, 'authenticated', citizenClaims, (tx) =>
          tx.query(
            `insert into audit_log (action, entity_type, outcome) values ('role.assign', 'user', 'success')`
          )
        )
      ).rejects.toThrow(/row-level security policy/i);
    });

    it('update matches zero rows', async () => {
      const db = requireDb();
      const result = await asRole(db, 'authenticated', citizenClaims, (tx) =>
        tx.query(`update audit_log set outcome = 'failure' where id = $1`, [seededId])
      );
      expect(result.rowCount).toBe(0);
    });

    it('delete matches zero rows', async () => {
      const db = requireDb();
      const result = await asRole(db, 'authenticated', citizenClaims, (tx) =>
        tx.query(`delete from audit_log where id = $1`, [seededId])
      );
      expect(result.rowCount).toBe(0);
    });

    it('select returns zero rows — has_capability(roles:manage) is false for citizen', async () => {
      const db = requireDb();
      const result = await asRole(db, 'authenticated', citizenClaims, (tx) =>
        tx.query(`select * from audit_log`)
      );
      expect(result.rows).toHaveLength(0);
    });
  });

  describe('authenticated — roles:manage (admin)', () => {
    it('select succeeds and returns the seeded row', async () => {
      const db = requireDb();
      const result = await asRole(db, 'authenticated', adminClaims, (tx) =>
        tx.query(`select id, action, outcome from audit_log where id = $1`, [seededId])
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].action).toBe('role.assign');
    });

    it('insert is still refused — read access is not write access', async () => {
      const db = requireDb();
      await expect(
        asRole(db, 'authenticated', adminClaims, (tx) =>
          tx.query(
            `insert into audit_log (action, entity_type, outcome) values ('role.assign', 'user', 'success')`
          )
        )
      ).rejects.toThrow(/row-level security policy/i);
    });

    it('update matches zero rows — no admin update policy exists, by design', async () => {
      const db = requireDb();
      const result = await asRole(db, 'authenticated', adminClaims, (tx) =>
        tx.query(`update audit_log set outcome = 'failure' where id = $1`, [seededId])
      );
      expect(result.rowCount).toBe(0);
    });

    it('delete matches zero rows — no admin delete policy exists, by design', async () => {
      const db = requireDb();
      const result = await asRole(db, 'authenticated', adminClaims, (tx) =>
        tx.query(`delete from audit_log where id = $1`, [seededId])
      );
      expect(result.rowCount).toBe(0);
    });
  });
});
