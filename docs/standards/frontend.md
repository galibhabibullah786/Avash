# Frontend Coding Standards

**Read when:** writing React, routing, state, or map code under apps/web/src.

**Decides:** SPA conventions, optional-chaining checklist, bundle budget, accessibility, map rendering.

`apps/web` is a React 18 + Vite client-rendered SPA (ADR-008) — there is no
server rendering, no file-based API routes, and no framework magic beyond
what Vite and React Router provide directly.

## Framework & routing

- **Framework:** React 18, built with Vite.
- **Routing:** React Router, with `React.lazy` + `Suspense` per route.
  Every entry in `router.tsx` is a lazy-loaded chunk — no route component
  is imported eagerly at the top of `router.tsx`.
- **State management:** TanStack Query is the **only** server-state
  mechanism in the app. No `useEffect`-based data fetching is permitted
  anywhere under `apps/web/src` — if a component needs server data, it
  uses a `useQuery`/`useMutation` hook, full stop.
- **Styling:** plain CSS with a design-token set (colors, spacing, font
  stack) defined in `apps/web/src/styles/global.css`, plus the shared
  `packages/ui` design system for cross-app-reusable components. Tailwind
  is not used in this project.

## `packages/ui` boundary

`packages/ui` is the shared React design system — framework-agnostic of
routing, with no dependency on `react-router-dom` or `apps/web`-specific
state. Components in `apps/web/src/components` are app-specific,
presentational, and may depend on routing/app state; anything reusable
enough to be routing-agnostic belongs in `packages/ui` instead, not
duplicated.

## Feature-sliced layout

`apps/web/src/features/*` holds one directory per feature domain (`map/`,
`reports/`, `resources/`, `symptom-checker/`, `alerts/`), each owning its
own hooks, components, and query definitions. `apps/web/src/pages/*` are
thin route-level components that compose feature-slice pieces — page
components do not contain feature business logic directly.

## Map rendering (ADR-013)

The map is **Leaflet**, and it is two independent layers that must not be
confused with each other:

| Layer | Source | Owned by | Changes at runtime? |
|---|---|---|---|
| Basemap tiles | OpenStreetMap standard raster tiles, via a Leaflet `TileLayer` | a third party — background imagery only | No — a fixed backdrop |
| Overlays: region polygons, risk shading, hospital markers, breeding-report pins | GeoJSON from `apps/api` (served out of `region_risk_summary`, ADR-006) | **us** | Yes — this is the product |

Rules that follow from that split:

- **Everything dynamic is an overlay, never a tile concern.** Marking,
  recoloring, filtering, or re-rendering places and areas is done by
  updating our own Leaflet vector/marker layers from a TanStack Query
  result. The tile provider plays no part in it, and no basemap
  limitation constrains what the map can highlight.
- **Overlay data is fetched like any other server state** — a `useQuery`
  hook in `apps/web/src/features/map/`, zod-parsed through
  `packages/types` before a single layer is constructed. Never build a
  layer straight from an unparsed response.
- **Risk colors come from `RISK_LEVEL_BANDS`** (§14), and color is never
  the only signal — pair every band with a label or pattern, per the
  accessibility rules below.
- **The tile layer reads its three values from the registry**
  (`MAP_TILE_URL_TEMPLATE`, `MAP_TILE_ATTRIBUTION`, `MAP_TILE_MAX_ZOOM`
  in `apps/web/src/features/map/tileLayer.ts`), never as inline string
  literals. Attribution is a usage-policy obligation, not decoration —
  it stays visible.
- **No map credential exists, and none may be introduced** without a
  follow-up ADR superseding ADR-013. There is no `VITE_PUBLIC_` map
  variable to add.
- **Leaflet loads on the map route only**, through that route's own
  `React.lazy` boundary, so it never enters the shell bundle counted
  against `FRONTEND_BUNDLE_BUDGET_KB`.
- **The tile host needs a CSP `img-src` entry** in
  `apps/web/public/_headers` (and the container's
  `security-headers.conf.template`) — `img-src`, not `connect-src`,
  because raster tiles are `<img>` requests. Add it in the same change
  that adds the tile layer; a dev server serves no CSP, so a missing
  entry passes locally and blocks the basemap in production.

## Form conventions

New forms are built from `apps/web/src/components/SubmitButton.tsx`,
`PasswordInput.tsx`, and `Spinner.tsx`
(`docs/features/platform-primitives.md` has the full contract), not
hand-rolled `disabled={…}` + ternary-label buttons or a manual
`type="password"` toggle — `grep -rn 'type="submit"'` /
`grep -rn 'type="password"'` under `apps/web/src` should only ever match
inside those two component files.

**"Disable every field while submitting" is a `<fieldset disabled={pending}>`
wrapping the form's fields, never `disabled` threaded through each input
by hand.** A fieldset is one attribute that structurally cannot miss a
field a later edit adds inside it; a per-input `disabled` prop is a
second thing every new field has to remember.

## Table conventions

`useListQuery` (`apps/web/src/hooks/useListQuery.ts`) backs
`page`/`pageSize`/`sort`/`dir`/`q` with `useSearchParams`, so a sorted,
filtered table stays linkable and survives the back button. It parses
the URL through `listQuerySchema`/`listQueryFor(...)`
(`packages/types/pagination.ts`) and falls back to the schema's defaults
on anything malformed — URL search params are attacker/user-controlled
(optional-chaining checklist item 10, below), so a bad value degrades to
"first page, default sort," never a thrown error.

`DataTable` (`apps/web/src/components/DataTable.tsx`) takes a column
descriptor list (`key`, `header`, `sortable`, `render`) and a `PageMeta`
(`docs/features/platform-primitives.md`), and is the only place this
project renders a paginated list — whether the data came from `apps/api`
or a direct PostgREST read, `DataTable` sees the same `PageMeta` shape
and cannot tell the two transports apart. Sortable column headers are
buttons carrying `aria-sort`, never a plain `<th>` click handler with no
accessible state. The footer's range label reads "showing 26–50" when
`page.total` is `null` and "showing 26–50 of 312" when it isn't
(decision A, `docs/features/platform-primitives.md`) — never fabricate a
total to fill in the gap.

## Optional-chaining checklist (R4)

Every one of the following access points **must** use optional chaining
(`?.`) or an equivalent safe-access pattern (zod parse, guarded
destructure). Reviewers grep for raw `.property` access on each of these
before approving a PR (`docs/PROJECT_PLAN.md` §0.4):

| # | Access point | Why it is untrusted |
|---|---|---|
| 1 | `fetch()` response JSON (via `apiClient.ts`) | Network/server can return any shape, including an error body |
| 2 | Supabase query results (`.data` / `.error`) | Query can fail or return `null` |
| 3 | `JSON.parse(...)` results | Input may not match the expected shape |
| 4 | `localStorage.getItem(...)` | Key may not exist; storage may be disabled |
| 5 | `navigator.geolocation` callbacks | Permission may be denied; API may be unavailable |
| 6 | `navigator.serviceWorker` / Push API callbacks | Browser support and registration state vary |
| 7 | `Notification` API | Permission state is user-controlled and can change at any time |
| 8 | Leaflet event payloads (`map`, `layer`, `marker` handlers) | Third-party event shape is not guaranteed by our types; `e.latlng`/`e.target` are typed as present but arrive from library internals |
| 9 | Gemini responses (surfaced to `apps/web` only via `apps/api`'s already-validated JSON) | Treat as untrusted until it has passed the shared `packages/types` zod schema |
| 10 | `useParams()` / `useSearchParams()` (React Router) | Route params are attacker/user-controlled strings, may be missing or malformed |

## Error handling (R10)

A single root `ErrorBoundary` (`apps/web/src/components/ErrorBoundary.tsx`)
wraps the router. It renders a generic, user-safe fallback message and
**never** displays a raw error message or stack trace. Data-fetching
errors surfaced by TanStack Query are rendered through the same
generic-message + toast pattern — never a raw `error.message` from an
untrusted source rendered directly into the DOM.

## Bundle budget

The main shell bundle budget is **< 180 KB gzip**
(`FRONTEND_BUNDLE_BUDGET_KB`, `docs/PROJECT_PLAN.md` §14). Enforced via
`rollup-plugin-visualizer` in `vite.config.ts` (measured on every build)
and a CI gate. Leaflet and other map-route-only dependencies are
chunk-split so they never contribute to the shell bundle for users who
never open the map.

## Environment access

`apps/web` may only reference environment variables prefixed
`VITE_PUBLIC_`. Any other `import.meta.env`/`process.env` access under
`apps/web/src` is a hard build failure, enforced by the ESLint boundary
rule in `packages/config/eslint-config` (`docs/PROJECT_PLAN.md` §7.1) and,
independently, by Vite's default refusal to inline non-`VITE_`-prefixed
vars into the client bundle. This is an absolute rule — there is no
exception path.

## Accessibility standards

- Exactly one `<h1>` per page.
- All interactive elements are reachable and operable by keyboard alone
  (no mouse-only interaction).
- Status/state changes that are visually communicated (e.g., the API
  status panel, form submission results) are also announced to assistive
  technology (`aria-live` regions where appropriate).
- Color is never the only signal for risk-level bands (`RISK_LEVEL_BANDS`)
  — pair color with text/icon.

## Performance best practices

- Lazy-load anything not needed for first paint (map/Leaflet chunk, ONNX
  runtime, admin-only routes).
- No arbitrary `waitForTimeout`-style artificial delays anywhere in
  production code.
- Images/icons are sized and compressed appropriately; no unoptimized
  raster assets shipped to the client.
- PWA caching strategy (`vite-plugin-pwa`/Workbox, `docs/PROJECT_PLAN.md`
  §8): `NetworkFirst` for `apps/api` data, `CacheFirst` for map tiles
  (7-day expiry, max 200 entries), `StaleWhileRevalidate` for static
  assets/fonts. The tile policy is not only a performance choice — it is
  how this project stays within OpenStreetMap's tile usage policy
  (ADR-013), so do not weaken it to `NetworkFirst` for fresher imagery
  that never changes anyway.

## Layout & typography

- Font stack includes a Bengali-capable fallback (the app renders both
  Bengali and English text; `আভাস` must render correctly with no tofu
  glyphs).
- Layout is defined with CSS Grid/Flexbox in `global.css`; no
  layout-shifting content — skeleton loaders reserve the same space the
  loaded content will occupy (Cumulative Layout Shift target < 0.1, §8).
- Spacing and color tokens live in `global.css` as CSS custom properties,
  consumed by both `apps/web` components and `packages/ui`.
