# syntax=docker/dockerfile:1
#
# apps/notify container image (ADR-012, ADR-016) — local-testing only.
#
# THE BUILD CONTEXT IS THE REPOSITORY ROOT:
#   docker build -f apps/notify/Dockerfile -t avash-notify:local .
#
# Production runs this same delivery logic on Vercel + Inngest. This
# image runs it on plain Node through the adapter in apps/notify/server/,
# for local integration testing without a Vercel account — see
# docs/docker.md. It is not the production deploy path (that's
# .github/workflows/deploy-notify.yml).

FROM node:24.1.0-alpine3.20 AS build
WORKDIR /repo
ENV CI=true

RUN corepack enable && corepack prepare pnpm@9.1.0 --activate

COPY . .

# `COPY . .` before install is deliberate — see apps/web/Dockerfile's
# identical comment. The cache mount is what keeps that simple approach
# cheap: BuildKit persists pnpm's content-addressed package store across
# builds even though the layer above it is invalidated by every source
# change, so a rebuild after touching application code reuses
# already-downloaded packages instead of refetching the whole workspace
# from the registry. `sharing=locked` serializes access so concurrent
# builds (web/api/notify built in parallel) don't corrupt the shared store.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile \
    && pnpm --filter notify build:node

# Fail here, not at `docker run` — see apps/api/Dockerfile's identical
# check for why an empty bundle is worse than a build failure.
RUN test -s apps/notify/dist-node/server.cjs \
    || (echo "ERROR: apps/notify/dist-node/server.cjs is empty — esbuild produced no output" && exit 1)

FROM node:24.1.0-alpine3.20 AS runtime

ENV NODE_ENV=production \
    PORT=8788

WORKDIR /app

# CJS, not ESM (unlike apps/api's server.mjs): inngest's dependency tree
# pulls in `debug`, a CJS package that dynamic-`require()`s Node builtins
# (e.g. `tty`) in a way esbuild's ESM output cannot shim — it throws
# "Dynamic require ... is not supported" at startup. esbuild's CJS output
# uses a real `require`, so the same dependency loads normally. Verified
# by running the bundle directly; ESM (`--format=esm` + `server.mjs`)
# reproduces the crash every time.
COPY --from=build /repo/apps/notify/dist-node/server.cjs ./server.cjs

USER 1000

EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["sh", "-c", "wget --quiet --spider http://127.0.0.1:8788/health || exit 1"]

CMD ["node", "server.cjs"]
