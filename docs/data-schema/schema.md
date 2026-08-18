# Data Schema Reference

> **Shipped.** The migrations in `packages/db/supabase/migrations/`
> implement every table, index, and constraint below exactly — this file
> and the SQL are kept in sync by hand on every schema change (R6). Apply
> them with `pnpm db:migrate` (targets `DATABASE_URL_LOCAL`, the local
> Postgres/PostGIS container from `pnpm docker:db`, by default) and seed
> sample data with `pnpm db:seed`.

All tables live in the Supabase Postgres project with the `postgis` and
`pgcrypto` extensions enabled. Every geometry column uses SRID 4326
(WGS84 lat/lng) — see ADR-003.

## `regions`

Administrative boundaries (state/district/ward) used to bucket weather,
case history, and predictions spatially.

| Column | Type | Constraints | Meaning |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Region identifier |
| `code` | `text` | unique, not null | Stable external code (e.g. admin code) |
| `name` | `text` | not null | Display name |
| `admin_level` | `smallint` | not null | 1=state, 2=district, 3=ward |
| `population` | `integer` | nullable | Used for `population_density` feature |
| `geom` | `geometry(MultiPolygon, 4326)` | not null | Region boundary |

**Indexes:** `idx_regions_geom` — GiST on `geom`. *Why:* every proximity
and containment query (map bbox clipping, "which region is this point in")
needs an index-accelerated spatial predicate; a GiST index is mandatory on
every geometry column (§4.2).

**Foreign keys:** none (root table).

## `weather_observations`

Append-only ingestion of weather readings per region, written by
`cron-weather-ingest.yml` every 3h (`WEATHER_INGEST_CADENCE`, §14).

| Column | Type | Constraints | Meaning |
|---|---|---|---|
| `id` | `bigint` | PK, identity | Row id |
| `region_id` | `uuid` | FK → `regions(id)` on delete cascade | Owning region |
| `observed_at` | `timestamptz` | not null | Observation timestamp |
| `temp_mean_c` | `numeric(4,1)` | nullable | Mean temperature |
| `temp_min_c` | `numeric(4,1)` | nullable | Min temperature |
| `temp_max_c` | `numeric(4,1)` | nullable | Max temperature |
| `humidity_pct` | `numeric(4,1)` | nullable | Relative humidity |
| `precipitation_mm` | `numeric(6,1)` | nullable | Precipitation |
| `source` | `text` | default `'openweathermap'` | Data provenance |
| `raw_payload` | `jsonb` | nullable | Original provider response, for debugging/backfill |

**Indexes:** `idx_weather_region_time` — composite `(region_id,
observed_at desc)`. *Why:* the "latest record per entity" access pattern
(feature engineering's rolling windows, §4.2) always filters by region and
orders by recency; a composite index serves both in one lookup.

**Foreign keys:** `region_id → regions(id)` `on delete cascade on update cascade` — see §4.3.

**Note:** this table is append-only — no `update`/`delete` path exists in
the application; corrections are handled by inserting a corrected row, not
mutating history.

## `dengue_cases`

Historical epidemiological ground truth, weekly aggregates per region —
the label source for model training and the `case_lag_*` features.

| Column | Type | Constraints | Meaning |
|---|---|---|---|
| `id` | `bigint` | PK, identity | Row id |
| `region_id` | `uuid` | FK → `regions(id)` on delete cascade | Owning region |
| `reported_week` | `date` | not null | ISO week start (Monday) |
| `case_count` | `integer` | not null, `check (case_count >= 0)` | Weekly case count |
| `source` | `text` | nullable | Data provenance |

**Indexes:** `uq_cases_region_week` — unique `(region_id, reported_week)`.
*Why:* enforces exactly one aggregate per region per week, which both the
`SURGE_TARGET_THRESHOLD` label computation and the `case_lag_1/2/3`
features depend on.

**Foreign keys:** `region_id → regions(id)` `on delete cascade on update cascade` — see §4.3.

## `risk_predictions`

Model output — two rows per region per batch run (`horizon_weeks` 2 and 4),
written by `cron-batch-predict.yml` every 24h (`BATCH_PREDICT_CADENCE`,
§14).

| Column | Type | Constraints | Meaning |
|---|---|---|---|
| `id` | `bigint` | PK, identity | Row id |
| `region_id` | `uuid` | FK → `regions(id)` on delete cascade | Owning region |
| `prediction_date` | `date` | not null | Date the prediction was generated for |
| `horizon_weeks` | `smallint` | not null, `check (horizon_weeks in (2, 4))` | Forecast horizon |
| `risk_score` | `numeric(4,3)` | not null, `check (risk_score between 0 and 1)` | Model probability output |
| `risk_level` | `text` | **generated always as** (stored) | Derived band — see below |
| `top_factors` | `jsonb` | nullable | SHAP top-3 contributing features, for the explainability UI |
| `model_version` | `text` | not null | Which model artifact produced this row |
| `generated_at` | `timestamptz` | default `now()` | Row creation time |

`risk_level` is a **generated stored column** implementing
`RISK_LEVEL_BANDS` (§14) exactly:
```sql
case when risk_score < 0.25 then 'low'
     when risk_score < 0.50 then 'moderate'
     when risk_score < 0.75 then 'high'
     else 'severe' end
```

**Constraints:** `horizon_weeks in (2,4)`; `risk_score between 0 and 1`;
unique `(region_id, horizon_weeks, prediction_date)`.

**Indexes:** `idx_predictions_region_date` — composite `(region_id,
prediction_date desc)`. *Why:* every read of "the latest prediction for
this region" is this exact access pattern.

**Foreign keys:** `region_id → regions(id)` `on delete cascade on update cascade` — see §4.3.

## `region_risk_summary` (materialized view)

Read-optimized surface for the map — see ADR-006. Refreshed by
`scripts/refresh-materialized-views.ts`, invoked post-batch-predict, never
on the request path.

| Column | Source |
|---|---|
| `region_id` | `regions.id` |
| `name` | `regions.name` |
| `geom` | `regions.geom` |
| `risk_score`, `risk_level`, `horizon_weeks`, `generated_at` | latest matching `risk_predictions` row per `(region_id, horizon_weeks)` |

Definition: `distinct on (r.id, p.horizon_weeks)` over `regions` joined to
`risk_predictions`, ordered by `r.id, p.horizon_weeks, p.prediction_date desc`.

**Indexes:** `uq_summary_region_horizon` — **unique** `(region_id,
horizon_weeks)` (required for `refresh materialized view concurrently` —
without it, concurrent refresh fails at runtime); `idx_summary_geom` — GiST
on `geom`, for bbox-clipped map reads.

## `breeding_reports`

Citizen-submitted breeding-site reports (ADR-005: anonymous allowed).

| Column | Type | Constraints | Meaning |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Report id |
| `reporter_id` | `uuid` | FK → `auth.users(id)`, nullable | Null for anonymous submissions |
| `geom` | `geometry(Point, 4326)` | not null | Report location |
| `description` | `text` | nullable | Free-text description |
| `photo_url` | `text` | nullable | Optional photo evidence |
| `ai_validation` | `jsonb` | nullable | Gemini structured-output payload (§5.4) |
| `status` | `text` | not null, default `'pending'`, `check (status in ('pending','verified','rejected','resolved'))` | Moderation state |
| `verified_by` | `uuid` | FK → `auth.users(id)`, nullable | Moderator who actioned the report |
| `municipal_ref_id` | `text` | nullable | External tracking reference once escalated |
| `created_at` | `timestamptz` | default `now()` | Submission time |

**Indexes:** `idx_breeding_geom` — GiST on `geom`; `idx_breeding_pending` —
**partial** index on `(status)` where `status = 'pending'`. *Why partial:*
the moderator queue only ever queries pending reports — indexing just that
subset keeps the index small and the queue query fast as `verified`/
`rejected`/`resolved` rows accumulate.

**Foreign keys:** `reporter_id → auth.users(id)` `on delete set null on update cascade`; `verified_by → auth.users(id)` `on delete set null on update cascade` — see §4.3.

## `hospitals`

| Column | Type | Constraints | Meaning |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Hospital id |
| `name` | `text` | not null | Display name |
| `geom` | `geometry(Point, 4326)` | not null | Location |
| `address` | `text` | nullable | Street address |
| `phone` | `text` | nullable | Contact number |
| `verified` | `boolean` | default `false` | Admin-verified listing |
| `updated_at` | `timestamptz` | default `now()` | Last edit |

**Indexes:** `idx_hospitals_geom` — GiST on `geom`. *Why:* nearest-hospital
and bbox map queries.

**Foreign keys:** none.

## `blood_group` (enum)

```sql
create type blood_group as enum ('A+','A-','B+','B-','AB+','AB-','O+','O-');
```

All 8 standard blood groups. Used by `blood_inventory.blood_group`.

## `blood_inventory`

| Column | Type | Constraints | Meaning |
|---|---|---|---|
| `id` | `bigint` | PK, identity | Row id |
| `hospital_id` | `uuid` | FK → `hospitals(id)` on delete cascade | Owning hospital |
| `blood_group` | `blood_group` | not null | Which group this row tracks |
| `units_available` | `integer` | not null, default `0`, `check (units_available >= 0)` | Whole-blood units |
| `platelet_units` | `integer` | default `0`, `check (platelet_units >= 0)` | Platelet units |
| `updated_by` | `uuid` | FK → `auth.users(id)`, nullable | Who last updated this row |
| `updated_at` | `timestamptz` | default `now()` | Last update |

**Constraints:** unique `(hospital_id, blood_group)` — exactly one
inventory row per hospital per blood group.

**Foreign keys:** `hospital_id → hospitals(id)` `on delete cascade on update cascade`; `updated_by → auth.users(id)` `on delete set null on update cascade` — see §4.3.

## `verified_hospital_staff`

Join table gating who may update a hospital's `blood_inventory`.

| Column | Type | Constraints | Meaning |
|---|---|---|---|
| `user_id` | `uuid` | FK → `auth.users(id)`, PK (composite) | Staff member |
| `hospital_id` | `uuid` | FK → `hospitals(id)`, PK (composite) | Hospital they're verified for |

**Foreign keys:** `user_id → auth.users(id)` `on delete cascade on update cascade`; `hospital_id → hospitals(id)` `on delete cascade on update cascade` — see §4.3.

## `alert_subscriptions`

Proximity geofence definitions for push alerting.

| Column | Type | Constraints | Meaning |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Subscription id |
| `user_id` | `uuid` | FK → `auth.users(id)` on delete cascade | Owner |
| `geom` | `geometry(Point, 4326)` | not null | Watch-point location |
| `radius_m` | `integer` | not null, default `2000`, `check (radius_m between 100 and 20000)` | Alert radius, matches `ALERT_PROXIMITY_RADIUS_DEFAULT_M` bounds (§14) |
| `active` | `boolean` | default `true` | Whether alerts are currently delivered |
| `created_at` | `timestamptz` | default `now()` | Creation time |

**Indexes:** `idx_alerts_geom` — GiST on `geom`. *Why:* the batch-predict
job's `ST_DWithin` proximity check against every active subscription needs
this to be indexed, not a sequential scan, as subscription volume grows.

**Foreign keys:** `user_id → auth.users(id)` `on delete cascade on update cascade` — see §4.3.

## `push_subscriptions`

Web Push delivery targets — one row per browser subscription per device.

| Column | Type | Constraints | Meaning |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Row id |
| `user_id` | `uuid` | FK → `auth.users(id)` on delete cascade | Owner |
| `endpoint` | `text` | not null, unique | Push service endpoint URL |
| `p256dh` | `text` | not null | Push encryption key |
| `auth_key` | `text` | not null | Push auth secret |
| `created_at` | `timestamptz` | default `now()` | Registration time |

**Foreign keys:** `user_id → auth.users(id)` `on delete cascade on update cascade` — see §4.3.

## `news_items`

News aggregator agent output (§5.4), pending moderator review before it
can influence anything public-facing.

| Column | Type | Constraints | Meaning |
|---|---|---|---|
| `id` | `bigint` | PK, identity | Row id |
| `source_url` | `text` | not null, unique | Prevents re-ingesting the same article |
| `title` | `text` | nullable | Article title |
| `published_at` | `timestamptz` | nullable | Publish timestamp |
| `region_guess` | `uuid` | FK → `regions(id)`, nullable | Gemini-inferred region association |
| `ai_confidence` | `numeric(3,2)` | nullable | Confidence score for `region_guess`/classification |
| `flagged` | `boolean` | default `false` | Needs human attention |
| `reviewed` | `boolean` | default `false` | Human review complete — gates any public-facing use |
| `created_at` | `timestamptz` | default `now()` | Ingestion time |

**Foreign keys:** `region_guess → regions(id)` `on delete set null on update cascade` — see §4.3.

---

## `role_assignments`

Append-only audit trail for role grants
(`20260816000013_rbac_roles_and_audit.sql`, `docs/features/rbac.md`).
Added after the original §4 schema, which had no role-assignment concept
at all. It records history and never gates a request —
`app_metadata.role` on the Supabase auth user remains the sole
authorization source.

| Column | Type | Constraints | Meaning |
|---|---|---|---|
| `id` | `bigint` | PK, identity | Row id |
| `user_id` | `uuid` | FK → `auth.users(id)`, not null | Whose role changed |
| `previous_role` | `text` | check ∈ the four roles, nullable | What was replaced; null when there was no explicit claim |
| `new_role` | `text` | check ∈ the four roles, not null | What was granted |
| `assigned_by` | `uuid` | FK → `auth.users(id)`, nullable | The acting admin; **null means granted out of band** via `scripts/grant-role.ts` |
| `reason` | `text` | nullable | Free-text justification from the admin |
| `created_at` | `timestamptz` | not null, default `now()` | When |

**Indexes:** `idx_role_assignments_user_created (user_id, created_at desc)` —
the per-user drill-down is the only read pattern.

**Foreign keys:** `user_id → auth.users(id)` `on delete cascade on update
cascade`; `assigned_by → auth.users(id)` `on delete set null on update
cascade` — deliberately **not** cascade, so an audit row survives the
granting admin's account being deleted (§4.3).

## `announcements`

Author-broadcast messages, added after the original §4 schema
(`20260817000017_announcements.sql`). **Not** `alert_subscriptions` with a
flag: `alert_subscriptions` is a user subscribing to an area; this is a
moderator/admin author broadcasting to one. Inverse relationship, inverse
ownership, separate RLS from the proximity-alert tables above — and
separate from the batch-predict push path in
`docs/features/push-notifications.md`, which only ever fires on a region
crossing into `high`/`severe` risk, never on an announcement.

| Column | Type | Constraints | Meaning |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Row id |
| `author_id` | `uuid` | FK → `auth.users(id)` on delete set null | Moderator/admin who created it |
| `title` | `text` | not null, `check` (1–120 chars) | Headline |
| `body` | `text` | not null, `check` (1–1000 chars) | Message content |
| `geom` | `geometry(Point, 4326)` | not null | Broadcast origin point |
| `radius_m` | `integer` | not null, default `5000`, `check (radius_m between 500 and 50000)` | Broadcast radius — wider bounds than `alert_subscriptions.radius_m` since an author is targeting a known area, not an individual watch-point |
| `target_roles` | `text[]` | not null, default `'{}'` | Empty = every role; non-empty = only these roles see it |
| `expires_at` | `timestamptz` | not null, `check (expires_at > created_at)` | When the announcement stops being live |
| `created_at` | `timestamptz` | not null, default `now()` | Creation time |

**Indexes:** `idx_announcements_geom` — GiST on `geom`, for the same
reason every geometry column gets one (§4.2). `idx_announcements_active`
— plain index on `expires_at desc`, **not** a partial index: Postgres
requires an `IMMUTABLE` predicate for a partial index and `now()` is only
`STABLE`, so `where expires_at > now()` is rejected at `create index`
time. The plain index still serves the live-rows read path via a range
scan.

**Foreign keys:** `author_id → auth.users(id)` `on delete set null on
update cascade` — see §4.3.

**RLS:** enabled. Authors with the `reports:moderate` capability get
unrestricted `all`; every authenticated reader gets `select` filtered to
`expires_at > now()` **and** role-targeted (`target_roles` empty, or the
caller's JWT role is in it). Proximity is **not** part of the policy — a
Postgres RLS predicate cannot see the caller's location, so the
`ST_DWithin` narrowing happens in the `apps/api` query itself
(`GET /api/announcements`), not at the row-security layer. Targeting is
read-time, not write-time fan-out: creating an announcement writes exactly
one row regardless of how many users are in range or match `target_roles`;
every matching reader's `GET /api/announcements` call re-evaluates
proximity and role against that same row on every request, rather than a
job pre-computing and duplicating it per recipient the way
`push_subscriptions` deliveries do.

---

## 4.1 Row Level Security (representative policies)

Full detail and every operation for every table lives in
`docs/data-schema/rls-policies.md`. Summary:

| Table | Policy | Rule |
|---|---|---|
| `breeding_reports` | insert | any role (incl. `anon`) — abuse handled by rate-limit + Turnstile in `apps/api`, not RLS |
| `breeding_reports` | select | `status = 'verified'` OR `reporter_id = auth.uid()` |
| `breeding_reports` | update | `public.has_capability('reports:moderate')` |
| `blood_inventory` | select | public (`anon`) — required for direct Realtime subscription (ADR-010) |
| `blood_inventory` | update | `public.has_capability('inventory:write')` **and** `auth.uid() in (select user_id from verified_hospital_staff where hospital_id = blood_inventory.hospital_id)` |
| `alert_subscriptions`, `push_subscriptions` | all | `user_id = auth.uid()` only |
| `risk_predictions`, `hospitals` (select) | select | public (`anon`) |
| `role_assignments` | select | `public.has_capability('roles:manage')`; no update or delete policy at all |
| `announcements` | all (author) | `public.has_capability('reports:moderate')` |
| `announcements` | select (reader) | `expires_at > now()` and role-targeted (`target_roles` empty or caller's role in it); proximity filtered in the query, not the policy |

RLS is **on** for every table by default; a table without RLS enabled must
have an ADR justifying it. `public.has_capability()` is the SQL mirror of
`ROLE_CAPABILITIES` (`packages/security/roles.ts`) — see
`docs/features/rbac.md`. It replaced the role-name lists that
`20260815000012` had itself introduced to replace the original,
always-false `auth.role() in (...)` predicates (§4.1 amendment).

## 4.2 Indexing & Query Discipline

- Every geometry column: **GiST index**, non-negotiable.
- Every "latest record per entity" query: composite index
  `(entity_id, timestamp desc)`.
- Every hot read path for the UI: served from a materialized view or
  covering index, never a live `ST_DWithin` join against raw tables on the
  request path.
- Statement timeout: `5s` enforced at the Supabase connection role level
  (`DB_STATEMENT_TIMEOUT_S`, §14) to prevent runaway spatial queries from
  starving the pool.

## 4.3 Foreign Key Action Policy

Every foreign key in §4 declares its `on delete`/`on update` behavior
explicitly — never the Postgres default (`no action`) — so a `delete` or
`update` against a parent row cannot fail at runtime with an opaque
constraint-violation error. There is no separate "on insert" action to
configure: a foreign key is checked at `insert`/`update` time by
definition — the referenced row must already exist — which is what makes
referential integrity automatic rather than something application code
has to re-implement.

| Child → Parent | `on delete` | `on update` | Why |
|---|---|---|---|
| `weather_observations.region_id → regions(id)` | `cascade` | `cascade` | Append-only weather history has no meaning once its region is gone |
| `dengue_cases.region_id → regions(id)` | `cascade` | `cascade` | Case history is meaningless detached from a region |
| `risk_predictions.region_id → regions(id)` | `cascade` | `cascade` | Predictions are derived from a region; deleting it invalidates them |
| `breeding_reports.reporter_id → auth.users(id)` | `set null` | `cascade` | Nullable column (anonymous reports, ADR-005) — a deleted account's reports stay for the moderation record, anonymized rather than removed |
| `breeding_reports.verified_by → auth.users(id)` | `set null` | `cascade` | A verified report must outlive the verifying moderator's account; only the attribution is lost |
| `blood_inventory.hospital_id → hospitals(id)` | `cascade` | `cascade` | Inventory rows have no independent existence outside their hospital |
| `blood_inventory.updated_by → auth.users(id)` | `set null` | `cascade` | The Realtime-fed inventory data (ADR-010) must not disappear because a staff account was removed |
| `verified_hospital_staff.user_id → auth.users(id)` | `cascade` | `cascade` | A deleted account should not retain a staff-verification row |
| `verified_hospital_staff.hospital_id → hospitals(id)` | `cascade` | `cascade` | Staff verification is meaningless once the hospital no longer exists |
| `alert_subscriptions.user_id → auth.users(id)` | `cascade` | `cascade` | A deleted account's geofences must stop matching and evaluating |
| `push_subscriptions.user_id → auth.users(id)` | `cascade` | `cascade` | No point delivering push to a subscription owned by a deleted account |
| `news_items.region_guess → regions(id)` | `set null` | `cascade` | Nullable, advisory AI-inferred column (§5.4) — losing the guess must not delete ingested news content |

`on update cascade` is applied uniformly even though every referenced key
is a `uuid` primary key the application never mutates in practice — it
costs nothing at runtime and removes a class of "why did this update
fail" surprise if a key is ever legitimately reassigned (e.g. a manual
data-repair `update`).

## Entity-Relationship Diagram

```mermaid
erDiagram
    regions {
        uuid id PK
        text code UK
        text name
        smallint admin_level
        integer population
        geometry geom
    }
    weather_observations {
        bigint id PK
        uuid region_id FK
        timestamptz observed_at
        numeric temp_mean_c
        jsonb raw_payload
    }
    dengue_cases {
        bigint id PK
        uuid region_id FK
        date reported_week
        integer case_count
    }
    risk_predictions {
        bigint id PK
        uuid region_id FK
        date prediction_date
        smallint horizon_weeks
        numeric risk_score
        text risk_level "generated"
        text model_version
    }
    region_risk_summary {
        uuid region_id "from regions.id"
        text name
        geometry geom
        numeric risk_score
        text risk_level
        smallint horizon_weeks
    }
    breeding_reports {
        uuid id PK
        uuid reporter_id FK "nullable"
        geometry geom
        text status
        uuid verified_by FK "nullable"
    }
    hospitals {
        uuid id PK
        text name
        geometry geom
        boolean verified
    }
    blood_inventory {
        bigint id PK
        uuid hospital_id FK
        blood_group blood_group
        integer units_available
        uuid updated_by FK "nullable"
    }
    verified_hospital_staff {
        uuid user_id PK "FK"
        uuid hospital_id PK "FK"
    }
    alert_subscriptions {
        uuid id PK
        uuid user_id FK
        geometry geom
        integer radius_m
    }
    push_subscriptions {
        uuid id PK
        uuid user_id FK
        text endpoint UK
    }
    news_items {
        bigint id PK
        text source_url UK
        uuid region_guess FK "nullable"
        boolean reviewed
    }
    auth_users {
        uuid id PK
        text email
    }

    regions ||--o{ weather_observations : "on delete cascade"
    regions ||--o{ dengue_cases : "on delete cascade"
    regions ||--o{ risk_predictions : "on delete cascade"
    regions ||--o{ news_items : "on delete set null"
    regions ||--o{ region_risk_summary : "summarized in"
    risk_predictions ||--o{ region_risk_summary : "latest row feeds"
    hospitals ||--o{ blood_inventory : "on delete cascade"
    hospitals ||--o{ verified_hospital_staff : "on delete cascade"
    auth_users ||--o{ verified_hospital_staff : "on delete cascade"
    auth_users |o--o{ breeding_reports : "reporter_id, on delete set null"
    auth_users |o--o{ breeding_reports : "verified_by, on delete set null"
    auth_users ||--o{ alert_subscriptions : "on delete cascade"
    auth_users ||--o{ push_subscriptions : "on delete cascade"
    auth_users |o--o{ blood_inventory : "updated_by, on delete set null"
```

`auth_users` above refers to Supabase's built-in `auth.users` table,
managed by Supabase Auth, not created by this project's migrations. Every
edge label states the child's `on delete` action (§4.3) — `||` denotes a
mandatory (`not null`) foreign key, `|o` denotes an optional (nullable)
one.

## 4.4 API Read Views

`packages/db/supabase/migrations/20260215000009_api_read_views.sql` adds
four read-only views for `apps/api`. None adds, alters, or removes a
table, column, or index — §4 above remains the schema of record. Each
view exists because PostgREST (what `@supabase/supabase-js` talks to)
cannot itself call `ST_AsGeoJSON`, `ST_Centroid`,
`ST_SimplifyPreserveTopology`, express `DISTINCT ON`, or express a bbox
intersection — every view pushes exactly one of those operations into SQL
and exposes plain scalars the REST layer can filter on.

All four are declared `with (security_invoker = true)`: without it, a
view runs with its definer's rights and silently bypasses the RLS
policies in `20260201000007_rls_policies.sql`. `apps/api` currently reads
every one of them with the service-role key, which bypasses RLS
regardless — `security_invoker` is defense in depth for any future
anon/authenticated read added later, not a control this slice currently
depends on. None of the four carries a `grant` to `anon` or
`authenticated`; only the service role can query them today.

| View | Reads | Exposes | Consumed by |
|---|---|---|---|
| `region_weather_observations` | `weather_observations` joined to `regions` | Every observation row with `region_code`/`region_name` attached, so a caller never needs a second round trip for the region label | `GET /api/weather/history` |
| `region_latest_weather` | `region_weather_observations` | `select distinct on (region_id) ...` ordered by `observed_at desc` — one row per region, the newest observation | `GET /api/weather/latest` |
| `region_ingest_targets` | `regions` | One row per region: `region_id`, `code`, `name`, and `lat`/`lon` as plain `numeric(9,6)` from `ST_Y`/`ST_X` of `ST_Centroid(geom)` — emitted as numerics, not geometry, so the ingest job never decodes WKB | `scripts/jobs/weather-ingest.ts` |
| `region_risk_geojson` | `region_risk_summary` (materialized view, §4) | Per-region `risk_score`, `risk_level`, `horizon_weeks`, `generated_at`, a GeoJSON `geometry` column (`ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.001))::jsonb` — `MAP_GEOMETRY_SIMPLIFY_TOLERANCE_DEG`, §14) and a plain-numeric bounding envelope (`min_lon`, `min_lat`, `max_lon`, `max_lat`) so `?bbox=` is expressible as four ordinary PostgREST range filters | `GET /api/risk-map` |

`region_risk_geojson`'s envelope columns are the mechanism, not an
incidental detail: two boxes intersect iff `a.min <= b.max` on both axes,
which is four range comparisons PostgREST already knows how to build from
query parameters — no bbox-intersection operator has to reach the REST
layer at all.
