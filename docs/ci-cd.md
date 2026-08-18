# CI/CD — Workflows, Secrets & Runbook

**Read when:** editing .github/workflows, debugging a red pipeline, or configuring CI secrets.

**Decides:** Every workflow trigger and step, required secrets, gate locations, and rollback.

**Gist:** every workflow under `.github/workflows/` plus `.github/dependabot.yml`,
what triggers each one, what secret or repository variable it needs, how it
fails, and how to debug a red run. `docs/docker.md` owns the *local* half of
the container story (building and running images on your own machine);
this document owns the *CI* half — the same images built, scanned, and run
inside GitHub Actions.

## The pipeline

`pipeline.yml` is the **only** entrypoint for pull requests and for pushes to
`main` and `dev`. Everything else under `.github/workflows/` is either called
from it (`on: workflow_call`, no trigger of its own) or is a standalone
scheduled cron job.

```
context ─┬─ ci ──────────┬─ images ───┬─ deploy-web
         └─ codeql ──────┴─ ml-image ─┼─ deploy-api
                                      ├─ deploy-notify
                                      └─ cve-report (weekly only)
```

Each arrow is a real `needs:` edge. Nothing is published to GHCR until every
gate is green, and nothing deploys until the images are built and scanned
clean. This is a change from the earlier layout, where `ci.yml`,
`build-images.yml` and the two deploy workflows each carried their own
`push: [main]` trigger and therefore raced each other — a deploy could ship
while the test suite was still running, or after it had already failed.

`needs:` only sequences jobs *within* one workflow, which is why the stages are
reusable workflows composed by a caller rather than four independent files.
`workflow_run` was rejected for the job: it reports no status on the pull
request and always runs the default branch's copy of the workflow, so a change
to the pipeline could never be tested by the pull request making it.

### What each branch does

| Trigger | Gates | Images | Pages | Worker | Notify (Vercel) |
|---|---|---|---|---|---|
| Pull request | ✅ | built + scanned, **not** published | preview (`--branch=<head-ref>`) | — | — |
| Push to `dev` | ✅ | published, tagged `sha-<short>` + `dev` | preview (`--branch=dev`) | `--env preview` (`avash-api-preview`) | preview (`--environment=preview`) |
| Push to `main` | ✅ | published, tagged `sha-<short>` + `latest` | production (`--branch=main`) | `--env production` | production (`--environment=production` `--prod`) |
| Weekly schedule | ✅ | built + scanned, not published | — | — | — |

`apps/notify` (ADR-016) has no Cloudflare Pages/Worker equivalent — it
ships no container image and is never touched by a pull request, because a
pull request has no environment of its own for it to deploy into (same
reasoning as the missing Worker deploy above).

Branch → channel is resolved once, in `pipeline.yml`'s `context` job, and
passed down as workflow inputs. No downstream job re-derives it from
`github.ref`.

### Manual runs and urgent deploys

Three ways to trigger a deploy by hand, from least to most bypassed:

**1. Dispatch the full pipeline.** `gh workflow run pipeline.yml --ref dev`
(or `--ref main`) runs the full graph above exactly as a push would, with
the same per-environment secret resolution, and deploys if `ci`/`codeql`
are green. This is the normal path for a manual re-run — nothing is
skipped.

**2. Dispatch `deploy-web.yml`/`deploy-api.yml` directly**, for a deploy
that doesn't need a fresh image build/scan at all — e.g. re-pushing a
build that already passed CI once:

```bash
gh workflow run deploy-web.yml --ref dev -f environment=preview -f pages_branch=dev
gh workflow run deploy-api.yml --ref dev -f environment=preview -f wrangler_env=preview -f smoke_test_origin_var=PREVIEW_API_ORIGIN
gh workflow run deploy-notify.yml --ref dev -f environment=preview -f vercel_target=preview -f smoke_test_origin_var=PREVIEW_NOTIFY_ORIGIN
```

All three workflows declare `environment: ${{ inputs.environment }}` on their
own job — the only place GitHub's schema allows it on a job that
`pipeline.yml` also calls via `uses:` (declaring it on both is a schema
error, not just a style choice; see the corrected note in
`docs/security/github-environments.md` § Step 6). That single
declaration is what makes both this direct dispatch and a
`pipeline.yml`-driven deploy resolve the right environment's
secrets/vars and require its protection rules. Validate any future edit
to these four workflows with `act -l -W <file>` before pushing —
`pipeline.yml` failed silently (zero jobs, "Invalid workflow file") for
several hours on this branch before that check caught it.

**3. Dispatch `pipeline.yml` with the gate bypass**, for the case where
`ci`/`codeql` are red — the gates are red for a reason unrelated to
the code being shipped (a missing external credential, an infra dependency
that isn't provisioned yet, anything you have independently verified is safe
to ship past) — the manual trigger takes a `bypass_gates` boolean input,
default `false`:

```bash
gh workflow run pipeline.yml --ref dev -f bypass_gates=true
```

What it does and does not change:

- `ci` and `codeql` still run and still report their real pass/fail — this
  does not hide or skip them, it only stops a **bypassed** one from
  auto-skipping `images`/`ml-image` downstream (the default `needs:`
  behavior, which normally treats "a need failed" and "a need was skipped"
  the same way).
- `images`/`ml-image` still have to succeed on their own merits — a real
  Docker build failure or a Trivy HIGH/CRITICAL finding still blocks
  `deploy-web`/`deploy-api` exactly as it does on a normal run. The bypass
  only removes the `ci`/`codeql` precondition, not the image stage itself.
- Each environment's required-reviewer protection rule (if configured,
  `docs/security/github-environments.md`) is untouched and still applies —
  this input cannot skip a human approval gate.
- The run logs a `::warning::` in the `context` job's summary whenever it's
  set, so a bypassed deploy is never quiet in the Actions history.
- It only does anything on `workflow_dispatch`; the input is ignored on
  `push`/`pull_request`/`schedule`.

This exists specifically for the situation where the API contract suite
(`e2e-api`, `api-container-parity` in `ci.yml`) is red because no hosted
Supabase project has secrets wired into CI yet (§ Required secrets above) —
a known, tracked gap, not a defect in what's being deployed. Use it
narrowly and say why in the deploy record (`docs/manual-deploy.md` §
Record it).

## Workflow index

| Workflow | Triggers | Purpose |
|---|---|---|
| `pipeline.yml` | PR, push to `main`/`dev`, weekly, manual | **The entrypoint.** Composes every stage below and owns all sequencing, concurrency and branch routing |
| `ci.yml` | called | Gates as concurrent jobs: `lint`, `typecheck`, `static-analysis`, `test`, `e2e-api`, `build` → `e2e-web`, plus `api-container-parity` and `postgis-service` (§11) |
| `codeql.yml` | called | SAST across `javascript-typescript` and `python` — see § The SAST gate |
| `build-images.yml` | called | hadolint + build + Trivy + smoke test + publish for `apps/web`/`apps/api` images (ADR-012) |
| `docker-image-scan.yml` | called | hadolint + Trivy on the ML image (ADR-011) |
| `deploy-web.yml` | called | Cloudflare Pages deploy for `apps/web`; target branch passed in as `pages_branch` |
| `deploy-api.yml` | called | `wrangler deploy` for `apps/api` + post-deploy smoke test (`/health` **and** `/health/db`); environment passed in as `wrangler_env` — given to wrangler-action as *both* `--env` on the command and its `environment:` input, because that input alone is what scopes the secret upload (see below) |
| `deploy-notify.yml` | called | Vercel deploy for `apps/notify` (`vercel pull` → `vercel build` → `vercel deploy --prebuilt`) + Inngest app registration sync (`PUT /api/inngest`) + post-deploy smoke test asserting `/api/inngest` returns `200` **and** lists at least two registered functions; target passed in as `vercel_target` (ADR-016) |
| `cron-weather-ingest.yml` | schedule (every 3h), manual | Runs `scripts/jobs/weather-ingest.ts` directly against Supabase (ADR-007) |
| `cron-batch-predict.yml` | schedule (every 24h), manual | Runs `ml/serving/predict.py` directly against Supabase (ADR-002, ADR-007) |
| `cron-news-scan.yml` | schedule (every 6h), manual | Runs `scripts/jobs/news-scan.ts` directly against Supabase (ADR-007) |
| `dependabot.yml` | scheduled by GitHub | One grouped weekly PR per ecosystem: npm (root + `apps/*` + `packages/*`), pip (`ml/`), github-actions, docker |

`.github/actions/setup-workspace` is the composite action every Node job uses
for pnpm + Node 24 + `pnpm install --frozen-lockfile` + the turbo cache. The
toolchain version is declared there and nowhere else. Splitting the gates into
concurrent jobs means each one pays for its own install, which is only cheap
because the pnpm store restores from cache — if that cache stops working, the
concurrency stops paying for itself.

### Worker secrets are scoped by wrangler-action's `environment:` input

`wrangler deploy --env production` and `wrangler secret bulk` are two
different calls to two different targets, and `cloudflare/wrangler-action`
takes the environment for the second one from its **`environment:` input**,
not from the `--env` you wrote in `command:`. With that input unset the
action uploads every secret to the top-level Worker declared in
`apps/api/wrangler.toml` (`avash-api`) while the deploy itself creates
`avash-api-production` / `avash-api-preview`. The run is green, the log says
each secret was created, and every request to the Worker that actually
serves traffic still fails — `supabaseUrl is required` from
`apps/api/src/lib/supabaseAdmin.ts`, because `env.SUPABASE_URL` is empty
there. `deploy-api.yml` therefore passes `wrangler_env` in both places; the
action skips its own `--env` injection when the command already carries one,
so the flag is not duplicated.

The post-deploy smoke test hits `/health/db` for the same reason. `/health`
is liveness only — it reads no secret and touches no database, so it stays
`200` through exactly this failure. `/health/db` builds the service-role
client and runs a bounded query, so a Worker deployed without its Supabase
secrets returns `503` there and fails the deploy instead of shipping.

## Dependency updates

Dependabot runs four grouped updates, one pull request each per week, rather
than one pull request per package per directory. The npm entry covers the root
plus `apps/*` and `packages/*` in a single group, which is the point: Dependabot
resolves "latest" per directory independently, so a package pinned in several
manifests used to arrive as several uncoordinated pull requests — the cause of
`zod` bumping in `packages/types` and `apps/api` but not `apps/web`, `react`
bumping without `react-dom`, and `typescript` opening against two different
majors at once.

Majors are deliberately inside the group. The usual advice is to separate them,
and the trade-off is real — a breaking major arrives alongside routine patches
and the group reverts as a unit. It is accepted here because this repo pins the
same packages across up to eleven manifests, and an ungrouped major is precisely
the update that lands in one manifest and not the others. **Review the group;
do not rubber-stamp it.**

Merge Dependabot pull requests with squash-merge so each grouped update becomes
one commit.

None of the three cron workflows exposes an HTTP trigger (R7/ADR-007), and
all three currently no-op with a `::notice::` because their target job
scripts (`scripts/jobs/*.ts`, `ml/serving/predict.py`) are still empty
stubs and the database schema does not exist yet. Each one starts doing
real work when its owning vertical slice ships (`docs/PROJECT_PLAN.md`
§13).

## Required secrets and repository variables

Configure under **Settings → Secrets and variables → Actions**. Every
deploy workflow is guarded on the relevant credential's presence and no-ops
cleanly when it is absent — an unconfigured repository never fails CI for
lacking a credential it was never given.

| Name | Kind | Used by | Required for |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | `deploy-web.yml`, `deploy-api.yml` | Any deploy |
| `CLOUDFLARE_ACCOUNT_ID` | secret | `deploy-web.yml`, `deploy-api.yml` | Any deploy |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | `deploy-api.yml`, `cron-weather-ingest.yml`, `cron-batch-predict.yml`, `cron-news-scan.yml` | API deploy, weather-ingest cron; the other two cron jobs once implemented |
| `SUPABASE_JWT_SECRET` | secret | `deploy-api.yml` | API deploy |
| `GEMINI_API_KEY` | secret | `deploy-api.yml`, `cron-news-scan.yml` | API deploy, news-scan job |
| `UPSTASH_REDIS_REST_URL` | secret | `deploy-api.yml` | API deploy |
| `UPSTASH_REDIS_REST_TOKEN` | secret | `deploy-api.yml` | API deploy |
| `TURNSTILE_SECRET_KEY` | secret | `deploy-api.yml` | API deploy |
| `SUPABASE_URL` | secret | `deploy-api.yml`, `cron-weather-ingest.yml`, `cron-batch-predict.yml`, `cron-news-scan.yml` | API deploy — `apps/api/src/lib/supabaseAdmin.ts` needs it at runtime exactly like the service-role key, a Worker missing this secret fails every request with "supabaseUrl is required"; also weather-ingest cron, the other two cron jobs once implemented |
| `OPENWEATHERMAP_API_KEY` | secret | `cron-weather-ingest.yml` | Weather-ingest cron — read directly by `scripts/jobs/weather-ingest.ts`, never logged (the key rides in the request query string) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | secret | `cron-batch-predict.yml`, `deploy-notify.yml` | Web Push delivery from the batch predict job; also `apps/notify`'s Vercel deploy (ADR-016 — a second home for the same keypair) |
| `INNGEST_EVENT_KEY` | secret | `deploy-notify.yml` | Authenticates event sends to Inngest from `apps/notify` (the announcement-published trigger and the sweep) |
| `INNGEST_SIGNING_KEY` | secret | `deploy-notify.yml` | Verifies an inbound Inngest function invocation actually came from Inngest, not a forged request |
| `ANNOUNCEMENT_WEBHOOK_SECRET` | secret | `deploy-notify.yml` | Shared-secret header `apps/notify`'s Supabase Database Webhook receiver compares in constant time |
| `VERCEL_TOKEN` | secret | `deploy-notify.yml` | Authenticates `vercel pull` / `vercel build` / `vercel deploy` |
| `VERCEL_ORG_ID` | secret | `deploy-notify.yml` | Identifies the Vercel org/team `apps/notify` deploys under |
| `VERCEL_PROJECT_ID` | secret | `deploy-notify.yml` | Identifies the Vercel project `apps/notify` deploys to |
| `GITHUB_TOKEN` | built-in | `build-images.yml` | Publishing images to GHCR (no manual setup) |
| `VITE_PUBLIC_API_BASE_URL` | repository **variable** | `deploy-web.yml` | Building `apps/web` for Pages — the deployed Worker's origin |
| `VITE_PUBLIC_SUPABASE_URL` | repository **variable** | `deploy-web.yml` | Building `apps/web` for Pages |
| `VITE_PUBLIC_SUPABASE_ANON_KEY` | repository **variable** | `deploy-web.yml` | Building `apps/web` for Pages |
| `VITE_PUBLIC_TURNSTILE_SITE_KEY` | repository **variable** | `deploy-web.yml` | Building `apps/web` for Pages |
| `VITE_PUBLIC_VAPID_PUBLIC_KEY` | repository **variable** | `deploy-web.yml` | Building `apps/web` for Pages |
| `PRODUCTION_API_ORIGIN` | repository **variable** | `deploy-api.yml` | Post-deploy smoke test target for `main` |
| `PREVIEW_API_ORIGIN` | repository **variable** | `deploy-api.yml` | Post-deploy smoke test target for `dev` — the `avash-api-preview` Worker's origin |
| `PRODUCTION_NOTIFY_ORIGIN` | repository **variable** | `deploy-notify.yml` | Post-deploy smoke test target for `main` — the production `apps/notify` Vercel deployment's origin |
| `PREVIEW_NOTIFY_ORIGIN` | repository **variable** | `deploy-notify.yml` | Post-deploy smoke test target for `dev` — the preview `apps/notify` Vercel deployment's origin |
| `PUBLIC_API_BASE_URL` | repository **variable** | `build-images.yml` | Build arg for the *published* web image — see the gap noted below |
| `CORS_ALLOWED_ORIGINS` | repository **variable**, optional | `deploy-api.yml` | Overrides `apps/api/wrangler.toml`'s fallback via `wrangler deploy --var`; unset means the committed value still deploys (§14, `docs/constants-registry.md`). Same value for `preview` and `production` today, so repository scope — not per-environment — is correct |
| `CORS_PREVIEW_ORIGIN_SUFFIX` | repository **variable**, optional | `deploy-api.yml` | Same mechanism and scope as above — a bare domain suffix, never a glob (`apps/api/src/config/cors.ts` builds the subdomain wildcard itself) |

Every server-only value here matches `docs/security/secrets-matrix.md`
exactly — this table is "where each one is configured in CI," that
document is "what it is and why it exists," including the *only* place
the step-by-step provider procedure for each one lives. Once obtained,
set each one per § Setting these in GitHub, below.

### Where to obtain each credential

| Name(s) | Obtain via |
|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | § Obtaining `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, below — CI/CD-specific, not in the matrix's application inventory |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `VITE_PUBLIC_SUPABASE_URL`, `VITE_PUBLIC_SUPABASE_ANON_KEY` | secrets-matrix.md § 1 Supabase |
| `GEMINI_API_KEY` | secrets-matrix.md § 2 Google Gemini |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | secrets-matrix.md § 4 Upstash Redis |
| `TURNSTILE_SECRET_KEY`, `VITE_PUBLIC_TURNSTILE_SITE_KEY` | secrets-matrix.md § 5 Cloudflare Turnstile |
| *(map tiles)* | Nothing to obtain — the map uses credential-free OpenStreetMap tiles (secrets-matrix.md § 6, ADR-013). Listed here so its absence reads as deliberate, not as an omission |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VITE_PUBLIC_VAPID_PUBLIC_KEY` | secrets-matrix.md § 7 Web Push VAPID keypair |
| `VITE_PUBLIC_API_BASE_URL`, `PRODUCTION_API_ORIGIN`, `PREVIEW_API_ORIGIN`, `PUBLIC_API_BASE_URL` | secrets-matrix.md § 8 — not a third-party credential, it's your own deployed Worker's origin |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | [Inngest dashboard](https://app.inngest.com) → the app's **Manage → Signing key**/**Event keys** page, one keypair per Inngest environment (preview and production are separate environments — see the deploy-notify job's comment in `pipeline.yml`) |
| `ANNOUNCEMENT_WEBHOOK_SECRET` | Generate your own (e.g. `openssl rand -hex 32`); it's a shared secret between the Supabase Database Webhook and `apps/notify`'s receiver, not issued by a provider |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | [Vercel dashboard](https://vercel.com) → **Account Settings → Tokens** for the token; **Project Settings → General** for the org and project IDs, or `vercel link` locally in `apps/notify` and read `.vercel/project.json` |
| `PRODUCTION_NOTIFY_ORIGIN`, `PREVIEW_NOTIFY_ORIGIN` | Not a third-party credential — the `apps/notify` Vercel deployment's own origin, read back from the Vercel dashboard once deployed once |
| `GITHUB_TOKEN` | Built in; GitHub injects it automatically, nothing to obtain |

`VITE_PUBLIC_*` repository variables need no separate provider trip beyond
what the table above points to — each one is the exact value already
sitting in your local `apps/web/.env`, stored a second time because
`deploy-web.yml` builds inside the runner and has no `.env` file of its
own.

### Obtaining `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`

**`CLOUDFLARE_ACCOUNT_ID`:**

1. Log into the [Cloudflare dashboard](https://dash.cloudflare.com).
2. Select any domain, or go to the **Compute → Workers & Pages** if you
   have no domain yet.
3. The **Account ID** is shown in the right-hand sidebar of the Workers &
   Pages overview page. It is not secret in the sense of granting access
   by itself, but is still stored as a secret here for consistency with
   the token it's paired with.

**`CLOUDFLARE_API_TOKEN`:**

1. **My Profile → API Tokens** (top-right avatar menu) →
   **Create Token**.
2. Use **Create Custom Token**, not one of the broad templates — this
   project's deploy workflows need exactly two permission scopes, and a
   token that can do more than deploy is a wider blast radius than
   necessary if the token ever leaks:
   - **Account → Cloudflare Pages → Edit** (for `deploy-web.yml`)
   - **Account → Workers Scripts → Edit** (for `deploy-api.yml`)
3. Under **Account Resources**, scope it to the one Cloudflare account
   this project deploys to — not "All accounts."
4. Skip **Zone Resources** entirely; neither deploy workflow touches DNS
   or zone-level settings.
5. **Continue to summary → Create Token**, then copy it immediately —
   Cloudflare shows it exactly once and cannot display it again.
6. Store it as the `CLOUDFLARE_API_TOKEN` GitHub Actions secret
   immediately; do not paste it into a file, a chat message, or a note
   app first.

If a deploy workflow later needs a capability outside these two scopes,
widen the existing token's permissions rather than creating a second,
broader one — one auditable token beats several with overlapping access.

### Setting these in GitHub

Two independent choices when adding one of these: **secret vs. variable**
is already answered by the Kind column in the table above — secret for
anything that grants access, repository variable for anything that's
already public once `apps/web` ships it. **Repository vs. environment
scope** is the second choice, and it is mid-migration:

- **The `preview` / `production` GitHub Environments, the branch
  policies, the required reviewer on `production`, and the workflow-level
  `environment:` wiring all exist already** — `deploy-web.yml` and
  `deploy-api.yml`'s own jobs declare `environment: ${{ inputs.environment
  }}`, and `pipeline.yml`'s `deploy-web` / `deploy-api` jobs resolve that
  environment name and pass it down via `with:`, but do **not** declare
  `environment:` themselves — GitHub's schema rejects `environment:` on
  any job that also has `uses:` (a reusable-workflow call). See
  `docs/security/github-environments.md` § Step 6 for that constraint and
  the "Corrected" note explaining the failure mode it replaced.
  `secrets: inherit` is gone from `pipeline.yml` in favor of an explicit
  per-secret list.
- **What's still outstanding is the credentials themselves.** Nothing has
  been set at environment scope yet — no second Cloudflare token, no
  preview Supabase/Upstash/Gemini/Turnstile project. Until an
  environment's secrets are actually populated (`docs/security/github-environments.md`
  § Step 4), a deploy targeting it reads an empty token and takes the
  documented "not configured — skip cleanly" path: the pipeline stays
  green and deploys nothing, which is correct for a half-migrated
  credential set. Follow `docs/security/github-environments.md` §§ 4–8 to
  finish the cutover; do not set the `deploy-web.yml`/`deploy-api.yml`
  rows above at repository scope instead, since `pipeline.yml` no longer
  passes repository-scoped copies of those specific secrets down to them.
  **This split does not touch the cron workflows** — `cron-weather-ingest.yml`,
  `cron-batch-predict.yml`, and `cron-news-scan.yml` declare no
  `environment:` and still read `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `GEMINI_API_KEY`, and the `VAPID_*` keys at repository scope, by design —
  they run on a schedule, not through a deploy gate, and stay on the
  repository-scope instructions below.

Via the web UI: **Settings → Secrets and variables → Actions**, then
**New repository secret** (for `secret`-kind rows in the table above) or
switch to the **Variables** tab and **New repository variable** (for
`repository variable`-kind rows).

Via the `gh` CLI (requires `gh auth login` first):

```bash
# Secrets — value is never echoed back or stored in shell history if
# piped in rather than passed as a literal argument
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
gh secret set SUPABASE_SERVICE_ROLE_KEY
gh secret set SUPABASE_JWT_SECRET
gh secret set GEMINI_API_KEY
gh secret set UPSTASH_REDIS_REST_URL
gh secret set UPSTASH_REDIS_REST_TOKEN
gh secret set TURNSTILE_SECRET_KEY
gh secret set SUPABASE_URL
gh secret set OPENWEATHERMAP_API_KEY
gh secret set VAPID_PUBLIC_KEY
gh secret set VAPID_PRIVATE_KEY
gh secret set INNGEST_EVENT_KEY
gh secret set INNGEST_SIGNING_KEY
gh secret set ANNOUNCEMENT_WEBHOOK_SECRET
gh secret set VERCEL_TOKEN
gh secret set VERCEL_ORG_ID
gh secret set VERCEL_PROJECT_ID

# Repository variables — these are not secret and are visible to anyone
# with read access to the repository, matching their VITE_PUBLIC_/deploy-
# config nature.
gh variable set VITE_PUBLIC_API_BASE_URL --body "https://your-api.example.workers.dev"
gh variable set VITE_PUBLIC_SUPABASE_URL --body "https://<project-ref>.supabase.co"
gh variable set VITE_PUBLIC_SUPABASE_ANON_KEY --body "<anon-key-from-supabase-settings-api>"
gh variable set VITE_PUBLIC_TURNSTILE_SITE_KEY --body "<site-key-from-cloudflare-turnstile>"
gh variable set VITE_PUBLIC_VAPID_PUBLIC_KEY --body "<public-half-of-the-vapid-keypair>"
gh variable set PRODUCTION_API_ORIGIN --body "https://your-api.example.workers.dev"
gh variable set PREVIEW_API_ORIGIN --body "https://avash-api-preview.<subdomain>.workers.dev"
gh variable set PUBLIC_API_BASE_URL --body "https://your-api.example.workers.dev"
gh variable set PRODUCTION_NOTIFY_ORIGIN --body "https://your-notify-app.vercel.app"
gh variable set PREVIEW_NOTIFY_ORIGIN --body "https://your-notify-app-preview.vercel.app"

# Optional — unset means apps/api/wrangler.toml's committed [vars] value
# deploys unchanged (docs/constants-registry.md § CORS_ALLOWED_ORIGINS).
gh variable set CORS_ALLOWED_ORIGINS --body "https://avash.pages.dev"
gh variable set CORS_PREVIEW_ORIGIN_SUFFIX --body "avash.pages.dev"
```

**Security note — widen the domain restriction before copying.**
`VITE_PUBLIC_TURNSTILE_SITE_KEY` is domain-restricted at the provider to
`localhost` (`docs/security/secrets-matrix.md` § 5). Add the real
Cloudflare Pages production domain as an allowed domain on the Turnstile
site *before* setting this variable — a value that only works on
`localhost` will silently fail the widget in production, and widening the
restriction after the fact is the safer order than shipping an
unrestricted key to unblock a broken deploy.

The map needs no equivalent step: OpenStreetMap tiles carry no key to
restrict (ADR-013). What the map *does* need before a production deploy
is the CSP `img-src` tile-host entry in `apps/web/public/_headers` —
without it the basemap is blocked in production while working fine in a
dev server that serves no CSP.

Confirm what's actually configured without exposing any value:

```bash
gh secret list
gh variable list
```

Neither command prints secret values — GitHub does not return them once
set, by design. To verify a secret was set to the *intended* value, the
only reliable check is behavioral: trigger the workflow that consumes it
(`workflow_dispatch` on the relevant job) and confirm it behaves as
expected, rather than trying to inspect the value directly.

### `PUBLIC_API_BASE_URL` — a known configuration gap

`build-images.yml` builds the published `avash-web` image against
`vars.PUBLIC_API_BASE_URL`, falling back to `http://localhost:8787` when
unset. Until it is set, the image published to `ghcr.io/<owner>/avash-web`
is compiled against `localhost` and is useful for local verification only,
not as a deployable artifact. Set it once the real API origin is known, in
the same change that updates `wrangler.toml`'s `CORS_ALLOWED_ORIGINS` placeholder.

## Finding and sharing the live deployment link

Once `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` are set (§ Required
secrets above) and `deploy-web.yml` or `deploy-api.yml` has actually run on
GitHub, the deployed URL is never something you construct by hand — read it
back from Cloudflare:

- **`apps/web` production:** the Cloudflare Pages project's default domain,
  `https://avash.pages.dev` (or the custom domain if one is attached under
  **Pages → avash → Custom domains**). Confirm the current production
  deployment in **Pages → avash → Deployments**.
- **`apps/web` PR preview:** `deploy-web.yml`'s "Deploy preview (PR)" step
  prints the preview URL in its GitHub Actions job log
  (`https://<branch-slug>.avash.pages.dev` or a deployment-hash subdomain).
  If the Cloudflare Pages GitHub App is installed on this repository, it
  also comments the same URL directly on the PR — check there first.
- **`apps/api`:** the Worker's `*.workers.dev` subdomain, or the custom
  domain in `wrangler.toml`'s `[env.production] routes`. `wrangler
  deployments list --env production` (run locally, or as a
  `workflow_dispatch` step) shows the live deployment and its URL.

Every one of these is a normal public HTTPS URL — there is no tunnel, VPN,
or extra step needed to share one with someone else. Copy it and send it.
The one thing to check before sharing a **preview** link: Cloudflare Pages
preview deployments are public by default unless Cloudflare Access has been
configured on the project, so treat a preview URL as visible to anyone who
has it, the same as production.

## Pausing and resuming scheduled runs

Scheduled workflows consume the repository's Actions allowance whether or
not they do useful work. This section is the procedure for turning them
off and back on.

### What actually costs minutes

Actions minutes are billed **only for private repositories**. A public
repository gets unlimited minutes on GitHub-hosted standard runners, so if
this repository is public, nothing below is a cost decision — it is only a
noise decision. On a private repository, the GitHub Free plan includes
2,000 minutes per month.

Two billing details matter when estimating:

- **Each job's duration is rounded up to the whole minute.** A job that
  runs for four seconds is billed as one minute. This makes run *frequency*
  matter far more than run *duration* for short jobs.
- **Runner OS carries a multiplier** — Linux ×1, Windows ×2, macOS ×10.
  Every job in this repository uses `ubuntu-latest`, so the multiplier is
  ×1 throughout.

Current scheduled load, assuming a 30-day month:

| Workflow | Cadence | Runs/month | Notes |
|---|---|---|---|
| `cron-weather-ingest.yml` | every 3h | ~240 | The dominant cost by run count |
| `cron-news-scan.yml` | every 6h | ~120 | |
| `cron-batch-predict.yml` | daily | ~30 | |
| `pipeline.yml` | weekly (+ every PR and push to `main`/`dev`) | ~4 scheduled | Fans out to every gate and both image matrices, so a scheduled run is ~15 jobs |

`cron-weather-ingest.yml` now does real work every run. `cron-news-scan.yml`
and `cron-batch-predict.yml` still exit at their own stub guard without
doing any work — that guard is deliberately placed **before** toolchain
setup and dependency installation, so a no-op run bills roughly one minute
rather than the three-to-five it would cost if it installed first. Do not
reorder those steps in either still-stubbed workflow.

### Pausing a workflow — GitHub web UI

This is the recommended method. It requires no commit, takes effect
immediately, and is trivially reversible.

1. **Actions** tab → select the workflow in the left sidebar.
2. **`···`** (top right of the workflow's run list) → **Disable workflow**.

The workflow moves to a disabled state and stops firing. To resume:
same menu → **Enable workflow**.

**Disabling stops every trigger for that workflow, including
`workflow_dispatch`.** To run a paused job once by hand, enable it, dispatch
the run, then disable it again.

### Pausing a workflow — `gh` CLI

Requires the GitHub CLI (`gh`), which is not currently installed on this
machine — install from <https://cli.github.com/> and run `gh auth login`
first.

```bash
gh workflow list --all                      # names, IDs, and current state

gh workflow disable cron-weather-ingest.yml
gh workflow disable cron-news-scan.yml
gh workflow disable cron-batch-predict.yml

gh workflow enable cron-weather-ingest.yml  # resume
```

To pause every scheduled job in one step:

```bash
for wf in cron-weather-ingest cron-news-scan cron-batch-predict; do
  gh workflow disable "$wf.yml"
done
```

Only the three `cron-*` workflows belong in that list. Disabling
`pipeline.yml` would take down every merge gate along with the weekly sweep —
it is the entrypoint, not a scheduled job that happens to also run on pull
requests. To drop only its weekly run, comment out its `schedule:` block per
the next section. The called workflows (`ci.yml`, `codeql.yml`,
`build-images.yml`, `docker-image-scan.yml`, `deploy-*.yml`) have no triggers
of their own, so disabling them individually does nothing.

### Pausing only the schedule, keeping manual runs

If you want a workflow to stay dispatchable while stopping its automatic
runs, comment out its `schedule:` block and keep `workflow_dispatch:`:

```yaml
on:
  # Paused to conserve Actions minutes — re-enable when the job does real work.
  # schedule:
  #   - cron: "0 */3 * * *"
  workflow_dispatch:
```

This costs a commit and is visible in history, which is a feature when the
pause is meant to be long-lived and explained. The UI/CLI method is better
for a temporary pause.

### Stopping everything at once

**Settings → Actions → General → Actions permissions → Disable actions.**
This halts all workflows in the repository, including pull-request checks.
Use it only when deliberately going dark; it disables the merge gates too.

### Guarding against surprise charges

**Settings → Billing and licensing → Budgets and alerts.** A budget of `$0`
means the repository stops running billable Actions jobs once the included
free minutes are exhausted, rather than billing overage. Verify this is set
before relying on any schedule.

### One behavior to know about

GitHub **automatically disables scheduled workflows after 60 days of
repository inactivity** (no commits). If the cron jobs stop firing after a
quiet period, they were not deleted — re-enable them from the Actions tab.
A run triggered manually does not reset that timer; a commit does.

## Downloading test artifacts

1. Open the run under the **Actions** tab.
2. `ci.yml`'s `test` job uploads a `coverage-<sha>` artifact **on every
   run**, pass or fail — `pnpm test:coverage`'s HTML report
   (`docs/standards/testing.md` § Coverage). `e2e-web` and `e2e-api` each
   upload their own `playwright-report-*-<sha>` artifact, but only
   `if: failure()` — it will not exist on a green run.
3. Download the artifact zip from the run summary page (bottom of the
   page, **Artifacts** section) or via `gh run download <run-id>`.
4. For a Playwright report: unzip and open `playwright-report/index.html`
   in a browser — it includes the trace viewer for every failed spec, with
   screenshots and the full network/console log at the point of failure.
   `apps/api`'s `e2e-api` suite uses the `request` fixture, not `page`, so
   its report has no trace/screenshots — a failure there is diagnosed from
   the job log and the request/response bodies Playwright prints inline.
5. For the coverage artifact: unzip and open `coverage/index.html` for the
   full per-file breakdown, or read `coverage/coverage-summary.json` for
   the raw numbers a script would consume.

## The container-touching jobs

- **`postgis-service`** (`ci.yml`) — a job-level `services:` container
  using `postgis/postgis:15-3.4`, health-gated with `pg_isready`
  (`--health-interval 5s --health-retries 10`), identical to
  `compose.yaml`'s `db` image so a migration verified locally is verified
  the same way here. It references no credential — the
  `postgres`/`postgres` values are local-only, throwaway, and never reach
  a deployed environment. GitHub Actions starts service containers before
  any step runs, so the `docker/postgis/initdb/00-extensions.sql` bind
  mount used by `compose.yaml` cannot be reused here; the job's own step
  runs the equivalent `create extension if not exists postgis;` /
  `pgcrypto;` idempotently instead, then asserts both are present.
- **`docker-image-scan.yml`** — hadolint against `docker/ml.Dockerfile`,
  then a build + Trivy scan of the resulting ML image. It used to carry
  path-filtered triggers of its own; those are gone, because §11 counts an
  ML-image Trivy finding as build-failing and a gate that only evaluates
  when someone happened to touch `docker/` is not a gate. The buildx GHA
  cache is what keeps running it every time affordable.
- **`build-images.yml`** — the same two gates (hadolint, Trivy) plus a
  smoke test, applied to `apps/web/Dockerfile` and `apps/api/Dockerfile`.
  Publishing to GHCR only happens after both the scan and the smoke test
  pass, and only when the caller sets `publish: true` — that is, on a push
  to `main` or `dev`, never from a pull request.
- **`api-container-parity`** (`ci.yml`) — builds `apps/api/Dockerfile`,
  starts it, and runs the *identical* `apps/api` Playwright **contract**
  suite (`apps/api/e2e/`) against it with `API_TEST_TARGET=container`,
  using the same
  `CORS_ALLOWED_ORIGINS`/`CORS_PREVIEW_ORIGIN_SUFFIX` values `wrangler dev`
  reads locally from `.dev.vars`/`wrangler.toml`. This is ADR-012's parity
  obligation: a spec that passes against `wrangler dev` (workerd) but
  fails against the container (Node) is a real divergence between
  runtimes, not a flake, and nothing may be skipped or marked
  `continue-on-error` to hide one.

### The weekly CVE report

The Monday `pipeline.yml` run publishes a `cve-report` artifact: the Trivy
output for all three images (`avash-web`, `avash-api`, `avash-ml`) concatenated
into one Markdown file, also written to the run's job summary so it is readable
without downloading anything.

It uses a **stable artifact name and `overwrite: true`**, so each week's sweep
replaces the previous one in place. "What CVEs do our images have right now" is
one download from the latest scheduled run, not a hunt through a pile of
per-run artifacts. Retention is 90 days.

The job runs `if: always()`, because the run whose scans *failed* is exactly the
run whose report is worth reading. It is a report, not a softening — the Trivy
steps that feed it keep `exit-code: 1`, so a HIGH/CRITICAL finding still fails
its image job and still blocks every deploy.

### The Trivy-failure procedure

Both `docker-image-scan.yml` and `build-images.yml` run Trivy with
`severity: HIGH,CRITICAL`, `ignore-unfixed: true`, `exit-code: 1`. When a
job fails on a real finding:

1. Read the CVE entry in the job log — package, installed version, fixed
   version (if any).
2. **A fix exists** (`Status: fixed`, a `Fixed Version` is listed): bump
   the dependency or base image tag. For `docker/ml.Dockerfile` this means
   editing `ml/requirements.txt` (exact `==` pin) or the base image tag;
   for the app images, bumping `WEB_IMAGE_BASE`/`API_IMAGE_BASE` in
   `apps/*/Dockerfile` and `docs/constants-registry.md` together (R9).
   Rebuild and rerun the scan locally before pushing.
3. **No fix exists yet** (upstream hasn't shipped one): this is the one
   case `ignore-unfixed: true` already handles automatically — the job
   will not fail on it. If it *is* failing despite no fix being available,
   the finding is not actually unfixed (check the `Status` column again)
   or Trivy's vulnerability DB is stale in the runner cache; do not add
   `continue-on-error` or `|| true` to work around it — that is banned
   everywhere in these workflows (§11).
4. If a genuine no-fix CVE somehow still blocks merge, the only permitted
   escape hatch is a time-boxed, written decision: open an issue naming
   the CVE, the affected image, the date, and a re-check date (30 days
   out), get it acknowledged by a reviewer, and reference the issue in the
   PR description. This is a documented exception, never a silent
   workaround — `docs/security/threat-model.md` is where the accepted-risk
   entry belongs once one exists.

## Merge gates (§11) — where each one lives

| Gate | Enforced in |
|---|---|
| ESLint, zero errors/warnings | `ci.yml` → `lint` job, `pnpm lint` |
| TypeScript, zero errors | `ci.yml` → `typecheck` job, `pnpm typecheck` |
| Unused exports (`ts-prune`) | `ci.yml` → `static-analysis` job |
| No internal planning references | `ci.yml` → `static-analysis` job, `scripts/check-internal-refs.mjs` |
| Client bundle env-var scan | `ci.yml` → `build` job, `scripts/scan-client-env.mjs` against built `apps/web/dist` |
| Bundle budget (180 KB gzip) | `ci.yml` → `build` job, `scripts/check-bundle-budget.mjs` |
| Failing Vitest test (`packages/*`, `apps/api` in workerd, `apps/web` hooks) | `ci.yml` → `test` job, `pnpm test:coverage` |
| Vitest coverage threshold miss | `ci.yml` → `test` job, `pnpm test:coverage` (`docs/standards/testing.md` § Coverage) |
| Failing Playwright spec (`apps/web` browser, `apps/api` contract suite) | `ci.yml` → `e2e-web`, `e2e-api`, `api-container-parity` jobs |
| Agent-governance drift | `ci.yml` → `static-analysis` job, `scripts/check-agent-sync.mjs` (`docs/standards/agent-compliance.md`) |
| Promotion-path violation (PR from a feature branch, or into `main` from anything but `dev`) | `ci.yml` → `static-analysis` job, `scripts/check-promotion-path.mjs` |
| CodeQL high/critical | `codeql.yml`, called by `pipeline.yml` — see § The SAST gate |
| Model checksum mismatch | Not yet applicable — no ML artifact ships until the ML pipeline slice |
| hadolint / Trivy | `build-images.yml` (app images), `docker-image-scan.yml` (ML image) |

Because every one of these is now a `needs:` ancestor of the deploy jobs, a red
gate blocks the deploy by construction rather than by branch-protection
configuration. Branch protection is still worth setting on `main` and `dev` to
block the *merge button*, but it is no longer what stands between a failing test
and production.

**The required-status-check names changed.** They are now reported as
`pipeline / ci / lint`, `pipeline / images / images (web)` and so on. Any branch
protection rule still requiring the old `ci / verify` will silently match
nothing — update the rules on `main` and `dev` after merging, or the gates stop
being required at the merge button.

## The SAST gate

`codeql.yml` uploads its results to GitHub code scanning. That is available on
**public repositories**, and on private ones **only with GitHub Advanced
Security**. Without one of those, every run fails at the upload step with
`Resource not accessible by integration` or `Code scanning is not enabled for
this repository`.

This is a repository-settings problem, not a workflow one — no `permissions:`
block fixes it, and the workflow already declares the `security-events: write`
it needs. Check with:

```bash
gh api repos/:owner/:repo/code-scanning/analyses
```

A `403` with "Code scanning is not enabled" means the gate cannot pass on that
repository yet. Since CodeQL is a `needs:` ancestor of the image and deploy
stages, that 403 blocks the whole pipeline — so on a private repository without
Advanced Security, either enable it, or make the repository public, or the
pipeline will not reach a deploy. Do **not** resolve it by adding
`continue-on-error` (§11).

## Rollback procedure

**`apps/web` (Cloudflare Pages):** Pages retains every deployment. In the
Cloudflare dashboard, **Pages → avash → Deployments**, find the last known
good deployment, and use **Rollback to this deployment**. This requires no
new build and takes effect immediately.

**`apps/api` (Cloudflare Workers):** `wrangler deployments list --env
production` shows deployment history; `wrangler rollback --env production
--message "<reason>"` reverts to the previous deployment. Alternatively,
revert the offending commit on `main` and let `deploy-api.yml` redeploy
the reverted code.

**Published container images:** images are tagged both `sha-<short>` and
`latest`. Since `latest` moves on every `main` push, pin any external
consumer to a specific `sha-` tag if rollback matters to it; there is no
in-repo rollback action for GHCR beyond re-tagging a prior `sha-` image as
`latest` manually.

**`apps/notify` (Vercel):** every Vercel deployment is immutable and
independently addressable by its own `*.vercel.app` deployment URL —
`vercel rollback` (run from `apps/notify`, or via **Vercel dashboard →
apps/notify → Deployments → find the last known-good deployment → Promote
to Production**) re-points the production alias at a previous deployment
without a rebuild, the same instant-rollback shape as Cloudflare Pages
above. After rolling back, re-run the "Sync Inngest app registration" step
by hand (`curl -X PUT <rolled-back-deployment-url>/api/inngest`, or
dispatch `deploy-notify.yml` again once the offending commit is reverted)
— rolling back the Vercel deployment does not by itself tell Inngest to
stop invoking the function versions the bad deploy registered.
