# Documentation Index

Every document under `docs/`, one line each. "Existing" means the file is
present in the repository today; "Planned" means it is scoped to work that
has not yet been reached.

## Reading order for new contributors

1. [`docs/PROJECT_PLAN.md`](PROJECT_PLAN.md) — the single source of truth; read this first, in full.
2. [`../AGENTS.md`](../AGENTS.md) — hard rules for AI coding agents, and the canonical rule set every agent config points at.
3. [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — how a change gets merged.
4. `docs/standards/*` — the concrete coding standards the plan's principles compile down to.
5. [`standards/agent-compliance.md`](standards/agent-compliance.md) — if you are configuring an AI agent to work here, or wondering why a hook refused something.

## Top-level

| File | Description | Status |
|---|---|---|
| [`PROJECT_PLAN.md`](PROJECT_PLAN.md) | Single source of truth: architecture, schema, security, constants, testing protocol, governance file source text | Existing |
| [`README.md`](README.md) | This index | Existing |
| [`architecture.md`](architecture.md) | Narrative architecture doc: system diagram, data flow, component boundaries, "what lives where" decision table | Existing |
| [`constants-registry.md`](constants-registry.md) | Master table of all 22 §14 constants with implementation status | Existing |
| [`docker.md`](docker.md) | Container runbook: the local PostGIS database, the ML image, the two app images, the optional dev container, and the images CI builds | Existing |
| [`ci-cd.md`](ci-cd.md) | Every CI/CD workflow: trigger, steps, required secrets, failure modes, rollback procedure | Existing |
| [`manual-deploy.md`](manual-deploy.md) | Deploying by hand without CI — per service (backend, frontend, database, jobs, ML artifact, images) and per environment (preview, production), with verification and rollback for each | Existing |

## `docs/adr/` — Architectural Decision Records

| File | Description | Status |
|---|---|---|
| [`adr/ADR-000-template.md`](adr/ADR-000-template.md) | Template all ADRs follow | Existing |
| [`adr/ADR-001-two-app-split.md`](adr/ADR-001-two-app-split.md) | `apps/web` SPA + `apps/api` Hono/Workers split | Existing |
| [`adr/ADR-002-batch-inference-not-edge.md`](adr/ADR-002-batch-inference-not-edge.md) | Batch Python inference in Actions, not per-request Worker inference | Existing |
| [`adr/ADR-003-postgis-over-latlng.md`](adr/ADR-003-postgis-over-latlng.md) | PostGIS over generic lat/lng columns | Existing |
| [`adr/ADR-004-deterministic-triage.md`](adr/ADR-004-deterministic-triage.md) | Rule engine decides triage; LLM only structures input | Existing |
| [`adr/ADR-005-anonymous-reports.md`](adr/ADR-005-anonymous-reports.md) | Anonymous reports allowed, gated by Turnstile + rate limit | Existing |
| [`adr/ADR-006-materialized-view-map-reads.md`](adr/ADR-006-materialized-view-map-reads.md) | `region_risk_summary` MV for map reads | Existing |
| [`adr/ADR-007-github-actions-cron.md`](adr/ADR-007-github-actions-cron.md) | GH Actions `schedule` replaces QStash; Upstash scoped to rate limiting only | Existing |
| [`adr/ADR-008-no-ssr.md`](adr/ADR-008-no-ssr.md) | Pure client-rendered SPA; SEO trade-off accepted | Existing |
| [`adr/ADR-009-local-jwt-verification.md`](adr/ADR-009-local-jwt-verification.md) | Supabase Auth + local HS256 verification via `jose` | Existing |
| [`adr/ADR-010-realtime-direct-from-browser.md`](adr/ADR-010-realtime-direct-from-browser.md) | Resource ticker subscribes to Supabase Realtime directly | Existing |
| [`adr/ADR-011-docker-for-infra-not-apps.md`](adr/ADR-011-docker-for-infra-not-apps.md) | Docker for the local database, the ML runtime, and CI service containers | Existing — the "never containerize the apps" clause superseded by ADR-012 |
| [`adr/ADR-012-app-container-images.md`](adr/ADR-012-app-container-images.md) | Both apps ship container images (nginx for web, Node/`@hono/node-server` for api); Cloudflare stays the deploy path; CI runs the API suite against both runtimes | Existing |
| [`adr/ADR-013-leaflet-with-osm-tiles.md`](adr/ADR-013-leaflet-with-osm-tiles.md) | Leaflet over credential-free OpenStreetMap raster tiles; `VITE_PUBLIC_MAPBOX_TOKEN` removed repo-wide; dynamic overlays come from our own `apps/api` GeoJSON | Existing |

## `docs/standards/` — Engineering Standards

| File | Description | Status |
|---|---|---|
| [`standards/frontend.md`](standards/frontend.md) | Definitive React/Vite conventions: routing, state, optional-chaining checklist, bundle budget, accessibility | Existing |
| [`standards/backend.md`](standards/backend.md) | Hono routing conventions, middleware order, error boundary pattern, Supavisor pooling, the R7 jobs-endpoint ban | Existing |
| [`standards/testing.md`](standards/testing.md) | Three-layer testing strategy: Vitest for unit/integration (`packages/*`, `apps/api` in workerd, `apps/web` hooks), Playwright for end-to-end (`apps/web` browser, `apps/api` dual-runtime contract), plus the three-pass manual protocol; coverage thresholds and the per-case routing table | Existing |
| [`standards/agent-compliance.md`](standards/agent-compliance.md) | How agent rules are enforced without being asked: four layers (instruction files → tool hooks → git hooks → CI gates), the eager/lazy context split and its token budget, and the review protocol for agent-driven QA | Existing — Layer 1 in place, Layers 2–4 specified |
| [`standards/parallel-work.md`](standards/parallel-work.md) | Running multiple agents and developers concurrently: contract-first phasing, what must never run in parallel, path ownership, the worktree protocol, and the integration seat | Existing |
| [`standards/git-workflow.md`](standards/git-workflow.md) | Local-only feature branches and the promotion path to `upstream/main`, branch naming, commit conventions, vertical-slice-per-PR rule, merge gates | Existing |

## `docs/data-schema/`

| File | Description | Status |
|---|---|---|
| [`data-schema/schema.md`](data-schema/schema.md) | Full §4 PostGIS schema reference: every table, index, the FK `on delete`/`on update` action policy (§4.3), and the ER diagram (documents the *target* schema; SQL ships once the database build-out lands) | Existing, updated when the schema ships |
| [`data-schema/rls-policies.md`](data-schema/rls-policies.md) | Per-table RLS intent for all four operations, on every table | Existing |
| [`data-schema/dfd.md`](data-schema/dfd.md) | Data Flow Diagram (Gane–Sarson): context-level (Level 0) and process-decomposition (Level 1), external entities/processes/data stores distinct from the ERD and the system architecture diagram | Existing |

## `docs/ml/`

| File | Description | Status |
|---|---|---|
| [`ml/model-card.md`](ml/model-card.md) | Full model card: intended use, features, algorithm, promotion gate, explainability, limitations | Existing |
| [`ml/inference-architecture.md`](ml/inference-architecture.md) | The batch-vs-on-device two-path inference architecture (ADR-002) | Existing |
| [`ml/feature-engineering.md`](ml/feature-engineering.md) | Per-feature computation spec, windows, null handling, leakage risk | Existing |

## `docs/security/`

| File | Description | Status |
|---|---|---|
| [`security/threat-model.md`](security/threat-model.md) | Full STRIDE model, organized by feature | Existing |
| [`security/secrets-matrix.md`](security/secrets-matrix.md) | Environment variable inventory, exposure classification, rotation procedure | Existing |
| [`security/github-environments.md`](security/github-environments.md) | Step-by-step procedure for splitting deploy credentials into `preview` and `production` GitHub Environments: branch policies, required reviewers, per-environment secrets, the workflow edits, verification, and rotation | Existing — procedure written, not yet applied |
| [`security/rate-limiting.md`](security/rate-limiting.md) | Rate-limit guard table, Upstash sliding-window approach, Gemini quota fallback behavior | Existing |

## `docs/features/` — per-feature documentation (§12 template)

Each file follows the mandatory Gist / Technical Detail / Critical
Constants / Security Considerations / Manual Test Log template, written in
the same change that builds the feature (`docs/PROJECT_PLAN.md`'s
per-feature docs cannot describe behavior that doesn't exist yet).

| File | Description | Status |
|---|---|---|
| [`features/frontend-scaffold.md`](features/frontend-scaffold.md) | The single-page frontend shell: what it renders, bundle budget, e2e coverage | Existing |
| [`features/health-endpoint.md`](features/health-endpoint.md) | `/health` liveness endpoint and `/health/db` readiness probe | Existing |
| [`features/integration.md`](features/integration.md) | Frontend↔backend integration: request lifecycle, CORS matrix, shared-contract rule, UI-state↔spec mapping | Existing |
| [`features/database.md`](features/database.md) | Migration workflow, seed/refresh tooling, what shipped vs. what `schema.md` documents | Existing |
| [`features/announcement-push.md`](features/announcement-push.md) | Live announcement delivery via `apps/notify`/`packages/push`: two-trigger design, claim-with-lease semantics, the role-targeting fix, platform support matrix | Existing |

Further feature docs (breeding reports, blood inventory, symptom checker,
alerts, news aggregator) are added as their vertical slices ship, per
`docs/PROJECT_PLAN.md` §13 — not enumerated here in advance since their
scope isn't finalized until the slice that builds them begins.

## `docs/testing/`

| File | Description | Status |
|---|---|---|
| `testing/manual-test-log.md` | Running master log of all three-pass manual test results, with reviewer sign-off | Planned |
| `testing/verification-report.md` | Final verification report: what was tested, found, fixed; Vitest coverage table, Playwright suite summary, Lighthouse scores, known limitations | Existing |
