import { test, expect, type Page } from '@playwright/test';

/**
 * `useListQuery` + `DataTable` (`docs/features/platform-primitives.md`),
 * exercised through both transports this slice retrofits: `/moderation`
 * (PostgREST, sortable + filterable) and `/admin/users` (`apps/api`,
 * pagination-only — baseline fact 3: the Supabase Admin API cannot sort).
 * Route interception only, matching `apps/web/e2e/reports.spec.ts`'s
 * pattern — never a live `apps/api` or Supabase project.
 *
 * Per decision I: written and compile-checked
 * (`playwright test --list`) against the retrofit this slice specifies.
 * `Moderation.tsx`/`Users.tsx` in this worktree are still their
 * pre-retrofit versions (a hand-rolled `<table>`, prev/next state, no
 * `useSearchParams` wiring) — this spec starts passing once the branch
 * doing that retrofit (`docs/features/platform-primitives.md`) merges.
 * Selectors favor `aria-sort`/roles over exact column text so a markup
 * change that preserves the DataTable contract doesn't require touching
 * this file.
 */

const API_BASE = 'http://localhost:8787';
const SUPABASE_URL = 'https://kdklmbqkczkaakgswlix.supabase.co';

function fakeSession(role: 'moderator' | 'admin') {
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
      email: `e2e-${role}@example.test`,
      app_metadata: { role },
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
    },
  };
}

const SUPABASE_PROJECT_REF = 'kdklmbqkczkaakgswlix';
const STORAGE_KEY = `sb-${SUPABASE_PROJECT_REF}-auth-token`;

async function signInAs(page: Page, role: 'moderator' | 'admin') {
  await page.addInitScript(
    ([key, session]) => {
      window.localStorage.setItem(key as string, session as string);
    },
    [STORAGE_KEY, JSON.stringify(fakeSession(role))]
  );
}

function reportRow(id: string, createdAt: string, status = 'pending') {
  return {
    id,
    description: `report ${id}`,
    photo_url: null,
    ai_validation: null,
    status,
    created_at: createdAt,
  };
}

/** A PostgREST `.range()` read with `{ count: 'exact' }` needs a Content-Range response header to report the total. */
async function fulfillPostgrest(route: import('@playwright/test').Route, rows: unknown[], total: number) {
  await route.fulfill({
    status: 200,
    headers: { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${total}` },
    json: rows,
  });
}

test.describe('/moderation — sort + deep link (PostgREST transport)', () => {
  test('clicking a sortable column header updates the URL', async ({ page }) => {
    await signInAs(page, 'moderator');
    await page.route(`${SUPABASE_URL}/rest/v1/breeding_reports**`, (route) =>
      fulfillPostgrest(
        route,
        [reportRow('11111111-1111-4111-8111-111111111111', '2026-08-14T06:00:00.000Z')],
        1
      )
    );

    await page.goto('/moderation');

    const sortableHeader = page.locator('[aria-sort]').first();
    await expect(sortableHeader).toBeVisible();
    await sortableHeader.click();

    await expect(page).toHaveURL(/[?&]sort=/);
    await expect(page).toHaveURL(/[?&]dir=(asc|desc)/);
  });

  test('a deep-linked ?page=2&sort=createdAt&dir=desc renders without error', async ({ page }) => {
    await signInAs(page, 'moderator');
    await page.route(`${SUPABASE_URL}/rest/v1/breeding_reports**`, (route) =>
      fulfillPostgrest(
        route,
        [reportRow('22222222-2222-4222-8222-222222222222', '2026-08-10T06:00:00.000Z')],
        30
      )
    );

    await page.goto('/moderation?page=2&sort=createdAt&dir=desc');

    await expect(page.getByTestId('moderation-error')).toHaveCount(0);
    await expect(page.getByTestId('moderation-row').first()).toBeVisible();
  });
});

test.describe('/admin/users — pagination only (apps/api transport, page.total === null)', () => {
  function usersPage(page: number) {
    return {
      items: [
        {
          id: '00000000-0000-4000-8000-00000000000' + page,
          email: `user-page-${page}@example.test`,
          role: 'citizen',
          createdAt: '2026-08-01T00:00:00.000Z',
          lastSignInAt: null,
        },
      ],
      page: { page, pageSize: 50, total: null, hasNext: page < 2, sort: null, dir: 'asc' },
      requestId: `e2e-admin-users-${page}`,
    };
  }

  test('the back button restores the previous page after navigating next', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.route(`${API_BASE}/api/admin/users**`, (route) => {
      const url = new URL(route.request().url());
      const requestedPage = Number(url.searchParams.get('page') ?? '1');
      return route.fulfill({ status: 200, json: usersPage(requestedPage) });
    });

    await page.goto('/admin/users?page=1');
    await expect(page.getByTestId('admin-users-row').first()).toContainText('user-page-1');

    await page.getByRole('button', { name: /next/i }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(page.getByTestId('admin-users-row').first()).toContainText('user-page-2');

    await page.goBack();
    await expect(page).toHaveURL(/[?&]page=1/);
    await expect(page.getByTestId('admin-users-row').first()).toContainText('user-page-1');
  });

  test('a deep-linked ?page=2 renders directly, and the range label omits a total', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.route(`${API_BASE}/api/admin/users**`, (route) =>
      route.fulfill({ status: 200, json: usersPage(2) })
    );

    await page.goto('/admin/users?page=2');

    await expect(page.getByTestId('admin-users-row').first()).toBeVisible();
    // decision A: page.total is null for this route, so the footer must
    // never fabricate a total — asserting the literal " of " count phrase
    // is absent is the negative-space check for that.
    await expect(page.getByTestId('admin-users-table')).not.toContainText(/ of \d+/);
  });
});
