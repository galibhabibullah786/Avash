import { test, expect, type Page } from '@playwright/test';

/**
 * Role-based access control in a real browser (docs/features/rbac.md).
 * Sessions are seeded through the same localStorage mechanism
 * `auth.spec.ts` documents at length — the exact entry
 * `@supabase/supabase-js` writes after a real sign-in — so these specs
 * make no network call to GoTrue and no assumption about a seeded user
 * existing.
 *
 * These assert the **UI affordance** layer only: which pages render and
 * which links appear. That layer is explicitly not a security boundary —
 * the Worker's `auth` middleware and RLS are, and they are covered by
 * `apps/api/test/**` instead. A spec here passing tells you a moderator
 * is not shown the admin console; it does not tell you they cannot call
 * the endpoint, which is a different test in a different suite.
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

async function signInAs(page: Page, role: E2ERole) {
  await page.addInitScript(
    ([key, session]) => {
      window.localStorage.setItem(key as string, JSON.stringify(session));
    },
    [STORAGE_KEY, fakeSession(role)]
  );
}

test.describe('role dashboards', () => {
  test('signed out, /dashboard redirects to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a signed-in user with no role claim gets the citizen dashboard', async ({ page }) => {
    await signInAs(page, null);
    await page.goto('/dashboard');

    await expect(page.getByTestId('dashboard-role')).toHaveText('Citizen');
    await expect(page.getByTestId('dashboard-title')).toHaveText('Your dashboard');
  });

  test('each role lands on its own dashboard', async ({ page }) => {
    const cases: { role: Exclude<E2ERole, null>; title: string; label: string }[] = [
      { role: 'citizen', title: 'Your dashboard', label: 'Citizen' },
      { role: 'moderator', title: 'Hospital dashboard', label: 'Hospital staff' },
      { role: 'moderator', title: 'Moderator dashboard', label: 'Moderator' },
      { role: 'admin', title: 'Admin dashboard', label: 'Administrator' },
    ];

    for (const { role, title, label } of cases) {
      await page.context().clearCookies();
      await signInAs(page, role);
      await page.goto('/dashboard');
      await expect(page.getByTestId('dashboard-title')).toHaveText(title);
      await expect(page.getByTestId('dashboard-role')).toHaveText(label);
    }
  });

  test('the citizen dashboard offers no moderation or admin tile', async ({ page }) => {
    await signInAs(page, 'citizen');
    await page.goto('/dashboard');

    const tiles = page.getByTestId('dashboard-tiles');
    await expect(tiles.getByRole('link', { name: 'Moderation queue' })).toHaveCount(0);
    await expect(tiles.getByRole('link', { name: 'Users & roles' })).toHaveCount(0);
    await expect(tiles.getByRole('link', { name: 'Check symptoms' })).toBeVisible();
  });

  test('the moderator dashboard offers the queue but not role management', async ({ page }) => {
    await signInAs(page, 'moderator');
    await page.goto('/dashboard');

    const tiles = page.getByTestId('dashboard-tiles');
    await expect(tiles.getByRole('link', { name: 'Moderation queue' })).toBeVisible();
    await expect(tiles.getByRole('link', { name: 'Users & roles' })).toHaveCount(0);
  });

  test('the admin dashboard offers role management', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.goto('/dashboard');

    await expect(
      page.getByTestId('dashboard-tiles').getByRole('link', { name: 'Users & roles' })
    ).toBeVisible();
  });
});

test.describe('route guards', () => {
  test('a moderator visiting /moderation gets the no-access page, URL unchanged', async ({ page }) => {
    await signInAs(page, 'moderator');
    await page.goto('/moderation');

    await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
    await expect(page).toHaveURL(/\/moderation$/);
  });

  test('a moderator visiting /admin/users gets the no-access page — roles:manage is admin-only', async ({
    page,
  }) => {
    await signInAs(page, 'moderator');
    await page.goto('/admin/users');

    await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/users$/);
  });

  test('an admin reaches /admin/users', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.goto('/admin/users');

    await expect(page.getByRole('heading', { name: 'Users & roles' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Access restricted' })).toHaveCount(0);
  });

  test('a moderator still reaches /moderation', async ({ page }) => {
    await signInAs(page, 'moderator');
    await page.goto('/moderation');

    await expect(page.getByRole('heading', { name: 'Moderation queue' })).toBeVisible();
  });
});

test.describe('navigation reflects capability', () => {
  test('signed out shows neither Dashboard, Moderation, nor Users', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });

    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Moderation' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Sign in' })).toBeVisible();
  });

  test('a citizen sees Dashboard but neither Moderation nor Users', async ({ page }) => {
    await signInAs(page, 'citizen');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });

    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Moderation' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0);
  });

  test('a moderator sees Moderation but not Users', async ({ page }) => {
    await signInAs(page, 'moderator');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });

    await expect(nav.getByRole('link', { name: 'Moderation' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0);
  });

  test('an admin sees both', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });

    await expect(nav.getByRole('link', { name: 'Moderation' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Users' })).toBeVisible();
  });

  test('a role claimed via user_metadata grants nothing — only app_metadata is read', async ({ page }) => {
    // The exact escalation attempt the threat model calls out: Supabase
    // lets a signed-in user write their own user_metadata.
    await page.addInitScript(
      ([key]) => {
        const session = {
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
            app_metadata: {},
            user_metadata: { role: 'admin' },
            identities: [],
            created_at: new Date().toISOString(),
          },
        };
        window.localStorage.setItem(key as string, JSON.stringify(session));
      },
      [STORAGE_KEY]
    );

    await page.goto('/dashboard');
    await expect(page.getByTestId('dashboard-role')).toHaveText('Citizen');

    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0);

    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
  });
});
