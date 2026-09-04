# Risk Map Playwright Failure Report

## Investigation Scope

The failing suite is `apps/web/e2e/risk-map.spec.ts`, run against the production preview configured in `apps/web/playwright.config.ts`.

## First Failing Assertion

The first failing assertion was:

```text
risk-map.spec.ts:118
await expect(page.getByTestId('risk-map-container')).toBeVisible();
```

The failure was:

```text
Expected: visible
Received: element(s) not found
```

The same run also reported that `.leaflet-interactive`, `risk-legend`, `risk-horizon-toggle`, and `risk-provenance-banner` were missing.

## Root Cause

The root cause is a missing frontend environment configuration, not an incorrect selector or map API response.

The preview page emitted this page error before React mounted:

```text
Error: Missing required environment variable "VITE_PUBLIC_API_BASE_URL".
Copy apps/web/.env.example to apps/web/.env and set it.
```

This error originates from `apps/web/src/lib/env.ts`, which validates required `VITE_PUBLIC_*` variables at module load time. Because the module throws before the React application starts:

- The router never renders the Risk Map page.
- No `data-testid="risk-map-container"` element exists.
- No Leaflet map is created.
- No API request is made.
- No legend, banner, or polygon exists in the DOM.

The application therefore fails before reaching either the route or the API.

## Secondary Test Runner Issue

The Playwright web server configuration uses:

```text
pnpm preview -- --port 4173
```

On this Windows environment, `pnpm` is not available as a direct executable. Only `corepack pnpm` works. Running the repository's `pnpm dev` also fails in Turborepo with:

```text
Unable to find package manager binary: cannot find binary path
```

This is a test/dev-tooling PATH problem. It prevents the configured web server from starting reliably unless a pnpm shim is available on PATH or the command is invoked through Corepack.

## Test Results and Affected Cases

The first Playwright run was initially blocked because Playwright browser binaries were not installed. After Chromium was installed, all 8 Chromium risk-map cases failed because the preview page was not mounted correctly:

1. Map container mounts
2. OSM tile request
3. Region polygons render
4. Three-band legend renders
5. Horizon toggle refetches
6. Region detail panel opens
7. Probability popup opens
8. Model snapshot banner renders

The failures were cascading failures from the missing environment variable. They were not eight independent selector failures.

## Actual DOM Comparison

### Misconfigured production preview

The browser page had the correct document title, but React did not mount the application content. The browser reported the missing `VITE_PUBLIC_API_BASE_URL` page error. Consequently, the expected selectors were absent:

| Test expectation | Actual DOM |
|---|---|
| `[data-testid="risk-map-container"]` | Missing |
| `.leaflet-interactive` | Missing |
| `[data-testid="risk-legend"]` | Missing |
| `[data-testid="risk-horizon-toggle"]` | Missing |
| `[data-testid="risk-provenance-banner"]` | Missing |

### Page with required public variables supplied

Using temporary non-secret public values, the page rendered successfully. The browser showed:

- `data-testid="risk-map-container"`
- Leaflet controls
- One `.leaflet-interactive` polygon when the API response was intercepted
- Low Risk, Medium Risk, and High Risk legend entries
- `Showing 1 region.` status
- The latest model snapshot banner

The API request failed only when no API server was listening on `localhost:8787`; in that case the UI correctly displayed `API: unavailable right now. Please try again later.`

## API and Route Findings

The API route was not the cause of the first failure. The current route behavior is:

- `GET /api/risk-map` returns the existing GeoJSON contract.
- `GET /api/risk-map?district=Dhaka` returns the validated district snapshot.

The API typecheck passed, and all 21 risk-map route tests passed, including the district snapshot tests.

## Manual Application Status

The Risk Map application does work manually after the required public frontend environment variables are supplied and the API is available.

A controlled browser check with intercepted API data confirmed:

- The Risk Map page renders.
- Leaflet initializes.
- District polygons render.
- The three-level legend renders.
- The snapshot banner renders.
- Clicking a district creates the probability popup with risk score, all three probabilities, and prediction date.

The current local environment was not a complete end-to-end manual check because no API server was listening on `localhost:8787` during the first inspection.

## Exact Fix Required

1. Create `apps/web/.env` from `apps/web/.env.example` for local/manual runs and provide the required public values:

   ```text
   VITE_PUBLIC_API_BASE_URL=http://localhost:8787
   VITE_PUBLIC_SUPABASE_URL=<public Supabase URL>
   VITE_PUBLIC_SUPABASE_ANON_KEY=<public Supabase anon key>
   VITE_PUBLIC_TURNSTILE_SITE_KEY=<public Turnstile site key>
   ```

2. Ensure the API Worker is running on `localhost:8787` for local browser tests, or set `VITE_PUBLIC_API_BASE_URL` to the deployed API origin.

3. Ensure `pnpm` is available on PATH for the Playwright and Turborepo configurations, or update the test/dev command to use the repository-supported Corepack invocation.

4. Before considering the browser suite green, resolve the district popup lifecycle issue observed during controlled testing: after district selection, both a loading popup and a loaded popup can remain in the DOM. The stale loading popup should be closed/removed, or the test should target the visible/current popup explicitly.

## Known Issues

- The generated district snapshot currently ends at `2026-07-19`; this is expected data freshness, not a Playwright failure.
- The current test configuration assumes a direct `pnpm` binary.
- Firefox browser binaries were not installed during this investigation.
- The popup lifecycle can leave duplicate `.leaflet-popup-content` elements after district data arrives.
- A React Router future-flag warning appears in the browser console; it does not prevent rendering.

## Conclusion

The first failing Playwright assertion is caused by frontend startup failure from missing `VITE_PUBLIC_*` environment variables. It is not caused by an incorrect selector, incorrect route, missing map implementation, or API response failure.

The Risk Map renders manually when its required public environment configuration and API server are available. The Playwright suite is not currently green because the test environment does not provide that configuration consistently, and a separate popup lifecycle issue remains to be resolved.
