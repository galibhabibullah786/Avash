# Manual Deployment Runbook

**Read when:** deploying any service by hand, or setting up an environment for the first time.

**Decides:** Per-service, per-environment commands with preconditions, verification, and rollback.

How to deploy every service by hand, per environment, without CI. One
section per service; each covers **preview** (the `dev` environment) and
**production** (the `main` environment) separately, with preconditions,
the exact commands, verification, and rollback.

**CI is the normal path and this is not a replacement for it.** A manual
deploy skips every merge gate — lint, typecheck, both test layers, CodeQL,
the image scans, and the bundle checks. Use this document when CI is
unavailable, during an incident, for the very first deploy of an
environment before the pipeline is wired, or to reproduce a CI deploy
locally to debug it. Then go back to the pipeline.

Related: `docs/ci-cd.md` (the automated pipeline),
`docs/security/github-environments.md` (per-environment credentials),
`docs/security/secrets-matrix.md` (obtaining each credential),
`docs/docker.md` (containers).

---

## Before any manual deploy

Run through this every time. Skipping it is how a manual deploy ships a
half-finished working tree.

```bash
git status --porcelain          # must be empty
git rev-parse --abbrev-ref HEAD # must be dev (preview) or main (production)
git log --oneline -1            # note this SHA — it is what you are shipping

pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

You are deliberately running the gates by hand because nothing else will.
If any of them fails, stop — a manual deploy is not a reason to ship a red
tree. Record the SHA you noted; every verification step below refers back
to it, and every rollback needs it.

**Environment discipline.** `preview` and `production` are separate
Cloudflare resources, separate Supabase projects, separate Upstash
databases, and separate credentials. Before running any command, confirm
which environment your shell is pointed at. The single most common manual
deploy incident is a `--env production` typed while intending preview.

| | Preview | Production |
|---|---|---|
| Branch | `dev` | `main` |
| Worker | `avash-api-preview` | `avash-api` |
| `wrangler --env` | `preview` | `production` |
| Pages branch | `dev` | `main` |
| Supabase project | the preview project | the production project |
| Local env file | `.env.preview` | `.env.production` |

Keep the two credential sets in **separate files**, never in one `.env`
with commented-out blocks. A commented-out production key is one
uncomment away from an incident.

---

## Service 1 — Backend (`apps/api`, Cloudflare Workers)

### Preconditions

- `wrangler` authenticated: `pnpm dlx wrangler whoami`. If it prints no
  account, run `pnpm dlx wrangler login` (browser flow) or export
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for the environment
  you are deploying to.
- The target environment exists in `apps/api/wrangler.toml` (`[env.preview]`
  / `[env.production]`).
- Every secret the Worker reads is already set **in that environment** —
  see § Setting Worker secrets below.

### Deploy — preview

```bash
cd apps/api

pnpm dlx wrangler whoami                     # confirm the right account
pnpm dlx wrangler deploy --env preview --dry-run --outdir=/tmp/avash-api-dry
pnpm dlx wrangler deploy --env preview
```

Run the `--dry-run` first, every time. It bundles exactly what a real
deploy would and fails on the same errors without publishing anything —
the cheapest possible way to catch a bad binding or a missing module.

### Deploy — production

```bash
cd apps/api

pnpm dlx wrangler whoami
pnpm dlx wrangler deployments list --env production   # note the CURRENT deployment ID first
pnpm dlx wrangler deploy --env production --dry-run --outdir=/tmp/avash-api-dry
pnpm dlx wrangler deploy --env production
```

**Record the current deployment ID before deploying.** It is what you roll
back to, and looking it up after a bad deploy is slower and more stressful
than writing it down beforehand.

### Setting Worker secrets

Secrets are per-environment and are never committed. `wrangler.toml`'s
`[vars]` block lists the *names* only, as an inventory comment.

```bash
cd apps/api

# One at a time, value entered at the prompt (never as an argument —
# arguments land in shell history).
pnpm dlx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env preview
pnpm dlx wrangler secret put SUPABASE_JWT_SECRET       --env preview
pnpm dlx wrangler secret put GEMINI_API_KEY            --env preview
pnpm dlx wrangler secret put UPSTASH_REDIS_REST_URL    --env preview
pnpm dlx wrangler secret put UPSTASH_REDIS_REST_TOKEN  --env preview
pnpm dlx wrangler secret put TURNSTILE_SECRET_KEY      --env preview

# List what is set (names only — values are never retrievable)
pnpm dlx wrangler secret list --env preview
```

Repeat with `--env production` and the production values. A secret set on
one environment does **not** exist on the other.

### Verify

```bash
# Preview
curl -sS -o /dev/null -w '%{http_code}\n' https://avash-api-preview.<subdomain>.workers.dev/health
curl -sS https://avash-api-preview.<subdomain>.workers.dev/health | jq .

# Production
curl -sS -o /dev/null -w '%{http_code}\n' https://<production-api-origin>/health
curl -sS https://<production-api-origin>/health | jq .
```

Expect `200` and `{"status":"ok", ...}`. Then check the two things a
health endpoint cannot tell you:

```bash
# CORS still rejects an unlisted origin
curl -sS -I -H 'Origin: https://evil.example' https://<origin>/health \
  | grep -i 'access-control-allow-origin' && echo "FAIL: header present" || echo "ok: rejected"

# The deployed version is the SHA you meant to ship
pnpm dlx wrangler deployments list --env production | head -20
```

Tail live logs while you exercise it:

```bash
pnpm dlx wrangler tail --env production --format pretty
```

### Rollback

```bash
cd apps/api

pnpm dlx wrangler deployments list --env production
pnpm dlx wrangler rollback <deployment-id> --env production
curl -sS https://<production-api-origin>/health | jq .
```

`wrangler rollback` restores the previous **code**. It does not revert
secrets or `wrangler.toml` vars — if the bad deploy changed either, undo
that separately with `wrangler secret put` before rolling back, or the
rolled-back code runs against the new configuration.

---

## Service 2 — Frontend (`apps/web`, Cloudflare Pages)

### Preconditions

- The Cloudflare Pages project exists (`avash`). If not, create it once via
  the dashboard: **Workers & Pages → Create → Pages → Direct Upload**, name
  it `avash`, then use the CLI from then on.
- The `apps/api` deploy for the same environment is already live. The
  frontend's API base URL is baked into the bundle at build time, so
  building against an origin that does not answer yet produces a bundle
  that is wrong the moment it ships.

### The build-time coupling — read this before building

Vite **inlines** every `VITE_PUBLIC_*` value at build time. There is no
runtime configuration. That means:

- A preview bundle and a production bundle are **different artifacts**,
  even from an identical commit.
- You cannot promote a preview build to production. You must rebuild.
- Getting the env values wrong produces a bundle that builds and deploys
  cleanly and then talks to the wrong backend.

### Deploy — preview

```bash
# From the repository root. Set every VITE_PUBLIC_* for THIS environment.
export VITE_PUBLIC_API_BASE_URL="https://avash-api-preview.<subdomain>.workers.dev"
export VITE_PUBLIC_SUPABASE_URL="https://<preview-ref>.supabase.co"
export VITE_PUBLIC_SUPABASE_ANON_KEY="<preview-anon-key>"
export VITE_PUBLIC_TURNSTILE_SITE_KEY="<preview-site-key>"
export VITE_PUBLIC_VAPID_PUBLIC_KEY="<preview-vapid-public>"

pnpm --filter web build

# Confirm no server secret was inlined — this is the R2 gate, by hand.
node scripts/scan-client-env.mjs
node scripts/check-bundle-budget.mjs

pnpm dlx wrangler pages deploy apps/web/dist \
  --project-name=avash \
  --branch=dev
```

### Deploy — production

Identical, with production values and `--branch=main`:

```bash
export VITE_PUBLIC_API_BASE_URL="https://<production-api-origin>"
export VITE_PUBLIC_SUPABASE_URL="https://<prod-ref>.supabase.co"
export VITE_PUBLIC_SUPABASE_ANON_KEY="<prod-anon-key>"
export VITE_PUBLIC_TURNSTILE_SITE_KEY="<prod-site-key>"
export VITE_PUBLIC_VAPID_PUBLIC_KEY="<prod-vapid-public>"

pnpm --filter web build
node scripts/scan-client-env.mjs
node scripts/check-bundle-budget.mjs

pnpm dlx wrangler pages deploy apps/web/dist \
  --project-name=avash \
  --branch=main
```

Cloudflare Pages treats the branch named as the project's production
branch (`main`) as the production deployment; every other branch name is a
preview deployment. `--branch` is therefore the entire difference between
shipping to users and shipping to a preview URL — check it twice.

**Never `export` a non-`VITE_PUBLIC_` variable in the shell you build in.**
Vite will not inline it, but a stray value in the build environment is a
step away from being referenced. Use a fresh shell for a production build.

### Verify

```bash
BASE=https://avash.pages.dev   # or the production domain

curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/"
curl -sSI "$BASE/" | grep -i 'content-security-policy'   # headers applied
curl -sS "$BASE/" | grep -io '<title>[^<]*</title>'

# The SPA fallback works — a deep link must return the app, not a 404
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/report"

# No server secret reached the bundle
curl -sS "$BASE/" | grep -iE 'service_role|jwt_secret|sk-|SUPABASE_SERVICE' \
  && echo "FAIL: possible secret in HTML" || echo "ok"
```

Then open it in a browser and confirm, in the network tab, that requests go
to the **intended** API origin. That is the check that catches a bundle
built with the wrong `VITE_PUBLIC_API_BASE_URL`, and no curl can do it for
you.

Two things that fail only in production because a dev server does not
serve them:

- **CSP `img-src`** — the OpenStreetMap tile host must be allow-listed in
  `apps/web/public/_headers`, or the basemap is blocked while everything
  else works (ADR-013).
- **Turnstile domain restriction** — the site key must list the production
  domain, or the widget silently fails to render.

### Rollback

Pages keeps every deployment. Roll back through the dashboard —
**Workers & Pages → avash → Deployments →** find the last known-good
deployment **→ ⋯ → Rollback to this deployment**. It is instant and needs
no rebuild.

Alternatively, rebuild the previous commit and redeploy:

```bash
git checkout <last-good-sha>
# re-export the same VITE_PUBLIC_* values, then:
pnpm --filter web build && pnpm dlx wrangler pages deploy apps/web/dist \
  --project-name=avash --branch=main
git checkout main
```

Prefer the dashboard rollback. It ships bytes that were already verified;
a rebuild ships new bytes that merely came from the same source.

---

## Service 3 — Database (Supabase / PostGIS)

The highest-risk service in this document. A Worker rolls back in seconds;
a migration that drops a column does not.

### Preconditions

- `supabase` CLI installed and authenticated (`supabase login`).
- The migration has been applied and tested against the **local**
  container first — always: `pnpm docker:db`, then `pnpm db:migrate`
  against it (`docs/docker.md`).
- A fresh backup of the target environment.
- Migrations are forward-only and idempotent where possible. Every
  migration has a written down-path, even if it is "restore from backup."
- Run every `supabase` command below **from `packages/db`** — that's
  where `supabase/migrations` actually lives (`packages/db/supabase/migrations`).
  Run from the repo root instead and `supabase link` still succeeds, but
  `db push`/`db diff` silently find zero local migration files and report
  "up to date" even against a completely empty database — a false
  negative, not a real confirmation.

`packages/db/scripts/push-hosted.mjs` wraps `link` + `db push` from the
right directory so this can't be gotten wrong:

```bash
pnpm --filter @avash/db run db:push:hosted <project-ref> --dry-run   # what would run
pnpm --filter @avash/db run db:push:hosted <project-ref>             # apply
```

### Deploy — preview

```bash
cd packages/db
supabase link --project-ref <preview-project-ref>

supabase db diff --linked            # what would change — read every line
supabase db push --dry-run           # what would run
supabase db push                     # apply
cd ../..

pnpm db:seed -- --hosted             # preview only, if the environment wants sample data —
                                      # requires DATABASE_URL_HOSTED in .env (docs/security/secrets-matrix.md § 9a)
```

### Deploy — production

```bash
cd packages/db

# 1. Back up first. Non-negotiable.
supabase link --project-ref <production-project-ref>
supabase db dump --linked -f "backup-$(date -u +%Y%m%dT%H%M%SZ).sql"
ls -lh backup-*.sql                  # confirm it is a real file, not 0 bytes

# 2. Review exactly what will run.
supabase db diff --linked
supabase db push --dry-run

# 3. Apply.
supabase db push
```

Read the `--dry-run` output line by line before applying. `DROP`,
`ALTER COLUMN ... TYPE`, and `NOT NULL` on an existing column are the three
that take an application down; if you see one, stop and confirm it is
intended and that the deployed API already tolerates both shapes.

Never point `db:reset` or any destructive script at a hosted project. It
exists for the local container.

### Verify

```bash
# RLS is enabled on every table — the single most important check
psql "$DATABASE_URL" -c "
  select schemaname, tablename, rowsecurity
  from pg_tables
  where schemaname = 'public'
  order by tablename;"

# Every geometry column has a GiST index
psql "$DATABASE_URL" -c "
  select t.relname as table, i.relname as index, am.amname
  from pg_class t
  join pg_index ix on t.oid = ix.indrelid
  join pg_class i on i.oid = ix.indexrelid
  join pg_am am on i.relam = am.oid
  where am.amname = 'gist';"

# Extensions present
psql "$DATABASE_URL" -c "select postgis_version();"
psql "$DATABASE_URL" -c "select extname from pg_extension;"
```

Then confirm the API agrees, once the readiness probe exists:

```bash
curl -sS https://<production-api-origin>/health/db | jq .
```

A table with `rowsecurity = false` is a finding, not a note. Fix it before
anything writes to it.

Also confirm `apps/api` can actually read through PostgREST with its own
key — RLS being enabled is not sufficient, `service_role` needs an
explicit ACL grant too, and on a fresh Supabase project it does **not**
get one automatically (`20260215000010_service_role_grants.sql` is what
grants it; if a first-time environment setup predates that migration,
every table and view 404s/403s from `apps/api` even though `psql` as the
`postgres` role works fine):

```bash
curl -sS "$SUPABASE_URL/rest/v1/regions?select=id&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -w '\nstatus: %{http_code}\n'
```

Expect `200`. A `42501 permission denied` body means the grants migration
hasn't been applied to this project.

### Rollback

There is no `supabase db pop`. In order of preference:

1. **Forward-fix.** Write a new migration that corrects the problem. This
   is almost always right, and it is the only option that keeps the
   migration history honest.
2. **Targeted manual SQL**, if the change was small and reversible (a
   dropped index, an added constraint) — then immediately write the
   migration that records what you did, so the next environment does not
   diverge.
3. **Restore from the backup you took**, accepting the loss of everything
   written since. This is a data-loss event; treat it as an incident, not
   a rollback.

---

## Service 4 — Scheduled jobs (weather ingest, batch predict, news scan)

These run as scheduled GitHub Actions talking directly to Supabase — they
are never HTTP endpoints on `apps/api` (ADR-007), so there is nothing to
"deploy." Running one by hand means running its script.

### Run against preview

```bash
set -a; source .env.preview; set +a

pnpm tsx scripts/jobs/weather-ingest.ts
pnpm tsx scripts/jobs/news-scan.ts
python ml/serving/predict.py          # or: pnpm docker:ml python ml/serving/predict.py
```

### Run against production

```bash
set -a; source .env.production; set +a
pnpm tsx scripts/jobs/weather-ingest.ts
```

**Every one of these holds the service-role key and bypasses RLS
entirely.** Confirm which `.env.*` file is sourced before running
anything, and prefer running the job through GitHub Actions
(`workflow_dispatch` on the relevant `cron-*` workflow) over running it on
a laptop — Actions has the credentials scoped correctly and leaves an audit
trail.

Verify by checking the rows the job was supposed to write:

```bash
psql "$DATABASE_URL" -c "
  select max(observed_at), count(*) from weather_observations
  where observed_at > now() - interval '2 hours';"
```

### Rollback

Jobs are append-mostly, so rollback means deleting what the run wrote.
Scope the delete by the run's timestamp window and take a backup first.
For a job that also sends Web Push notifications, note that a delivered
notification cannot be recalled — verify quietly before running a
notification-sending job by hand.

---

## Service 5 — ML model artifact

### Preconditions

- Training data present (`ml/data`, via DVC pull).
- The pinned Python image, so the export is reproducible:
  `pnpm docker:ml:build`.

### Build and export

```bash
pnpm docker:ml python ml/training/train.py
pnpm docker:ml python ml/training/export_onnx.py
```

`export_onnx.py` writes the artifact into `packages/ml-inference` and
records its SHA256 in `ml/training/MODEL_MANIFEST.json`.

### Verify before shipping

```bash
sha256sum packages/ml-inference/**/*.onnx
cat ml/training/MODEL_MANIFEST.json

ls -lh packages/ml-inference/**/*.onnx      # must be under the size budget
```

The checksum in the manifest must match the artifact byte for byte — CI
gates on this, and a manual deploy has to check it by hand. A model whose
metrics miss the promotion gate in `docs/ml/model-card.md` is not shipped,
regardless of how much better it looks on a different metric.

### Deploy

The artifact ships **inside** `apps/web`'s bundle (on-device inference) and
is used by the batch job. So there is no separate model deploy: rebuild and
redeploy the frontend (Service 2) and re-run the batch job (Service 4).
Update `docs/ml/model-card.md` in the same change — a model version with no
card entry is not deployable.

### Rollback

`git revert` the commit that introduced the artifact, then redeploy the
frontend. The checksum check makes a partial rollback — new manifest, old
artifact — fail loudly rather than silently serve the wrong model.

---

## Service 6 — Container images (portability artifact, not a deploy path)

Both apps ship images (ADR-012), and **no deploy path consumes them.**
Production is Cloudflare Pages and `wrangler deploy`. Publish an image for
handover, for running the stack without a Node toolchain, or for local
verification — never as a way to release.

```bash
# Build (context is the repository root)
docker build -f apps/api/Dockerfile -t ghcr.io/<owner>/avash-api:sha-$(git rev-parse --short HEAD) .
docker build -f apps/web/Dockerfile \
  --build-arg VITE_PUBLIC_API_BASE_URL="https://<origin>" \
  -t ghcr.io/<owner>/avash-web:sha-$(git rev-parse --short HEAD) .

# Scan before pushing — the same gate CI applies
trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 \
  ghcr.io/<owner>/avash-api:sha-$(git rev-parse --short HEAD)

# Push
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <username> --password-stdin
docker push ghcr.io/<owner>/avash-api:sha-$(git rev-parse --short HEAD)
```

Only `VITE_PUBLIC_*` values may ever be build args — **build args are
readable in image history forever.**

Verify the image before pushing:

```bash
docker run -d --name smoke -p 8787:8787 \
  -e CORS_ALLOWED_ORIGINS=http://localhost:8080 \
  ghcr.io/<owner>/avash-api:sha-$(git rev-parse --short HEAD)
curl -fsS http://localhost:8787/health | jq .
docker rm -f smoke
```

"Rollback" is deleting the tag from GHCR. Since nothing deploys from these
images, a bad one affects only whoever pulled it.

---

## Service 7 — Notifications (`apps/notify`, Vercel + Inngest)

`apps/notify` (ADR-016) delivers announcement push notifications: a
Supabase Database Webhook fires on insert, `apps/notify` receives it and
emits an Inngest event, and an Inngest function (backed by
`packages/push`) does the actual Web Push send. It talks to Supabase
directly with the service-role key and never goes through `apps/api`
(ADR-007).

### Preconditions

- The Vercel project exists and `VERCEL_TOKEN`/`VERCEL_ORG_ID`/
  `VERCEL_PROJECT_ID` are set (`docs/security/secrets-matrix.md`).
- An Inngest app/environment exists for this target — **preview and
  production are separate Inngest environments**, each with its own
  `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` pair.
- `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, and
  `ANNOUNCEMENT_WEBHOOK_SECRET` are set as Vercel project environment
  variables for the target environment (`docs/security/secrets-matrix.md`
  § How to set each secret per environment).

### Deploy — preview / production

```bash
cd apps/notify

pnpm dlx vercel pull --yes --environment=preview      # or =production
pnpm dlx vercel build                                 # add --prod for production
pnpm dlx vercel deploy --prebuilt                      # add --prod for production
```

**Sync the Inngest app registration immediately after — this step is easy
to forget and the deploy looks fine without it.** Vercel serving new code
and Inngest knowing about it are two separate facts; without this,
Inngest keeps invoking whatever function versions it last saw, against
the new deploy's code:

```bash
curl -X PUT "https://<the-deployment-url>/api/inngest"
```

### Verify

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "https://<origin>/api/inngest"
curl -sS "https://<origin>/api/inngest" | jq '[.. | objects | select(has("id"))] | length'
```

Expect `200` and a function count of at least 2 (the delivery function and
the sweep function) — a `200` with zero functions listed means Vercel is
serving but Inngest has not picked up this deploy; re-run the sync step
above.

### Rollback

```bash
cd apps/notify
pnpm dlx vercel rollback
```

Or, via the dashboard: **Vercel → apps/notify → Deployments → find the
last known-good deployment → Promote to Production.** Both are instant
and ship bytes already verified — no rebuild. After rolling back, re-run
the Inngest sync step (`curl -X PUT`) against the rolled-back deployment's
URL; rolling back the Vercel deployment alone does not tell Inngest to
stop invoking the function versions the bad deploy registered.

### Setting up the Supabase Database Webhook

The webhook is what actually triggers delivery — it is configured **once,
by hand, in the Supabase dashboard**, not through this repository's CI.
There is one webhook per environment, and **the production webhook is the
only one that should exist against a live `announcements` table** — see
the warning below.

1. In the Supabase dashboard for the target project: **Database →
   Webhooks → Create a new hook**.
2. **Table:** `announcements`. **Events:** `INSERT` only — the trigger
   condition is `AFTER INSERT ON announcements`; `UPDATE`/`DELETE` are not
   wired to this webhook.
3. **Type:** HTTP Request. **Method:** `POST`. **URL:** the deployed
   `apps/notify` origin's `/api/announcement-published` endpoint, e.g.
   `https://<production-notify-origin>/api/announcement-published`.
4. **HTTP Headers:** add a header the receiver checks in constant time
   against `ANNOUNCEMENT_WEBHOOK_SECRET` — e.g.
   `X-Announcement-Webhook-Secret: <the same value stored as
   ANNOUNCEMENT_WEBHOOK_SECRET in apps/notify's Vercel environment
   variables>`. Generate the secret once with
   `openssl rand -hex 32` and set it in both places (Supabase webhook
   header, Vercel env var) — a mismatch here means the receiver silently
   rejects every real webhook call.
5. Save, then trigger a test insert against the target project and
   confirm the webhook fired (Supabase's webhook log shows the delivery
   attempt and response status) and that `apps/notify` emitted the
   `announcement/published` Inngest event (Inngest dashboard → the app's
   **Events** view).

**Do not point the webhook at a preview `apps/notify` deployment, and
never configure more than one webhook against the same `announcements`
table.** Preview deploys sync into their own, separate Inngest
environment (§ Preconditions above); if a preview webhook existed
alongside the production one, every announcement insert would fire both,
and both Inngest environments would independently deliver it —
subscribers receive the same push notification twice (or more, once per
extra webhook/preview combination that exists). The Supabase Database
Webhook is production-only, permanently — the Inngest scheduled sweep
(`packages/push`, safety net for missed webhook deliveries) is the only
thing that should ever run against preview data without a live webhook
behind it.

---

## Full manual release — production, in order

When deploying everything by hand, the order is not arbitrary. Each step
must be verified before the next begins.

1. **Database.** Backup → `db diff` → `db push` → verify RLS and indexes.
   Schema goes first because both apps assume it.
2. **Backend.** `wrangler deploy --env production` → `/health` returns
   `200` → CORS rejects an unlisted origin. The API must be live before a
   frontend is built against its origin.
3. **Frontend.** Export production `VITE_PUBLIC_*` → build → env scan and
   bundle budget → `pages deploy --branch=main` → load it in a browser and
   confirm the network tab shows the right API origin.
4. **Jobs.** Run each once by hand (preferably via `workflow_dispatch`) and
   confirm it wrote what it should.
5. **Post-deploy sweep.** The three-pass manual protocol
   (`docs/standards/testing.md` § Manual, three-pass protocol) against
   production, at minimum Pass 2 (happy path) and Pass 3 (attack it).
6. **Record it.** SHA deployed, who deployed it, when, why it was manual
   rather than through CI, and anything that surprised you.

If a step fails, roll back **that** step and stop. Do not proceed on the
theory that the next step might fix it.

---

## First-time environment setup

For an environment that has never been deployed to, in this order:

1. Create the Supabase project; note the project ref, service-role key,
   JWT secret, anon key, and URL (`docs/security/secrets-matrix.md` § 1).
2. Create the Upstash Redis database; note the REST URL and token (§ 4).
3. Create the Turnstile site for this environment's domain; note the site
   and secret keys (§ 5). Add the real domain — a `localhost`-only site key
   fails silently in production.
4. Generate a VAPID keypair for this environment (§ 7).
5. Create the Cloudflare Pages project (`avash`) and set its production
   branch to `main`.
6. Set every Worker secret: `wrangler secret put <NAME> --env <env>`.
7. Apply migrations (Service 3).
8. Deploy the backend (Service 1), then the frontend (Service 2).
9. Set the GitHub Environment secrets and variables so CI can take over
   from here (`docs/security/github-environments.md`).
10. Push a trivial commit and confirm the pipeline deploys the same
    environment successfully. **Until that succeeds, the environment is
    manually-deployed-only, which is a state to leave quickly.**

## Status

The commands in this document are written against the deploy paths that
`deploy-web.yml` and `deploy-api.yml` already use. The production
Cloudflare Pages project (`avash`, at `avash.pages.dev`) and the
production Worker (`avash-api-production`) now exist and are live —
neither origin above is a placeholder for production anymore. The
`preview` side (`avash-api-preview`, the `dev`-branch Pages deployment)
has not had a first manual deploy yet, so treat those origins as
unverified until Service 1/2's preview steps have actually been run once.
Database, job, and ML sections describe services whose vertical slices
had not shipped when this was written; confirm each command against the
current tooling version and this doc's other sections before relying on
it in an incident.
