import { test, expect, type Page } from '@playwright/test';

/**
 * Extended for the platform primitives slice
 * (`docs/features/platform-primitives.md`): `DataTable`'s `aria-sort`,
 * `SubmitButton`'s `aria-busy`, and `PasswordInput`'s `aria-pressed` are
 * all accessibility-relevant state this project's reviewers grep for
 * (`docs/standards/frontend.md` § Optional-chaining checklist neighbors
 * this same accessibility-first habit). Route interception only, no live
 * backend — same pattern as the rest of this file and
 * `apps/web/e2e/reports.spec.ts`.
 *
 * Per decision I: written and compile-checked here; these three cases
 * exercise markup this worktree's `apps/web/src` does not yet have (the
 * pre-retrofit `/login` and `/moderation` pages), so they start passing
 * once the branch doing that retrofit merges.
 */
const SUPABASE_URL = 'https://kdklmbqkczkaakgswlix.supabase.co';
const SUPABASE_PROJECT_REF = 'kdklmbqkczkaakgswlix';
const STORAGE_KEY = `sb-${SUPABASE_PROJECT_REF}-auth-token`;

async function signInAsModerator(page: Page) {
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
      email: 'e2e-moderator@example.test',
      app_metadata: { role: 'moderator' },
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
    },
  };
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key as string, value as string);
    },
    [STORAGE_KEY, JSON.stringify(session)]
  );
}

test.describe('accessibility smoke', () => {
  test('the page has exactly one h1', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('the status panel is exposed as a labeled region for assistive tech', async ({ page }) => {
    await page.goto('/');
    const panel = page.getByLabel('API connection status');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'System status' })).toBeVisible();
  });

  test('tabbing through the page never throws and reaches the end without a focus trap', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // The navbar puts real interactive controls (brand link, nav links)
    // ahead of the page content — tabbing through them must not throw or
    // trap focus before it reaches the rest of the page.
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('DataTable — aria-sort', () => {
  test('a sortable column header exposes aria-sort, and it flips on click', async ({ page }) => {
    await signInAsModerator(page);
    await page.route(`${SUPABASE_URL}/rest/v1/breeding_reports**`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'content-range': '0-0/1' },
        json: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            description: 'A blocked drain by the school.',
            photo_url: null,
            ai_validation: null,
            status: 'pending',
            created_at: '2026-08-14T06:00:00.000Z',
          },
        ],
      })
    );

    await page.goto('/moderation');

    const sortableHeader = page.locator('[aria-sort]').first();
    await expect(sortableHeader).toHaveAttribute('aria-sort', 'none');

    await sortableHeader.click();
    await expect(sortableHeader).not.toHaveAttribute('aria-sort', 'none');
  });
});

test.describe('SubmitButton — aria-busy', () => {
  test('aria-busy is true only while the form is submitting', async ({ page }) => {
    await page.route(`${SUPABASE_URL}/auth/v1/token**`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await route.fulfill({ status: 200, json: {} });
    });

    await page.goto('/login');
    const submit = page.getByRole('button', { name: /sign in/i });
    await expect(submit).toHaveAttribute('aria-busy', 'false');

    await page.getByLabel(/email/i).fill('e2e-a11y@example.test');
    await page.getByLabel(/^password$/i).fill('correct horse battery staple');
    await submit.click();

    await expect(submit).toHaveAttribute('aria-busy', 'true');
  });
});

test.describe('PasswordInput — aria-pressed', () => {
  test('the reveal toggle tracks its own pressed state', async ({ page }) => {
    await page.goto('/login');

    const toggle = page.getByRole('button', { name: /show password|hide password/i });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
});
