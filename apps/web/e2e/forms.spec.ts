import { test, expect } from '@playwright/test';

/**
 * `SubmitButton`/`PasswordInput`/`Spinner` and the disabled-fieldset
 * convention (`docs/features/platform-primitives.md`), exercised through
 * `/login` (`SignInForm`) — one of the six retrofitted sites. Route
 * interception only, never a live Supabase project, matching the pattern
 * `apps/web/e2e/reports.spec.ts` and `apps/web/e2e/auth.spec.ts` already
 * use.
 *
 * Per decision I (see `docs/features/platform-primitives.md` § form
 * primitives): this spec is written and compile-checked
 * (`playwright test --list`) against the retrofit this slice specifies,
 * not against markup present in this worktree today — `SignInForm.tsx`
 * here is still its pre-retrofit, hand-rolled version (`disabled={status
 * === 'submitting'}`, a plain `type="password"` input, no fieldset). It
 * starts passing once the branch doing that retrofit merges; selectors
 * here follow accessible role/label queries specifically so that a
 * markup change that preserves the same accessible names and ARIA
 * attributes doesn't require touching this file (`docs/PROJECT_PLAN.md`
 * §0.4 optional-chaining/accessibility review habits apply the same way
 * to test selectors as to production code: prefer the contract over the
 * incidental structure).
 */

const SUPABASE_URL = 'https://kdklmbqkczkaakgswlix.supabase.co';

test.describe('/login — SubmitButton + disabled fieldset', () => {
  test('submitting disables every field and exposes a busy state', async ({ page }) => {
    // Never resolves inside the test's lifetime — holds the form in its
    // pending state long enough to assert against it.
    await page.route(`${SUPABASE_URL}/auth/v1/token**`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await route.fulfill({ status: 200, json: {} });
    });

    await page.goto('/login');

    await page.getByLabel(/email/i).fill('e2e-forms@example.test');
    await page.getByLabel(/^password$/i).fill('correct horse battery staple');

    // Matches both the idle "Sign in" label and the pending "Signing in…"
    // pendingLabel — SubmitButton's accessible name changes to pendingLabel
    // while pending, so a locator anchored only to the idle text stops
    // matching once the click below makes it pending.
    const submit = page.getByRole('button', { name: /sign(ing)? in/i });
    await submit.click();

    // SubmitButton renders aria-busy="true" and a pendingLabel while
    // pending (docs/features/platform-primitives.md § form primitives).
    await expect(submit).toHaveAttribute('aria-busy', 'true');
    await expect(submit).toBeDisabled();

    // The whole field group is inside a <fieldset disabled={pending}> —
    // a disabled fieldset disables every input inside it natively, so
    // asserting on one representative field is sufficient; the point of
    // the convention (docs/standards/frontend.md § Form conventions) is
    // that a future field added inside the fieldset needs no new
    // assertion here to stay covered.
    await expect(page.getByLabel(/email/i)).toBeDisabled();
    await expect(page.getByLabel(/^password$/i)).toBeDisabled();
  });
});

test.describe('/login — PasswordInput toggle', () => {
  test('the show/hide toggle reveals and re-hides the password, and the value survives it', async ({
    page,
  }) => {
    await page.goto('/login');

    const password = page.getByLabel(/^password$/i);
    await password.fill('correct horse battery staple');
    await expect(password).toHaveAttribute('type', 'password');

    const toggle = page.getByRole('button', { name: /show password/i });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await toggle.click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(password).toHaveValue('correct horse battery staple');
    await expect(page.getByRole('button', { name: /hide password/i })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: /hide password/i }).click();
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveValue('correct horse battery staple');
  });
});
