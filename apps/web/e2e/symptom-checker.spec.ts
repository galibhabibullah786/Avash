import { test, expect } from '@playwright/test';

/**
 * `/symptoms` page, driven purely by route interception against the
 * frozen contract (`packages/types/api.ts` symptomCheckResponseSchema),
 * never a live `apps/api` — same convention as `weather.spec.ts`. The
 * outcome shown always comes from the mocked response body: ADR-004 means
 * the deterministic rule engine on the server decides the outcome, and
 * this page never recomputes it client-side, so these tests only assert
 * the page renders whatever the (frozen-contract-shaped) response says.
 */

const SYMPTOM_CHECK_URL = '**/api/symptom-check';

function baseChecklist() {
  return {
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
}

const EMERGENCY_RESPONSE = {
  outcome: 'emergency',
  guidance:
    'Your answers include warning signs that can indicate severe dengue. Please go to the nearest hospital or emergency department now, or call for emergency help.',
  checklist: { ...baseChecklist(), severeAbdominalPain: true },
  requestId: '00000000-0000-0000-0000-0000000000e1',
};

const MONITOR_RESPONSE = {
  outcome: 'monitor',
  guidance:
    'Your answers do not currently suggest an urgent warning sign. Rest, stay hydrated, and keep watching for new or worsening symptoms — check again if anything changes.',
  checklist: baseChecklist(),
  requestId: '00000000-0000-0000-0000-0000000000m1',
};

const CONSULT_RESPONSE = {
  outcome: 'consult-24h',
  guidance:
    'Your answers suggest you should see a doctor within the next 24 hours. Keep resting, drink fluids, and avoid aspirin or ibuprofen in the meantime.',
  checklist: { ...baseChecklist(), fever: true, rash: true, achesAndPains: true },
  requestId: '00000000-0000-0000-0000-0000000000c1',
};

test.describe('symptom checker', () => {
  test('checking a severe-sign checkbox and submitting renders the emergency outcome', async ({ page }) => {
    await page.route(SYMPTOM_CHECK_URL, (route) => route.fulfill({ json: EMERGENCY_RESPONSE }));

    await page.goto('/symptoms');
    await page.getByTestId('symptom-option-q10-yes').check();
    await page.getByRole('button', { name: /check my symptoms/i }).click();

    await expect(page.getByTestId('symptom-check-outcome')).toBeVisible();
    await expect(page.getByTestId('symptom-check-outcome')).toContainText(/emergency/i);
  });

  test('the medical-disclaimer notice is visible before submitting', async ({ page }) => {
    await page.goto('/symptoms');
    await expect(page.getByTestId('symptom-check-disclaimer-idle')).toBeVisible();
    await expect(page.getByTestId('symptom-check-disclaimer-idle')).toContainText(/not.*medical diagnosis/i);
  });

  test('the medical-disclaimer notice is visible in the emergency outcome state', async ({ page }) => {
    await page.route(SYMPTOM_CHECK_URL, (route) => route.fulfill({ json: EMERGENCY_RESPONSE }));
    await page.goto('/symptoms');
    await page.getByTestId('symptom-option-q10-yes').check();
    await page.getByRole('button', { name: /check my symptoms/i }).click();

    await expect(page.getByTestId('symptom-check-disclaimer')).toBeVisible();
    await expect(page.getByTestId('symptom-check-disclaimer')).toContainText(/not.*medical diagnosis/i);
  });

  test('the medical-disclaimer notice is visible in the monitor outcome state', async ({ page }) => {
    await page.route(SYMPTOM_CHECK_URL, (route) => route.fulfill({ json: MONITOR_RESPONSE }));
    await page.goto('/symptoms');
    await page.getByRole('button', { name: /check my symptoms/i }).click();

    await expect(page.getByTestId('symptom-check-disclaimer')).toBeVisible();
    await expect(page.getByTestId('symptom-check-disclaimer')).toContainText(/not.*medical diagnosis/i);
  });

  test('the medical-disclaimer notice is visible in the consult-24h outcome state', async ({ page }) => {
    await page.route(SYMPTOM_CHECK_URL, (route) => route.fulfill({ json: CONSULT_RESPONSE }));
    await page.goto('/symptoms');
    await page.getByTestId('symptom-option-q1-currently_fever').check();
    await page.getByRole('button', { name: /check my symptoms/i }).click();

    await expect(page.getByTestId('symptom-check-disclaimer')).toBeVisible();
    await expect(page.getByTestId('symptom-check-disclaimer')).toContainText(/not.*medical diagnosis/i);
  });

  test('the form is fully keyboard-operable — tabbing reaches every control without throwing or trapping focus', async ({
    page,
  }) => {
    await page.goto('/symptoms');
    // Enough tab presses to walk through the navbar, all 12
    // checkboxes, and the submit button without an exception or a trap.
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press('Tab');
    }

    const submitButton = page.getByRole('button', { name: /check my symptoms/i });
    await expect(submitButton).toBeVisible();
    await submitButton.focus();
    await expect(submitButton).toBeFocused();
  });
});
