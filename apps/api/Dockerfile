# syntax=docker/dockerfile:1
#
# apps/api container image (ADR-012).
#
# THE BUILD CONTEXT IS THE REPOSITORY ROOT:
#   docker build -f apps/api/Dockerfile -t avash-api:local .
#
# Production runs this same Hono app on Cloudflare's workerd via
# `wrangler deploy`. This image runs it on Node through the adapter in
# apps/api/server/. The two runtimes are kept honest by CI running the
# API test suite against both — see docs/docker.md.

FROM node:24.1.0-alpine3.20 AS build
WORKDIR /repo
ENV CI=true

RUN corepack enable && corepack prepare pnpm@9.1.0 --activate

COPY . .

# `COPY . .` before install (rather than a hand-copied list of workspace
# manifests) is deliberate — see apps/web/Dockerfile's identical comment.
# The cache mount is what keeps that simple approach cheap: BuildKit
# persists pnpm's content-addressed package store across builds even
# though the layer above it is invalidated by every source change, so a
# rebuild after touching application code reuses already-downloaded
# packages instead of refetching the whole workspace from the registry.
# `sharing=locked` serializes access so concurrent builds (web/api/notify
# built in parallel) don't corrupt the shared store.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile \
    && pnpm --filter api build:node

# Fail here, not at `docker run`. An esbuild that exits 0 having written an
# empty bundle produces a runtime image whose `node server.mjs` also exits
# 0 — no logs, no listening port, just a container that restarts forever
# and reports nothing. A byte count catches it while the build can still
# fail.
RUN test -s apps/api/dist-node/server.mjs \
    || (echo "ERROR: apps/api/dist-node/server.mjs is empty — esbuild produced no output" && exit 1)

FROM node:24.1.0-alpine3.20 AS runtime

ENV NODE_ENV=production \
    PORT=8787

WORKDIR /app

# esbuild produced one self-contained ESM file, so the runtime stage
# carries no node_modules and no package manager.
COPY --from=build /repo/apps/api/dist-node/server.mjs ./server.mjs

# node:alpine ships a non-root `node` user; the numeric UID (rather than
# the name) is what host systems and orchestrators can actually resolve.
USER 1000

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["sh", "-c", "wget --quiet --spider http://127.0.0.1:8787/health || exit 1"]

CMD ["node", "server.mjs"]
