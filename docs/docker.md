# Docker — Infrastructure, ML Runtime & App Images

**Read when:** touching a Dockerfile, compose.yaml, or anything about local containers.

**Decides:** What is containerized and why, the runbook for each image, and CI container jobs.

**Gist:** Docker covers two distinct jobs here. **Infrastructure**
(ADR-011): a Postgres 15 + PostGIS 3 database matching Supabase and a
pinned Python 3.11 runtime for the ML pipeline — things nobody should
have to install by hand — plus the database image as a CI service
container. **App images** (ADR-012): `apps/web` and `apps/api` each ship
their own image, so the system can run on a server, a demo VM, or a
reviewer's laptop with no Node toolchain and no Cloudflare account.

Production deploys are unaffected: Cloudflare Pages serves `apps/web` and
`wrangler deploy` ships `apps/api`. No deploy workflow consumes an image.

Docker is optional for development. A clean clone runs the full app
scaffold with `pnpm install && pnpm dev` and no daemon installed.

## What exists

| Path                                       | Purpose                                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `compose.yaml`                             | `db` (PostGIS, default profile), `ml` (batch runtime, `ml` profile), `web` + `api` + `notify` (`apps` profile) |
| `packages/db/supabase/config.toml`         | The containerized local Supabase stack (ADR-014) — PostgREST + GoTrue + Realtime, the target when running the app |
| `scripts/supabase-local.mjs`               | `pnpm docker:supabase*` — drives that stack through the repo's pinned CLI, from the repo root |
| `docker/ml.Dockerfile`                     | Python 3.11 image for `ml/` — training, evaluation, ONNX export, batch inference                    |
| `docker/postgis/initdb/00-extensions.sql`  | First-boot extension enablement (`postgis`, `pgcrypto`) — schema objects never go here              |
| `ml/requirements.txt`                      | Exact-pinned Python dependencies; the image and the scheduled jobs install from this same file      |
| `.dockerignore`                            | Keeps `.env` / `.dev.vars` and build output out of every build context                              |
| `.devcontainer/devcontainer.json`          | Optional preinstalled toolchain (Node 20 + pnpm 9 + Python 3.11 + Docker CLI)                       |
| `apps/web/Dockerfile` + `apps/web/docker/` | Multi-stage build → nginx-unprivileged serving `dist/` on 8080 (ADR-012)                            |
| `apps/api/Dockerfile` + `apps/api/server/` | Multi-stage build → Node running the same Hono app via `@hono/node-server` on 8787 (ADR-012)        |
| `apps/notify/Dockerfile` + `apps/notify/server/` | Multi-stage build → Node running the announcement-push delivery service on 8788, local-testing only (ADR-012, ADR-016) — production deploys to Vercel + Inngest instead, never this image |
| `.github/workflows/build-images.yml`       | Builds `web` + `api` on every PR, scans them, publishes to GHCR on `main` — `notify` is not part of this pipeline, see its own section below |
| `scripts/docker-status.mjs`                | Prints each service's real exposed URL when up, or the exact command to start it when it isn't — see § Checking what's running |

See "Verification status" at the bottom for exactly what has been run on
disk, on what platform.

## Prerequisites

Docker Engine 25+ with Compose v2 (Docker Desktop 4.27+ on Windows/macOS
bundles both). Verify:

```bash
docker compose version   # must report v2.x or later
```

Compose v2 is required — `compose.yaml` uses the modern spec (`name:`,
`profiles:`, no `version:` key). The legacy `docker-compose` (v1, Python)
binary will not parse it.

## The database

```bash
pnpm docker:db          # docker compose up -d db
pnpm docker:db:logs     # follow logs
pnpm docker:db:psql     # psql shell inside the container
pnpm docker:db:stop     # stop, keep data
pnpm docker:db:nuke     # stop and DELETE the volume (full reset)
```

Defaults — all overridable from the repo-root `.env`, which Compose loads
automatically:

| Setting         | Default                                  | Override                              |
| --------------- | ---------------------------------------- | ------------------------------------- |
| Host port       | `54322` (bound to `127.0.0.1` only)      | `POSTGRES_PORT`                       |
| User / password | `postgres` / `postgres`                  | `POSTGRES_USER` / `POSTGRES_PASSWORD` |
| Database        | `avash`                                  | `POSTGRES_DB`                         |
| Volume          | `avash-db-data` (named, survives `down`) | —                                     |

Connection string:

```
postgresql://postgres:postgres@127.0.0.1:54322/avash
```

Set it as `DATABASE_URL_LOCAL` in `.env` so migration and seed tooling
can target the container instead of a hosted project. Port `54322`
(not `5432`) deliberately avoids a collision with a host-installed
Postgres, and matches the Supabase CLI's local convention.

`docker/postgis/initdb/*.sql` runs **once**, when the data volume is first
created. Editing it after the fact has no effect until
`pnpm docker:db:nuke` removes the volume. That is intentional: the init
script only enables extensions. Every table, index, RLS policy, and
materialized view belongs in `packages/db/supabase/migrations/` and is
applied by the migration tooling — if a schema object shows up in the init
script, the container and Supabase have silently diverged.

### Parity with Supabase

The container exists to make local schema work trustworthy, which only
holds while the versions match. Before relying on a local verification:

- **Postgres major version — currently MISMATCHED, unresolved.** The `db`
  image is pinned to Postgres 15 (`POSTGIS_LOCAL_IMAGE`). The linked
  hosted project runs **17.6**, verified 2026-08-16 by connecting and
  running `show server_version` rather than reading it off the dashboard.
  This section previously said "confirm against the Supabase project's
  reported version" and that confirmation had never actually been done.

  A migration is therefore being validated against a database one major
  version behind production. Nothing has broken yet — the schema uses no
  16/17-only syntax — but that is luck, not a guarantee, and it is exactly
  the failure mode this container exists to prevent.

  Closing it means bumping `POSTGIS_LOCAL_IMAGE` to a `postgis/postgis:17-*`
  tag in `compose.yaml`, `docs/PROJECT_PLAN.md` §14, and the CI service
  container together, plus `pnpm docker:db:nuke` locally (a 15 data
  directory will not start under 17). Deliberately left as its own change
  rather than folded into the RBAC/local-stack work, because it touches
  CI. **The local Supabase stack (below) is already on 17 and matches
  production** — prefer it for anything where the version could matter.
- **PostGIS version** — pinned to 3.4. Spatial function behavior and index
  planning can differ across majors.
- **Extensions** — the container enables `postgis` and `pgcrypto` only.
  Supabase enables more by default; a migration depending on one not in
  the init script will pass locally and fail on deploy.
- **RLS is enforced identically**, but the container has no Supabase Auth,
  so `auth.uid()`-based policies cannot be exercised end-to-end here. Use
  the local Supabase stack below, or a real project, for those.

A version bump is a deliberate change to the pins in
`docs/PROJECT_PLAN.md` §14, `compose.yaml`, and the CI service container,
in one PR.

## The local Supabase stack (ADR-014)

**This is the target when you are running the app**, as opposed to
iterating on schema SQL. The `db` container above speaks Postgres and
nothing else — but `apps/api` talks to **PostgREST**, and `apps/web` talks
to **GoTrue** and **Realtime**. So without this stack, a locally running
app reaches the *hosted* Supabase project no matter how many local
containers are up, including under `pnpm docker:apps`. ADR-014 has the
full reasoning.

`supabase start` is itself a Docker orchestrator — it runs Postgres +
PostGIS, PostgREST, GoTrue, Realtime, Storage, and Kong as containers on
your local daemon.

```bash
pnpm docker:supabase          # start, then print the env values to copy
pnpm docker:supabase:status   # keys + ports, without starting anything
pnpm docker:supabase:stop     # stop, keep the data
pnpm docker:supabase:nuke     # stop and DELETE the local data
```

First run pulls roughly 3 GB of images. Subsequent starts take under a
minute.

> **Known blocker: Supabase CLI 2.114 hangs on Windows + Docker Desktop
> (unresolved, 2026-08-16).** All ten images pull successfully and
> `supabase_db_avash` is **created** with the correct settings from
> `config.toml` (verified: image
> `public.ecr.aws/supabase/postgres:17.6.1.155`, host port `54329`) — but
> the CLI then hangs indefinitely at `Starting database...` and never
> transitions the container to running. No error is emitted, including
> under `--debug`; `--ignore-health-check` does not help, because the
> health check is never reached. Started by hand with `docker start
> supabase_db_avash`, the container initializes and reports healthy in
> about a minute, but a subsequent `supabase start` then short-circuits —
> it treats the stack as already up and reports every other service as
> stopped without starting them.
>
> Not a configuration fault: the config parses, and the container the CLI
> creates reflects it exactly. This is a Windows-specific CLI/Docker
> Desktop interaction — worth retrying after a CLI or Docker Desktop
> upgrade, and worth checking against a Linux or macOS host before
> assuming the config is at fault. **Until it is resolved, the local
> Supabase stack is configured and documented but not yet verified
> end to end**, and local runs still reach the hosted project.

| Service | URL |
| --- | --- |
| API gateway (PostgREST + GoTrue + Realtime) | `http://127.0.0.1:54321` |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54329/postgres` |
| Studio | `http://127.0.0.1:54323` |
| Inbucket (catches sign-up emails) | `http://127.0.0.1:54324` |

Ports are deliberately clear of the `db` container's `54322`, so both
local databases can run side by side.

### Pointing the apps at it

`pnpm docker:supabase` prints the exact block to paste. Nothing in any app
branches on the target — the switch is entirely by value:

| File | Local | Deployed |
| --- | --- | --- |
| `apps/web/.env` | `VITE_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` + local anon key | hosted URL + anon key, set in Cloudflare Pages build settings |
| `apps/api/.dev.vars` | `SUPABASE_URL=http://127.0.0.1:54321` + local service-role key + local JWT secret | `wrangler secret put` per environment |
| repo-root `.env` | same three values (jobs, `ml/`, and the `api` container) | GitHub Actions secrets |
| repo-root `.env` | `DATABASE_URL_LOCAL=postgresql://postgres:postgres@127.0.0.1:54329/postgres` | `DATABASE_URL_HOSTED`, only with `--hosted` |

The CLI's anon/service-role/JWT values are its **fixed local demo keys** —
identical on every machine, published in Supabase's own docs, and
worthless against anything but this stack. They are not secrets. Keep your
hosted values somewhere before overwriting them.

### Migrations and seed data

`supabase start` applies `packages/db/supabase/migrations/` itself on a
fresh database — the same files, in the same order, that `pnpm db:migrate`
and `supabase db push` use. There is one set of migrations, never a
local-only variant.

```bash
pnpm db:seed                                              # regions, hospitals, cases
pnpm role:grant -- --email you@example.com --role admin   # after signing up in the app
```

`supabase db reset` (from `packages/db`) drops and re-applies everything
when you want a clean slate without re-pulling images.

### Parity notes specific to this stack

- The CLI pins its **own** Postgres version, independently of
  `POSTGIS_LOCAL_IMAGE`. `major_version` in
  `packages/db/supabase/config.toml` is set to 15 to match; if the hosted
  project is upgraded, that value has to move with it.
- `enable_confirmations = false` is set **locally only**, so a test
  account is usable the moment it is created. The hosted project keeps
  email confirmation on — `supabase db push` pushes migrations, never
  `config.toml`.
- Always invoke the CLI through the repo's pinned devDependency (which
  `pnpm docker:supabase` does). A globally installed `supabase` drifts
  per machine.
- `docker/postgis/initdb/01-auth-shim.sql` is **not** used by this stack
  and never should be — GoTrue owns the real `auth` schema here. The shim
  remains scoped to the plain `db` container, for policy-shape testing
  only.

## The ML runtime

```bash
pnpm docker:ml:build                             # build avash-ml:local
pnpm docker:ml python ml/training/train.py       # train
pnpm docker:ml python ml/training/export_onnx.py # export + checksum ONNX
pnpm docker:ml python ml/serving/predict.py      # batch inference pass
pnpm docker:ml bash                              # interactive shell
```

Each run is `docker compose --profile ml run --rm ml <command>` — a batch
container that executes one command and is removed. There is no server
and no exposed port.

Why containerized at all: LightGBM needs an OpenMP runtime (`libgomp1`,
absent from the slim base), and the ONNX export path is version-sensitive
across `skl2onnx` / `onnxmltools` / `onnxruntime`. A model artifact
exported against a different dependency tree than the scheduled job uses
is a silent correctness problem rather than a build failure — so the
image and `cron-batch-predict.yml` install from the same
`ml/requirements.txt` at the same Python 3.11.

`./ml` and `./packages/ml-inference` are bind-mounted, so source edits and
exported artifacts land on the host with no rebuild. Rebuild only when
`ml/requirements.txt` changes. `ml/data/` is DVC-tracked and gitignored;
it is mounted through `./ml`, never baked into a layer.

Secrets reach the container as environment values interpolated from the
repo-root `.env` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`) — never copied into an image.
Training and ONNX export need none of them; only the batch inference pass
does, since it writes directly to Supabase (ADR-007).

## The app images

```bash
pnpm docker:apps:build   # build avash-web:local, avash-api:local, avash-notify:local
pnpm docker:apps         # run all three (detached)
pnpm docker:apps:logs    # follow all three
pnpm docker:apps:down    # stop and remove them
```

Then `http://localhost:8080` (web), `http://localhost:8787/health` (api),
and `http://localhost:8788/health` (notify). All three publish to
`127.0.0.1` only, and all three run as non-root.

### Dependency caching and forcing a clean install

Each app's `Dockerfile` runs `pnpm install --frozen-lockfile` behind a
BuildKit cache mount (`RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked`),
so a rebuild after touching application source reuses already-downloaded
packages instead of re-fetching the whole workspace from the registry — a
full `pnpm install` on a source-only change drops from several minutes to
roughly twenty seconds. `docker/ml.Dockerfile` does the same for `apt` and
`pip`. `--frozen-lockfile` means the cache can only ever serve package
versions that already match `pnpm-lock.yaml`; it cannot silently drift a
build onto different versions than the lockfile specifies.

The cache mount is **not** part of the image and is **not** cleared by
`docker build --no-cache` — that flag only busts the layer cache, forcing
the `RUN` steps to re-execute, and the install step will still resolve
packages from the mounted store where possible. To force a genuinely
clean install (fetch every package fresh from the registry, e.g. to rule
out a corrupted local cache), clear the cache mount explicitly first:

```bash
docker builder prune --filter type=exec.cachemount
DOCKER_BUILDKIT=1 docker build --no-cache -f apps/notify/Dockerfile -t avash-notify:local .
```

`docker builder prune -a` (or `docker system prune -a`) also clears it,
but drops all other build cache besides — layers for every image, not
just this one — so prefer the filtered form above unless a full reset is
actually what's needed.

## Checking what's running

`docker:db`, `docker:apps`, `docker:apps:down`, `docker:db:nuke`, and
`docker:ml:build` each finish by printing the actual state of every
long-running service — `pnpm docker:status` runs the same check without
starting or stopping anything:

```
=== Avash local stack ===

  db   RUNNING (healthy)  postgresql://postgres:postgres@127.0.0.1:54322/avash
                          shell: pnpm docker:db:psql
  api     RUNNING (healthy)  http://127.0.0.1:8787/health
  web     NOT RUNNING        start: pnpm docker:apps:build && pnpm docker:apps
  notify  RUNNING (healthy)  http://127.0.0.1:8788/health

  ml    built (avash-ml:local)   run: pnpm docker:ml <command>, e.g.
                                 pnpm docker:ml python ml/training/train.py

3 of 4 services up. 1 not running — run the "start:" command(s) above.
```

The URL for each running service is read from `docker compose ps`'s actual
published port, not a hardcoded default — it reflects a `POSTGRES_PORT` /
`WEB_PORT` / `API_PORT` override from `.env` correctly. A service still
inside its container's `HEALTHCHECK` `start_period` (right after `docker
compose up`) is reported as `STARTING`, not `NOT RUNNING` — the two need
different advice, since telling someone to "start" a container that was
just created and is doing exactly what it should is wrong. Implementation:
`scripts/docker-status.mjs`.

Each app owns its own `Dockerfile` and is built independently — there is
no combined image, and none depends on another at build time. All three
build with the **repository root as context** (`-f apps/web/Dockerfile .`),
because each needs workspace packages (`@avash/types`, `@avash/push`,
`@avash/logger`) that live outside the app directory.

### `apps/web` — nginx serving the Vite build

A Node stage runs the real `pnpm --filter web build`; the runtime stage is
`nginxinc/nginx-unprivileged` serving `dist/` with SPA fallback
(`try_files $uri /index.html`, matching `public/_redirects`), the security
headers from `public/_headers`, immutable caching for `/assets/`,
`no-cache` for `index.html`, and a `/healthz` endpoint for the container
health check.

**The image is environment-specific, and that is inherent.** Vite inlines
`VITE_PUBLIC_*` at build time, so the API base URL is compiled into the
JavaScript. It is passed as a build argument:

```bash
docker build -f apps/web/Dockerfile \
  --build-arg VITE_PUBLIC_API_BASE_URL=https://api.example.org \
  -t avash-web:local .
```

A different backend means a different image — there is no runtime
reconfiguration, deliberately (ADR-012 explains why the alternative would
weaken the `VITE_PUBLIC_` boundary rule). The build fails fast if
`VITE_PUBLIC_API_BASE_URL` is empty, rather than producing an image that
serves a blank page — `apps/web/src/lib/env.ts` throws at module load
when that value is missing, and a container that only breaks in the
browser is much worse than a build that stops.

The CSP `connect-src` is generated from that same build argument in the
same build, so the header the container serves and the URL compiled into
the bundle cannot drift apart.

**Only `VITE_PUBLIC_*` values may be build args.** Build arguments are
recorded in image history and readable by anyone who pulls the image;
`VITE_PUBLIC_*` values are public by definition (§7.1), everything else is
not.

### `apps/api` — Node serving the same Hono app

The image runs `apps/api/server/node-server.ts`, a thin adapter that
serves the _same_ `apps/api/src/index.ts` app object through
`@hono/node-server`, passing a bindings object built from `process.env` as
the second argument to `app.fetch()`. esbuild bundles it to one file, so
the runtime stage carries no `node_modules`.

The Worker source is untouched by this: no runtime branching, no
`if (isNode)`, no Node imports under `src/`. The adapter lives outside
`src/` and is typed by its own `tsconfig.node.json`, keeping Node types
out of Worker source — the same split already used for the test configs
(`vitest.config.ts`, `playwright.config.ts`).

Secrets arrive as **runtime** environment variables (`docker run -e` or
compose `environment:`), never as build args and never baked. Values not
set default to empty and are reported once at startup, so the container
runs for a health check without a full secret set.

**Two runtimes, one obligation.** Production runs workerd; this image runs
Node. They are not the same platform, and CI therefore runs `apps/api`'s
Playwright **contract** suite (`apps/api/e2e/`) against **both** — once via
`wrangler dev`, once against the running container. That suite is the
black-box boundary check; the exhaustive route coverage lives in the Vitest
project, which runs inside workerd and so speaks only for that runtime —
which is precisely why the dual Playwright run cannot be dropped. When you
add a route:

- Standard Web APIs (`fetch`, `crypto.randomUUID`, `Request`/`Response`,
  `URL`) work identically on both. Nothing to do.
- A Cloudflare-only API (KV, D1, R2, Durable Objects, `caches.default`,
  `ctx.waitUntil` semantics beyond fire-and-forget) works on one only.
  Either give the adapter a Node equivalent, or mark that spec Worker-only
  and say so in the route's feature doc. Never leave it to be discovered
  by whoever self-hosts.

### `apps/notify` — Node serving the announcement-push delivery service

**This image is local-testing only.** Production deploys `apps/notify` to
Vercel + Inngest (`.github/workflows/deploy-notify.yml`, ADR-016), never
a container — there is no `notify` row in `build-images.yml` or
`docs/ci-cd.md`'s published-images list, and none should be added. This
Dockerfile exists purely so the webhook receiver and the Inngest
functions can be exercised end to end against the local Supabase stack
without a Vercel account or an Inngest Cloud account.

The image runs `apps/notify/server/node-server.ts`, a thin adapter — the
same pattern as `apps/api/server/node-server.ts` — that routes three
paths over one `http.Server`: `POST /api/announcement-published` (the
webhook receiver, via Inngest's `serveEndpoint()` bridge from a Web API
`Request`/`Response` handler to a Node `http.RequestListener`),
`/api/inngest` (Inngest's own `serve()` handler — function registration
and invocation), and `GET /health` (the container health check). esbuild
bundles it to one file, same as `apps/api`'s build.

Secrets arrive as **runtime** environment variables, never build args —
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `ANNOUNCEMENT_WEBHOOK_SECRET`. `compose.yaml`
additionally defaults `INNGEST_DEV=1` — without it, the Inngest SDK
defaults to "cloud mode" and `/api/inngest` 500s on every call with no
`INNGEST_SIGNING_KEY` set; dev mode skips that authentication entirely,
enough to exercise the webhook and the delivery pass against the local
Supabase stack with no Inngest account. Set `INNGEST_EVENT_KEY` +
`INNGEST_SIGNING_KEY` and unset `INNGEST_DEV` to test against a real
Inngest Cloud environment instead. A missing required var logs a
structured warning at startup rather than refusing to start — every
delivery then fails closed inside `packages/push` (a webhook `401` or a
`deliverAnnouncement` throw), the same "runs, but every write path is
dead" tradeoff `apps/api/server/node-server.ts` accepts for its own
optional-at-startup secrets.

To actually see a delivery: publish an announcement against the api
container or `wrangler dev`, then `POST` to
`http://localhost:8788/api/announcement-published` with the
`x-announcement-webhook-secret` header set to your local
`ANNOUNCEMENT_WEBHOOK_SECRET` and a body of
`{"type":"INSERT","table":"announcements","record":{"id":"<uuid>"}}` —
this is what the Supabase Database Webhook sends in production; there is
no local Supabase-CLI equivalent that fires it automatically, so
exercising the receiver locally means sending that request by hand (or
scripting it) rather than relying on the CLI stack to trigger it.

### Published images

`build-images.yml` publishes on merge to `main`:

```
ghcr.io/<owner>/avash-web:sha-<short>   ghcr.io/<owner>/avash-web:latest
ghcr.io/<owner>/avash-api:sha-<short>   ghcr.io/<owner>/avash-api:latest
```

Every PR builds and scans both without publishing. The `sha-` tag is the
durable one — `latest` moves.

## The dev container

`.devcontainer/devcontainer.json` is optional and unrelated to how the
apps run. It provides Node 20, pnpm 9.1.0, Python 3.11, and the Docker
CLI, forwards `5173` / `8787` / `54322`, and runs
`pnpm install --frozen-lockfile` on create. Inside it, `pnpm dev` and
`wrangler dev` run **directly on the container's own Node** — they are not
containerized separately — and `docker compose up -d db` starts the
database as a _sibling_ container through the host daemon socket
(`docker-outside-of-docker`), not a nested daemon.

## In CI

The CI/CD pipeline work wires the same images into GitHub Actions:

- **PostGIS service container** — schema/migration/RLS jobs run against
  `postgis/postgis:15-3.4` declared as a job `services:` entry with a
  `pg_isready` health check, so CI verifies migrations against a real
  spatial database with no hosted dependency and no credentials.
- **hadolint** — `docker/ml.Dockerfile`, `apps/web/Dockerfile`, and
  `apps/api/Dockerfile` are linted on any PR that touches them
  (`build-images.yml`, `docker-image-scan.yml`).
- **Trivy** — every image built by those two workflows is scanned;
  high/critical vulnerabilities fail the job, matching the §11 rule
  already applied to CodeQL findings.
- **`build-images.yml`** — builds `web` and `api` on every PR, publishes
  them to GHCR on `main`.
- **`apps/notify/Dockerfile` has neither yet.** It is deliberately
  outside `build-images.yml` (its deploy target is Vercel, not a
  container, per ADR-016), and nothing else lints or scans it — a real
  gap for a Dockerfile that is still a genuine attack surface on
  whoever's machine runs it, even unpublished. Until it's wired in, run
  `hadolint apps/notify/Dockerfile` by hand before changing it.
- **The API dual-runtime run** — `apps/api`'s Playwright contract suite
  executes twice, against `wrangler dev` and against the running API
  container.
  This is the parity obligation ADR-012 accepts; it is what keeps the
  image honest, and it is not optional.

`docs/ci-cd.md` (written alongside the pipelines) is the authoritative
runbook for those jobs — triggers, required secrets, and debugging a red
run. This document owns the local story.

## Critical constants

| Constant              | Value                                       | Defined in                                             | Purpose                                                                    |
| --------------------- | ------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `POSTGIS_LOCAL_IMAGE` | `postgis/postgis:15-3.4`                    | `compose.yaml`, CI service container                   | Local + CI database parity with Supabase's Postgres 15 / PostGIS 3         |
| `ML_PYTHON_IMAGE`     | `python:3.11-slim-bookworm`                 | `docker/ml.Dockerfile`, cron workflow `python-version` | Reproducible ML runtime; identical tree locally and on schedule            |
| `POSTGRES_LOCAL_PORT` | `54322` (host), `5432` (container)          | `compose.yaml`                                         | Avoids collision with a host Postgres; matches the Supabase CLI convention |
| `WEB_IMAGE_BASE`      | `nginxinc/nginx-unprivileged:1.27.2-alpine` | `apps/web/Dockerfile`                                  | Runtime base for the web image — non-root, listens on 8080                 |
| `API_IMAGE_BASE`      | `node:20.17.0-alpine3.20`                   | `apps/api/Dockerfile` (both stages)                    | Build + runtime base for the API image                                     |
| `APP_CONTAINER_PORTS` | web `8080`, api `8787`, notify `8788`       | nginx conf, `node-server.ts` (api + notify), `compose.yaml` | Fixed in-container ports; host ports override via `WEB_PORT` / `API_PORT` / `NOTIFY_PORT` |
| `CONTAINER_REGISTRY`  | `ghcr.io/<owner>/avash-{web,api}`           | `.github/workflows/build-images.yml`                   | Published image names — `notify` is deliberately absent, see § The app images |

All seven are registered in `docs/PROJECT_PLAN.md` §14 and
`docs/constants-registry.md` — changing one means changing it there in the
same PR (R9). `APP_CONTAINER_PORTS` earns its row: 8080, 8787, and 8788
appear in the nginx server block / both Node entries' `PORT` defaults,
`compose.yaml`, every `HEALTHCHECK` line, and the CSP the web image
serves.

## Security considerations

- **No secret is ever baked into an image.** `.dockerignore` excludes
  `.env`, `.env.*`, `.dev.vars`, and `.dev.vars.*` from every build
  context, so a `COPY` cannot pick one up even by accident. Runtime values
  are passed as environment variables from the host (§7.1).
- **The database is not exposed.** The port publishes to `127.0.0.1`
  explicitly, not `0.0.0.0` — a laptop on a shared network is not serving
  Postgres to it.
- **The local credential is not a secret.** `postgres`/`postgres` guards a
  disposable local database holding seed data. It is a deliberate default,
  not an oversight — and it is precisely why nothing in a deployed
  environment ever reads `DATABASE_URL_LOCAL`. Real Supabase credentials
  live in `.env` / `apps/api/.dev.vars` / GitHub Actions secrets and never
  appear in `compose.yaml`.
- **Every image runs as a non-root user** — `avash` (UID 1000) in the ML
  image, `node` (UID 1000) in both the API and notify images, and UID 101
  in the nginx-unprivileged base. For the ML image this also keeps
  bind-mounted output owned by the developer rather than root.
- **Nothing secret enters an app image.** `apps/web` accepts only
  `VITE_PUBLIC_*` build args — public by definition, and build args are
  permanently readable in image history, so this is a hard rule, not a
  convention. `apps/api` and `apps/notify` read every secret from the
  runtime environment; no secret is a build arg, and none is `COPY`ed in.
  The CI bundle-scan gate (§7.1) applies to the `dist/` inside the web
  image exactly as it does to a Pages build, since it is the same build
  output.
- **Published images are a public artifact.** `ghcr.io/<owner>/avash-*` is
  pullable by anyone the package visibility allows — treat every layer as
  published, and assume anything committed to the repo is inside it.
- **Base images are exact-pinned**, and Dependabot's `docker` ecosystem
  proposes bumps as reviewable PRs. An unpinned `:latest` would silently
  change the database engine under a migration suite.
- **Image scanning is a CI gate**, not advisory — a high/critical Trivy
  finding fails the job.
- **Supply chain:** `postgis/postgis` is the PostGIS project's official
  image; `python` and `node` are Docker Official Images; and
  `nginxinc/nginx-unprivileged` is published by the nginx project itself
  (the unprivileged variant is chosen precisely so the web image never
  needs a root master process). No community or personal-namespace base
  image is used anywhere.

## Troubleshooting

**`failed to connect to the docker API` / `daemon is not running`** — the
CLI is installed but the engine is down. Start Docker Desktop (or
`sudo systemctl start docker`) and retry. `docker compose config`
validates the file client-side and will succeed even with the engine
stopped, so a passing `config` is not evidence a container can start.

**Port 54322 already allocated** — another Postgres or a previous stack is
bound. Set `POSTGRES_PORT` in `.env` and restart, or stop the other one.

**Extensions missing after editing `initdb/`** — init scripts run only on
an empty data volume. `pnpm docker:db:nuke && pnpm docker:db`.

**`import lightgbm` fails with a libgomp error** — the image layer that
installs `libgomp1` was skipped or the image is stale. Rebuild with
`docker compose --profile ml build --no-cache ml`.

**A rebuild after a `pnpm-lock.yaml` change still looks like it's reusing
stale packages** — `docker build --no-cache` does not clear the pnpm store
cache mount described under [Dependency caching and forcing a clean
install](#dependency-caching-and-forcing-a-clean-install); it only busts
the layer cache. Run `docker builder prune --filter type=exec.cachemount`
first, then rebuild.

**The web container serves a blank page with a console error about
`VITE_PUBLIC_API_BASE_URL`** — the image was built without the build arg.
`env.ts` throws at module load by design. Rebuild passing
`--build-arg VITE_PUBLIC_API_BASE_URL=...`; there is no way to fix this on
a running container, because the value is compiled into the bundle.

**The web container loads but every API call is blocked by CSP** — the
image was built pointing at a different API origin than the one you are
actually calling. The CSP is generated from the same build arg as the
compiled URL, so this always means "rebuild for this environment," never
"edit the header."

**`docker build` for either app fails resolving `@avash/types` or
`@avash/logger`** — the build was run with the app directory as context.
Both images require the repository root:
`docker build -f apps/web/Dockerfile .` (note the trailing `.`).

**An API route works under `pnpm --filter api dev` but 500s in the
container** — that is the workerd/Node split, and it is exactly what the
dual-runtime CI run exists to catch. Check whether the route touches a
Cloudflare-only API; the fix is a Node path in the adapter or an explicit
Worker-only marker, not a workaround in `src/`.

**Apple Silicon** — both images publish `linux/arm64`, so no emulation is
needed. If a pinned tag ever lacks an arm64 variant, Docker falls back to
emulation with a warning and a large performance cost; treat that warning
as a signal to fix the pin, not to ignore.

**Windows** — Docker Desktop's WSL2 backend is required; bind-mount
performance is best when the repository lives on the Linux filesystem
rather than under `/mnt/c`. The apps themselves are unaffected either way,
since they never run in a container.

**Reclaiming space** — `pnpm docker:db:nuke` drops the database volume;
`docker image prune` and `docker builder prune` clear stale layers and
build cache.

## Verification status

Read this before trusting anything above.

**Everything described in this document is on disk and has been run**, on
Windows 11 with Docker Desktop 4.83 (WSL2 backend, Docker Engine 29.6.2,
Compose v5.3.1), on 2026-08-02:

- **`db`** — `pnpm docker:db` brought the container to `healthy`;
  `select postgis_version()` returned `3.4`; `select extname from
pg_extension` returned `plpgsql`, `postgis`, `pgcrypto`. The port publishes
  to `127.0.0.1:54322` only (`docker port avash-db` confirmed). Ran
  `pnpm docker:db:nuke` followed by `pnpm docker:db`: the fresh volume
  re-initialized and both extensions were present again, confirming the
  reset path.
- **`ml`** — `pnpm docker:ml:build` built cleanly against the pinned
  `python:3.11-slim-bookworm`; `ml/requirements.txt`'s pins resolved
  without a resolver conflict, so **no correction was needed** this run.
  `import lightgbm, onnxruntime, onnx, skl2onnx, shap, pandas` succeeded
  inside the container. `id -u` reported `1000` (the `avash` user, not
  root), and a file written into the bind-mounted
  `packages/ml-inference` was created with that same UID.
- **`web` and `api`** — `pnpm docker:apps:build` built both images
  (`avash-web:local` 80.2MB, `avash-api:local` 190MB). `pnpm docker:apps`
  brought both to `healthy`. `GET /health` on the API returned `200` with
  all documented security headers and `X-Request-Id`; an `Origin:
https://evil.example` request got no `Access-Control-Allow-Origin` header
  back. `GET /healthz` on the web container returned `ok`; `GET /` served
  the built `index.html` with `Content-Security-Policy: ... connect-src
'self' http://localhost:8787 ...` — matching the `VITE_PUBLIC_API_BASE_URL`
  build arg exactly, confirming the CSP-substitution step. A deep link
  (`/some/deep/route`) returned `200` (SPA fallback), not a 404. `id -u`
  reported `1000` inside the api container and `101` inside the web
  container. `docker history` on both images was grepped for every
  server-only secret name (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`,
  etc.) — clean on both. The rendered page was verified via `curl` against
  the built HTML/headers rather than a GUI browser session (no interactive
  display in this environment); the HTML, CSP, and health-endpoint checks
  together are the same signal a manual browser check would confirm.
- **hadolint** — run via `docker run --rm -i hadolint/hadolint` against
  all three Dockerfiles. Findings are warning/info level only (e.g. `DL3008`
  pin apt versions, `DL3064` build-arg-may-contain-sensitive-data on the
  `VITE_PUBLIC_*` ARGs, `DL3025` shell-form `HEALTHCHECK CMD`) — nothing at
  `error` level, so the CI action's default `failure-threshold: error`
  passes. Nothing was changed to silence a finding.
- **Trivy** — proven to hard-fail on a real vulnerability by scanning
  `python:3.9-slim` (deliberately outdated) with the exact CI flags
  (`--severity HIGH,CRITICAL --ignore-unfixed --exit-code 1`): exit code
  `1` on multiple CVEs including `CVE-2026-23949` (HIGH). The project's own
  images (`avash-ml:local`, `avash-web:local`, `avash-api:local`) were not
  scanned locally in this pass — that scan runs in CI
  (`docker-image-scan.yml`, `build-images.yml`) against the exact images
  built there.
- **The API dual-runtime parity run** — the full `apps/api` Playwright
  suite (11 specs) was run twice: once against `wrangler dev` (the
  existing baseline) and once with `API_TEST_TARGET=container`
  against a running `avash-api:local` container with the same
  `CORS_ALLOWED_ORIGINS`/`CORS_PREVIEW_ORIGIN_SUFFIX` values `wrangler dev`
  uses. All 11 passed identically on both runtimes — no spec was skipped,
  softened, or marked Worker-only.

**Not verified in this pass:** the GitHub Actions runs themselves (`ci.yml`,
`build-images.yml`, `docker-image-scan.yml`) — everything above was run
against the equivalent local commands/flags, not by pushing and watching a
live workflow. See exit-gate item 26 and `docs/ci-cd.md`.
