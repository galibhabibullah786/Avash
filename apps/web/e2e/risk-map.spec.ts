import { test, expect } from '@playwright/test';

/**
 * `/risk` page, driven purely by route interception against the frozen
 * contract (`packages/types/api.ts` — riskMapResponseSchema,
 * riskDetailResponseSchema) and against the OSM tile host
 * (`MAP_TILE_URL_TEMPLATE`, §14), never a live `apps/api` or a real tile
 * fetch. Written against the contract and Leaflet's default vector-layer rendering
 * (`.leaflet-interactive` SVG paths for a GeoJSON layer) is relied on for
 * "region polygons render" and "clicking a region" since the task
 * requires Leaflet directly, not `react-leaflet` — that class name is
 * Leaflet's own, not an app-specific convention. No `waitForTimeout`
 * anywhere — every wait is a web-first Playwright assertion.
 */

const RISK_MAP_URL_PATTERN = 'http://localhost:8787/api/risk-map**';
const RISK_DETAIL_URL_PATTERN = 'http://localhost:8787/api/risk/**';
const TILE_URL_PATTERN = 'https://tile.openstreetmap.org/**';

const REGION_ID = '11111111-1111-4111-8111-111111111111';

// A minimal valid Polygon-in-MultiPolygon covering a small area, matching
// multiPolygonGeometrySchema (packages/types/api.ts).
const SAMPLE_GEOMETRY = {
  type: 'MultiPolygon' as const,
  coordinates: [
    [
      [
        [90.3, 23.7],
        [90.5, 23.7],
        [90.5, 23.9],
        [90.3, 23.9],
        [90.3, 23.7],
      ],
    ],
  ],
};

function riskMapPayload(horizonWeeks: 2 | 4) {
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        geometry: SAMPLE_GEOMETRY,
        properties: {
          regionId: REGION_ID,
          regionName: 'Dhaka',
          riskScore: 0.62,
          riskLevel: 'high' as const,
          horizonWeeks,
          generatedAt: '2026-08-14T00:00:00.000Z',
        },
      },
    ],
    horizonWeeks,
    generatedAt: '2026-08-14T00:00:00.000Z',
    requestId: '00000000-0000-0000-0000-000000000010',
  };
}

const RISK_DETAIL_PAYLOAD = {
  regionId: REGION_ID,
  regionCode: 'dhaka',
  regionName: 'Dhaka',
  predictions: [
    {
      horizonWeeks: 2 as const,
      predictionDate: '2026-08-14',
      riskScore: 0.62,
      riskLevel: 'high' as const,
      modelVersion: 'stub-0.0.0',
      isStub: true,
      topFactors: [],
      generatedAt: '2026-08-14T00:00:00.000Z',
    },
  ],
  latestWeather: null,
  requestId: '00000000-0000-0000-0000-000000000011',
};

const DISTRICT_RISK_PAYLOAD = {
  district: 'Dhaka',
  latitude: 23.8103,
  longitude: 90.4125,
  risk: 'Low' as const,
  risk_score: 0.63,
  low_risk_probability: 0.63,
  medium_risk_probability: 0.22,
  high_risk_probability: 0.15,
  prediction_date: '2026-07-19',
};

// 1x1 transparent PNG — a valid, minimal tile image body.
const TILE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test.describe('risk map', () => {
  async function stubApi(page: import('@playwright/test').Page) {
    await page.route(RISK_MAP_URL_PATTERN, (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.has('district')) {
        return route.fulfill({ json: DISTRICT_RISK_PAYLOAD });
      }
      const horizon = url.searchParams.get('horizon') === '4' ? 4 : 2;
      return route.fulfill({ json: riskMapPayload(horizon) });
    });
    await page.route(RISK_DETAIL_URL_PATTERN, (route) => route.fulfill({ json: RISK_DETAIL_PAYLOAD }));
    await page.route(TILE_URL_PATTERN, (route) =>
      route.fulfill({ contentType: 'image/png', body: Buffer.from(TILE_PNG_BASE64, 'base64') })
    );
  }

  test('the map container mounts', async ({ page }) => {
    await stubApi(page);
    await page.goto('/risk');

    await expect(page.getByTestId('risk-map-container')).toBeVisible();
  });

  test('tiles are requested from the registered OSM host', async ({ page }) => {
    await stubApi(page);

    const tileRequest = page.waitForRequest((req) => req.url().startsWith('https://tile.openstreetmap.org/'));
    await page.goto('/risk');

    const request = await tileRequest;
    expect(request.url()).toContain('tile.openstreetmap.org');
  });

  test('region polygons render on the map', async ({ page }) => {
    await stubApi(page);
    await page.goto('/risk');

    await expect(page.locator('.leaflet-interactive').first()).toBeVisible();
  });

  test('the legend lists the three risk bands', async ({ page }) => {
    await stubApi(page);
    await page.goto('/risk');

    const legend = page.getByTestId('risk-legend');
    await expect(legend).toBeVisible();
    for (const band of ['Low Risk', 'Medium Risk', 'High Risk']) {
      await expect(legend.getByText(band, { exact: false })).toBeVisible();
    }
  });

  test('toggling the horizon refetches the risk map with the new horizon', async ({ page }) => {
    await stubApi(page);

    let sawFourWeekRequest = false;
    await page.route(RISK_MAP_URL_PATTERN, (route) => {
      const url = new URL(route.request().url());
      const horizon = url.searchParams.get('horizon') === '4' ? 4 : 2;
      if (horizon === 4) sawFourWeekRequest = true;
      return route.fulfill({ json: riskMapPayload(horizon) });
    });

    await page.goto('/risk');
    await expect(page.getByTestId('risk-map-container')).toBeVisible();

    const requestPromise = page.waitForResponse(
      (res) => res.url().includes('/api/risk-map') && res.url().includes('horizon=4')
    );
    await page.getByTestId('risk-horizon-toggle').getByRole('button', { name: /4/ }).click();
    await requestPromise;

    expect(sawFourWeekRequest).toBe(true);
  });

  test('clicking a region opens the detail panel', async ({ page }) => {
    await stubApi(page);
    await page.goto('/risk');

    await page.locator('.leaflet-interactive').first().click();

    const panel = page.getByTestId('risk-detail-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Dhaka');
  });

  test('clicking a region opens the probability popup', async ({ page }) => {
    await stubApi(page);
    await page.goto('/risk');

    await page.locator('.leaflet-interactive').first().click();

    const popup = page.locator('.leaflet-popup-content').filter({
      hasText: 'Low Risk Probability:',
    });
    await expect(popup).toHaveCount(1);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('Low Risk Probability: 63%');
    await expect(popup).toContainText('Medium Risk Probability: 22%');
    await expect(popup).toContainText('High Risk Probability: 15%');
    await expect(popup).toContainText('Prediction Date: 2026-07-19');
  });

  test('the model snapshot banner is visible', async ({ page }) => {
    await stubApi(page);
    await page.goto('/risk');

    const banner = page.getByTestId('risk-provenance-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/latest model snapshot/i);
  });
});
