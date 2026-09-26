import { test, expect, type Page } from '@playwright/test';

/**
 * No credentials for a seeded Supabase test user are available in this
 * worktree, so a signed-in session is driven by pre-loading the exact
 * localStorage entry `@supabase/supabase-js` itself writes after a real
 * sign-in (`sb-<project-ref>-auth-token`, verified against
 * `SupabaseClient.ts`'s `defaultStorageKey` derivation and
 * `GoTrueClient.ts`'s `_saveSession`, which stores the `Session` object
 * verbatim under that key with no wrapper). This is deterministic and
 * network-free — see docs/features/authentication.md for why this was
 * chosen over `page.route` interception of the GoTrue REST API.
 *
 * The project ref is hardcoded here (not read from `apps/web/.env`) since
 * that file is gitignored and doesn't exist in CI's `e2e-web` job, which
 * runs against a pre-built `dist/` with no `.env` step. The Supabase
 * project URL itself is public/non-secret (RLS, not secrecy, is the real
 * access gate — §4.1), so hardcoding it is safe.
 */
const SUPABASE_PROJECT_REF = 'kdklmbqkczkaakgswlix';
const STORAGE_KEY = `sb-${SUPABASE_PROJECT_REF}-auth-token`;

type E2ERole = 'citizen' | 'moderator' | 'moderator' | 'admin' | null;

function fakeSession(role: E2ERole) {
  return {
    access_token: 'e2e-fake-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'e2e-fake-refresh-token',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'e2e-user@example.test',
      app_metadata: role ? { role } : {},
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
    },
  };
}

/** Seeds a session so the app boots already "signed in", no network call. */
async function signInAs(page: Page, role: E2ERole) {
  await page.addInitScript(
    ([key, session]) => {
      window.localStorage.setItem(key as string, JSON.stringify(session));
    },
    [STORAGE_KEY, fakeSession(role)]
  );
}

/**
 * Replaces `window.localStorage` with a version whose `getItem` resolves
 * after `delayMs` — `@avash/security`'s Worker-side auth is untouched by
 * this, it only slows this browser tab's read of its own seeded session,
 * widening the window in which `SessionProvider`'s `status` is `loading`
 * so it can be observed deterministically instead of racing a sub-100ms
 * transition. Verified against `supportsLocalStorage()` in
 * `@supabase/auth-js`'s `helpers.ts`, which only probes `setItem`/
 * `removeItem` before adopting `globalThis.localStorage`, and
 * `getItemAsync()`, which `await`s whatever `storage.getItem` returns —
 * a Promise-returning `getItem` is honored, not just a synchronous one.
 */
async function signInWithDelayedSessionRead(page: Page, role: E2ERole, delayMs: number) {
  await page.addInitScript(
    ([key, session, delay]) => {
      const backing = new Map<string, string>();
      backing.set(key as string, JSON.stringify(session));
      const fakeStorage = {
        getItem: (k: string) =>
          new Promise((resolve) => {
            setTimeout(() => resolve(backing.has(k) ? (backing.get(k) as string) : null), delay as number);
          }),
        setItem: (k: string, v: string) => {
          backing.set(k, v);
        },
        removeItem: (k: string) => {
          backing.delete(k);
        },
        clear: () => backing.clear(),
        key: (i: number) => Array.from(backing.keys())[i] ?? null,
        get length() {
          return backing.size;
        },
      } as unknown as Storage;
      // `window.localStorage` is a getter-only accessor — plain assignment
      // is a silent no-op in sloppy-mode injected scripts, so the override
      // must go through defineProperty or it never takes effect.
      Object.defineProperty(window, 'localStorage', {
        value: fakeStorage,
        configurable: true,
        writable: true,
      });
    },
    [STORAGE_KEY, fakeSession(role), delayMs]
  );
}

test.describe('authentication', () => {
  test('visiting /moderation signed out lands on /login', async ({ page }) => {
    await page.goto('/moderation');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('signing in as a non-moderator and visiting /moderation shows the no-access page and stays on the URL', async ({
    page,
  }) => {
    await signInAs(page, null);
    await page.goto('/moderation');

    await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
    await expect(page).toHaveURL(/\/moderation$/);
  });

  test('the moderation nav link is absent for a non-moderator', async ({ page }) => {
    await signInAs(page, null);
    await page.goto('/');

    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Moderation' })).toHaveCount(0);
  });

  test('the moderation nav link is present for a moderator', async ({ page }) => {
    await signInAs(page, 'moderator');
    await page.goto('/');

    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Moderation' })).toBeVisible();
  });

  test('a protected page renders no data before the session resolves', async ({ page }) => {
    await signInWithDelayedSessionRead(page, 'moderator', 800);
    await page.goto('/moderation');

    // Immediately after the navigation settles, SessionProvider's status
    // is still "loading" (the seeded session read is deliberately
    // stalled) — ProtectedRoute must render null, not the page's content
    // and not a redirect to /login.
    await expect(page.getByText('Moderation', { exact: true })).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Access restricted' })).not.toBeVisible();
    await expect(page).toHaveURL(/\/moderation$/);

    // Once the delayed session read resolves, the moderator sees the
    // real page.
    await expect(page.getByText('Moderation', { exact: true })).toBeVisible();
  });
});
