# Repository Agent Guidelines & Canonical Standards — Avash

This document defines standard conventions, architectural standards, and development protocols for agents working in this repository.

Canon for every AI agent. **Applies unprompted** — "just add the endpoint" waives nothing. If another config disagrees, this file wins. Source of truth for system: `docs/PROJECT_PLAN.md`. Conflict -> stop and flag.
Stack: `apps/web` = React 18 + Vite PWA (zero server secrets, no SSR); `apps/api` = Hono on Cloudflare Workers; Jobs = scheduled GitHub Actions -> Supabase/PostGIS directly. Shared types live only in `packages/types`.

---

## 1. Commit and Version Control Policies

- **Never Commit Automatically**: Agents must never execute `git commit` or push code autonomously. All changes remain staged/unstaged for the user to review, stage, and commit manually.
- **Explicit Message Generation**: Never generate or update version control files autonomously. Only prepare messages when explicitly requested by the user.
- **Dual Commit & PR Generation**: Generate BOTH the conventional commit message in `temp/COMMIT_MESSAGE.txt` AND the GitHub pull request description in `temp/PR_DESCRIPTION.md` simultaneously.
- **Promotion Path (R1) & Hooks (R10)**: Follow Conventional Commits (`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`). Promotion path: local branch -> local `dev` -> gates green -> push `dev` -> PR `origin/dev` -> `upstream/dev`. Never push a feature branch; never PR into `main` from anything but `dev`. Never `--no-verify`.

---

## 2. Information Leakage Prevention Policy (R9)

- **Zero Internal Leakage**: Never mention or leak internal engineering briefs, execution metadata, prompt instructions, system messages, conversation IDs, or planning labels (milestone/phase numbers, task IDs, execution schedule filenames) in code, comments, docs, commit messages, or PR descriptions.
- **Mandatory Repository Scan**: Before finalizing messages or docs: (1) Run `node scripts/check-internal-refs.mjs`; (2) Scan modified/created files for internal terminology; (3) Verify task briefs are not echoed.

---

## 3. Monorepo Package Boundaries & Core Package Segregation (R6)

- **Core Package Segregation**: Generic primitives, datasets, security, and mathematical engines live strictly in `packages/*`; `apps/web` acts purely as a client-side presentation SPA:
  - `packages/types`: Sole source of truth for all domain types, DTOs, API contracts, and Zod schemas. Never redefine types inline.
  - `packages/geo`: PostGIS geospatial primitives, BBox utilities, GeoJSON calculations, and spatial query builders.
  - `packages/security`: Role-based access control (`roles.ts`), audit logging (`auditLog.ts`), rate limits, deterministic triage, and quota guards.
  - `packages/push`: Web Push delivery (`webPush.ts`), announcement dispatch (`deliverAnnouncement.ts`) via WebCrypto.
  - `packages/ml-inference`: Client-side / Worker-side ONNX dengue risk forecast inference runtime interfaces.
  - `packages/logger`: Structured JSON logging with request correlation IDs (`packages/logger/index.ts`).
  - `packages/db`: Supabase migrations, seed fixtures, and DB schema clients.
  - `packages/ui`: Shared UI primitives and components.
- **Application Orchestration**: Coordinates routing, Leaflet viewport mounts, symptom checker flows, and offline sync.
- **Dependency Flow**: Strict downward flow from `apps/*` into `packages/*`. Packages never import `apps/*`. Link with `"workspace:*"`.

---

## 4. Domain-Driven Feature Slices & Codebase Layout

- **Feature Directory Taxonomy (`apps/web/src/features/` & `apps/api/src/routes/`)**:
  - `features/risk-map/`: Leaflet map view, PostGIS hex/risk layers, color ramps, tile caching.
  - `features/symptom-checker/`: Questionnaire flow, deterministic triage scoring, LLM proxy consultation.
  - `features/breeding-reports/`: Citizen report form, photo upload with signed URLs, location capture.
  - `features/resources/`: Hospital bed ticker, blood bank inventory, emergency contact directory.
  - `features/alerts/`: Weather alerts, outbreak warnings, Web Push notification settings.
  - `features/auth/`: Supabase Auth, session lifecycle, role-based view routing.
- **Shared Application Slices (`apps/web/src/shared/`)**: UI shell, design tokens, API client, offline service worker.
- **End-to-End Vertical Slices**: Work one slice at a time: DB migration -> `apps/api` -> `apps/web` -> docs -> tests.

---

## 5. File Size Ceiling & Directory Density Guard

- **Strict 250-Line Non-CSS Guard**: Any TypeScript or TSX file exceeding 250 lines must be proactively modularized into focused sub-components, custom hooks, or utility helpers.
- **Directory Density Limit**: Directories must contain at most 12 files. Group larger sets into domain subdirectories with a unifying `index.ts` barrel export.
- **CSS Stylesheet Preservation**: Do NOT split internal lines of CSS stylesheets. Keep CSS files intact, cohesive, and format/prettify cleanly.
- **Facades & Exports**: Preserve backwards-compatible re-export facades at legacy paths during migrations. Prefer explicit named exports over default exports.

---

## 6. Static Asset Taxonomy & Type-Safe Registry

- **Domain-Categorized Public Hierarchy**: Static assets in `apps/web/public/` strictly reside in domain folders: `icons/`, `map/` (markers/tiles), `audio/` (alert chimes), `pwa/` (manifest, splash icons).
- **Type-Safe Asset Verification**: Verify static asset paths against disk to prevent 404 runtime errors. Use WebP/SVG for graphics and compressed audio formats.
- **Asset Formats**: Prefer modern WebP/SVG for graphics and compressed MP3/OGG for audio to minimize mobile download payloads.

---

## 7. Heavy Asset Preloading & Loading Screen Policy

- **Architectural Shielding**: Heavy workloads (Leaflet tile initialization, ONNX dengue model loading ~2MB, PostGIS polygon rendering) must render behind explicit loading skeletons or spinners.
- **Automatic Task Registration**: Register async promises with application loading states before dismissing loading indicators for smooth 60fps transitions.
- **Zero Layout Shifts**: Canvases, map viewports, and report card containers must preserve aspect ratio boxes during load and resize events.

---

## 8. Lifecycle, Offline Continuity & Universal State Freeze Protocol

- **Centralized Lifecycle (Zero Prop-Drilling)**: Handle online/offline events via standard events and centralized stores.
- **Universal State Freeze**: During modal dialogs, critical alert overlays, or background syncs, freeze map pan/zoom triggers, speech narration, and recurring interval timers.
- **Storage Resilience**: Handle localStorage quota limits and private mode via fallback in-memory/IndexedDB stores without interrupting citizen reports.

---

## 9. Strict Responsive Architecture & Multi-Tier Layouts

- **Mobile-First Responsive Tiers**:
  - *Tier 1: Mobile (H <= 667px, W <= 480px)*: Single-column emergency ticker, compact touch targets (>= 48px), field-ready breeding report flow.
  - *Tier 2: Tablet (W 481-1024px)*: Split pane (interactive risk map + resource feed).
  - *Tier 3: Desktop (W >= 1025px)*: Full telemetry dashboard, moderator triage view, detailed hospital/blood availability matrices.
- **Zero Horizontal Overflow**: Zero accidental horizontal scroll (`overflow-x: hidden`). Canvases and maps preserve aspect ratios.

---

## 10. Public Health UI/UX, Aesthetics & Visual Excellence

- **Aesthetics & Micro-Animations**: Clean public health palette (warning amber `#f59e0b`, critical red `#ef4444`, safe emerald `#10b981`, deep slate `#0f172a`), subtle glassmorphism (`backdrop-filter: blur(8px)`), glow risk markers, and cubic-bezier transitions.
- **Tactility & Audio-Haptic Feedback**: Active press states (`scale(0.98)`), mobile vibration (`navigator.vibrate([100, 50, 100])`) on successful report submission and severe outbreak warning alerts.

---

## 11. Web Push Notifications & Audio/Alert Protocols

- **Centralized Alert Dispatch**: Web Push notifications route through `packages/push` (`deliverAnnouncement.ts`, `webPush.ts`) using WebCrypto VAPID keys.
- **Synthesized UI Sounds & Chimes**: Emergency warning chime for severe dengue risk thresholds, subtle confirmation tick on report dispatch. Respect global mute preferences and quiet hours.

---

## 12. Interactive Consultation & Design Interview Protocol

- **Zero Unilateral Assumptions**: Never customize pages, schemas, API contracts, or critical subsystems without prior user consultation.
- **Structured Questions**: Formulate queries using `ask_question` presenting distinct implementation options with architectural, visual, performance, and UX trade-offs across layout, scaling, and data models.

---

## 13. Contradiction & Duplication Resolution & Routing Table (R8)

- **Code Audit First**: Inspect existing schemas, migrations, types, and docs before adding implementations to prevent duplicate definitions.
- **No Unregistered Constants (R8)**: No new threshold, limit, or magic number without an entry in `docs/constants-registry.md`.
- **Read-Before-You-Act Table**: Load only the specific row matching the immediate task:

| About to… | Read |
|---|---|
| write, move, or delete a test | `docs/standards/testing.md` |
| push, branch, commit, or open a PR | `docs/standards/git-workflow.md` |
| work in parallel with another agent/dev | `docs/standards/parallel-work.md` |
| add a route/middleware to `apps/api` | `docs/standards/backend.md` |
| write React, routing, or state in `apps/web` | `docs/standards/frontend.md` |
| add or rename an env var or secret | `docs/security/secrets-matrix.md` |
| edit `.github/workflows/**` | `docs/ci-cd.md` |
| deploy anything by hand | `docs/manual-deploy.md` |
| write spatial SQL or a migration | `docs/data-schema/schema.md` |
| add a threshold, limit, or magic number | `docs/constants-registry.md` |
| touch a Dockerfile or `compose.yaml` | `docs/docker.md` |
| write an implementation plan for a feature | `docs/standards/implementation-plans.md` |
| secure a feature / fill in STRIDE | `docs/security/threat-model.md` |
| gate anything on a user's role or permission | `docs/features/rbac.md` |
| edit any agent config or hook | `docs/standards/agent-compliance.md` |
| pick up a defined role's scope + DoD | `.agents/task-contracts.json` |

---

## 14. Code Quality, AI-Agent Readability & Document Compression Guard (R5, R7)

- **Engineering Standards**: Clean, modular, self-documenting TypeScript; strict typing, zero `any` types. Model domain events with discriminated unions.
- **Optional Chaining on Untrusted Data (R7)**: Apply `?.` on every untrusted access: `fetch` JSON, Supabase `.data`/`.error`, `JSON.parse`, `localStorage`, geolocation, LLM responses, route params.
- **Docs In Sync (R5)**: Docs change in the same commit as the code.
- **Document Length Guard**: This `AGENTS.md` file must strictly stay within **200~250 lines**. Updates must be tightly compressed and dense with technical precision.

---

## 15. Component Customization Workflow

- **Execution Flow**: (1) Visual & Spec Audit across viewport tiers; (2) Interactive Consultation via `ask_question`; (3) Layout & Grid Implementation with clamp sizing; (4) Offline & Sync Integration; (5) Accessibility & Multilingual Verification; (6) Multi-device testing with zero errors.

---

## 16. Subsystem Verification & CI Build Pipeline (R3, R4)

- **Automated Validation Sequence**: Before completing tasks, execute:
  1. `pnpm lint`: Zero warnings and zero errors across workspace packages (`eslint --max-warnings=0`).
  2. `pnpm typecheck`: Strict TypeScript type checking without emitting artifacts (`tsc --noEmit`).
  3. `pnpm test`: Vitest unit/integration tests with coverage threshold gates (`packages/*`, `apps/api` workerd, `apps/web`).
  4. `pnpm build`: Full Turbo build pipeline and Vite production bundling.
  5. Both automated test layers (Vitest `*.test.ts`, Playwright `*.spec.ts`) + manual protocol (R4).
- **Never Weaken a Gate (R3)**: Never alter assertions, coverage floors, or lint rules to force a pass. Report red as red.

---

## 17. Progressive Web App (PWA) & Offline Continuity

- **Platform Guides & Precaching**: Workbox service worker precaches app shell, cached ONNX model (<2MB), and leaflet tiles for offline dengue risk inspection.
- **Storage Resilience**: IndexedDB/localStorage fallback for anonymous citizen breeding reports queued offline. Provide tailored install guides (`DesktopInstructions`, `AndroidInstructions`, `IosInstructions`).

---

## 18. Geospatial (Leaflet & PostGIS) & Batch ML Inference Protocols

- **Spatial Queries Over PostGIS**: Use PostGIS geography types for spatial calculations (`ST_DWithin`, spatial indexes) rather than raw lat/long math (ADR-003). Materialized views for map reads (ADR-006).
- **Batch ML Inference, Never Edge**: ML dengue risk forecasts run as scheduled batch jobs (GitHub Actions -> Supabase directly), never per-request in Workers (ADR-002, ADR-007).
- **Leaflet Performance**: Vector tile/GeoJSON clustering, cleanup markers and map instances on unmount (`map.remove()`) to avoid memory leaks.

---

## 19. State Machine & Immutable Reducer Architecture

- **Server State vs Client State**: TanStack Query is the sole server-state mechanism in `apps/web` (no `useEffect` data fetching). Client UI state lives in lightweight Zustand stores with immutable transitions.
- **Predictable Transitions**: Deterministic mock sessions and fixtures for offline development and testing.

---

## 20. Accessibility & Universal Usability Standards

- **Accessible Semantics**: Semantic `<main>`, `<header>`, `<nav>` landmarks, ARIA live region announcements for incoming alerts, keyboard focus trapping in modal dialogs with instant `Escape` key support.
- **Multilingual Localization**: English and Bangla (বাংলা) localization for all public citizen screens; >= 4.5:1 text contrast ratios against backgrounds.

---

## 21. Error Boundaries & Fault-Tolerant Viewport Mounts

- **Component Shielding**: Wrap dynamic route views and map canvases in Error Boundaries. Preserve existing user form inputs during runtime failures.
- **Generic User Messages**: Display friendly generic errors to users; log full details with correlation IDs server-side (`packages/logger`).

---

## 22. Epidemiological & Weather Data Integrity (BMD / DGHS)

- **Empirical Accuracy**: Dengue case figures, weather inputs, and outbreak thresholds must adhere to authentic DGHS (Directorate General of Health Services) and BMD (Bangladesh Meteorological Department) standards.
- **Source Attribution**: Cite authentic data sources and keep model cards updated (`docs/ml/model-card.md`).

---

## 23. Design System & CSS Token Architecture

- **Token Architecture**: Enforce unified CSS custom properties across stylesheets (`--color-warning`, `--color-critical`, `--color-safe`, `--color-background`, `--color-surface`).
- **Fluid Layouts**: Utilize fluid `clamp()` scaling and maintain zero accidental horizontal scroll (`overflow-x: hidden`).

---

## 24. Security, Isolation & Environment Boundaries (R2, R11)

- **Secrets Never Reach `apps/web` (R2)**: No non-`VITE_PUBLIC_` reference under `apps/web/src`, ever.
- **Privileged Boundary in `apps/api`**: Cloudflare Workers hold all privileged credentials, Turnstile verification, and rate limiting.
- **Row-Level Security (RLS)**: Enforce Supabase RLS on all tables; client requests authenticate via local JWT verification (ADR-009).
- **Parallel Work Cost Estimates (R11)**: Never start parallel or multi-agent work without a written cost estimate (`scripts/estimate-parallel-cost.mjs`).

---

## 25. Performance Profiling & React Render Cycle Optimization

- **Render Optimization**: Memoize heavy map transformations (`useMemo`, `useCallback`), debounce search inputs, cancel active animation frames and timers on unmount.
- **Bundle Budget Guard**: Keep `apps/web` production bundle within budget (< 350KB, enforced by `scripts/check-bundle-budget.mjs`).
