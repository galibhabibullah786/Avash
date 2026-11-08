# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary:** Everyday citizens across Bangladesh facing seasonal and monsoon dengue risks, accessing the platform via mobile smartphones (ranging from entry-level to high-end devices) under varying network conditions (fast broadband to intermittent/offline 3G/4G connectivity). Their core tasks are checking localized dengue outbreak forecasts, finding immediate actionable prevention guidance, discovering available hospital beds and blood bank supplies during emergencies, reporting mosquito breeding grounds, and self-evaluating symptoms.
- **Secondary:** Healthcare workers and blood bank operators managing live bed and platelet inventory; municipal vector-control moderators reviewing citizen-submitted breeding site reports.

## Product Purpose

Avash (আভাস — "সুরক্ষার আগাম বার্তা") exists to close the critical 2–4 week gap between weather-driven dengue outbreak signals and public awareness/action. Success means translating complex meteorological and epidemiological data into localized early warnings and concrete community prevention before hospital surges overwhelm healthcare facilities.

## Positioning

Proactive early warning paired with immediate localized civic action. Unlike reactive public dashboards that track hospital admissions only after an outbreak is underway, Avash transforms weather patterns 2–4 weeks in advance into actionable risk forecasts, backed by an offline-resilient citizen reporting loop, real-time hospital/blood inventory, and deterministic medical triage.

## Operating Context

- **Delivery Mechanism:** Installable Progressive Web App (PWA) with Workbox service worker caching and offline fallbacks.
- **Field & Ambient Conditions:** Citizens outdoors in rainfall, humidity, or sunlight inspecting water containers and stagnant pools, capturing geotagged photos on mobile cameras with optional offline queueing.
- **Crisis Conditions:** Patients and distressed family members urgently seeking rare blood groups, platelets, or open hospital beds during epidemic peaks.
- **Device & Network Environment:** Mobile-first responsive touchscreens (viewport width 320px–480px up to desktop), touch targets >= 48px, zero horizontal scrolling, and resilience under network disconnects.

## Capabilities and Constraints

- **Capabilities:**
  - Interactive PostGIS risk map with region-level risk bands (rendered via Leaflet with OpenStreetMap raster tiles, requiring zero external map API tokens).
  - Weather intelligence tracking temperature, precipitation, and relative humidity against epidemiological thresholds.
  - Citizen breeding site reporting pipeline supporting geotagging, image compression with signed direct uploads, and offline submission queueing.
  - Real-time hospital bed availability and blood bank inventory ticker powered by Supabase Realtime.
  - Deterministic symptom triage questionnaire providing immediate danger-sign guidance and risk scoring.
  - Web Push notifications for severe regional outbreak alerts and weather warnings.
- **Constraints:**
  - Zero server secrets in client bundle (`apps/web` is a static client-rendered SPA; all privileged operations route through `apps/api` on Cloudflare Workers).
  - No server-side rendering (SPA architecture with client-side routing).
  - Batch ML inference runs asynchronously via scheduled jobs into Supabase PostGIS, never compute-bound per-request in edge workers.
  - Strict compliance with authentic Bangladesh Meteorological Department (BMD) and Directorate General of Health Services (DGHS) data standards.

## Brand Commitments

- **Name & Identity:** Avash (আভাস) — *সুরক্ষার আগাম বার্তা* ("An early message of protection").
- **Voice & Tone:** Bangla-first for all citizen-facing public screens; English for administrative and moderation surfaces. Authoritative, empathetic, calm under emergency conditions, clear, and scientifically grounded.
- **Visual Integrity:** Public health institutional clarity without sensationalism or panic-inducing visuals.

## Evidence on Hand

- Canonical system architecture and engineering plans (`docs/PROJECT_PLAN.md`, `docs/architecture.md`).
- PostGIS database migrations, RLS security policies, and schemas (`packages/db`, `docs/data-schema/schema.md`).
- Authentic DGHS epidemiological records and BMD weather data models.
- Machine learning pipeline with LightGBM models, ONNX runtime export, and validation reports (`ml/`, `docs/ml/`).
- Functioning React 19 PWA scaffold with comprehensive unit, integration, and E2E test suites (`apps/web`).
- *Note:* Future work must not invent testimonials, artificial case numbers, or unverified claims.

## Product Principles

1. **Early Warning Over Late Reaction:** Prioritize predictive 2–4 week advance indicators over retrospective hospitalization records.
2. **Actionable and Grounded:** Every risk score or weather signal must link directly to concrete, local prevention measures or healthcare resources.
3. **Uncompromising Offline Continuity:** Essential triage guidance, emergency advice, and breeding reports must remain usable without active network connectivity.
4. **Safety and Algorithmic Determinism:** Medical triage relies strictly on verified deterministic health rules; AI proxies only structure language, never diagnose.
5. **Zero Barrier to Civic Action:** Anonymous submission allowed for citizen breeding reports with automated network rate-limiting and Turnstile gating rather than login walls.

## Accessibility & Inclusion

- Native Bangla-first localization with high contrast (>= 4.5:1 text-to-background ratio) across light and dark modes.
- Touch targets strictly >= 48px on mobile viewports with full keyboard navigability and focus management.
- Semantic HTML landmarks (`<main>`, `<header>`, `<nav>`) and ARIA live regions for emergency alerts and status changes.
