# syntax=docker/dockerfile:1
#
# apps/web container image (ADR-012).
#
# THE BUILD CONTEXT IS THE REPOSITORY ROOT, not apps/web:
#   docker build -f apps/web/Dockerfile \
#     --build-arg VITE_PUBLIC_API_BASE_URL=http://localhost:8787 \
#     -t avash-web:local .
#
# apps/web imports workspace packages (@avash/types) that live outside
# apps/web, so a narrower context cannot install.

FROM node:24.1.0-alpine3.20 AS build
WORKDIR /repo
ENV CI=true

RUN corepack enable && corepack prepare pnpm@9.1.0 --activate

# The whole workspace in one COPY. Deliberately simple: a hand-maintained
# list of per-package manifests caches better, but breaks silently the
# moment a package is added. Correctness beats a warm layer here.
COPY . .

RUN pnpm install --frozen-lockfile

# VITE_PUBLIC_* ONLY. Build args are readable in image history forever;
# every value here is public by definition (§7.1). A server-only secret
# passed as a build arg is a leak, not a configuration choice.
ARG VITE_PUBLIC_API_BASE_URL
ARG VITE_PUBLIC_SUPABASE_URL=""
ARG VITE_PUBLIC_SUPABASE_ANON_KEY=""
ARG VITE_PUBLIC_TURNSTILE_SITE_KEY=""
ARG VITE_PUBLIC_VAPID_PUBLIC_KEY=""

ENV VITE_PUBLIC_API_BASE_URL=$VITE_PUBLIC_API_BASE_URL \
    VITE_PUBLIC_SUPABASE_URL=$VITE_PUBLIC_SUPABASE_URL \
    VITE_PUBLIC_SUPABASE_ANON_KEY=$VITE_PUBLIC_SUPABASE_ANON_KEY \
    VITE_PUBLIC_TURNSTILE_SITE_KEY=$VITE_PUBLIC_TURNSTILE_SITE_KEY \
    VITE_PUBLIC_VAPID_PUBLIC_KEY=$VITE_PUBLIC_VAPID_PUBLIC_KEY

# Fail here, not in the user's browser. apps/web/src/lib/env.ts throws at
# module load when this is missing, so an image built without it would
# build fine and then serve a blank page.
RUN test -n "$VITE_PUBLIC_API_BASE_URL" \
    || (echo "ERROR: --build-arg VITE_PUBLIC_API_BASE_URL is required (bare origin, no trailing slash)" && exit 1)

RUN pnpm --filter web build \
    && rm -f apps/web/dist/bundle-report.html

# Both nginx configs are generated from the same build arg as the
# compiled bundle, so the served CSP and the API URL inside the
# JavaScript cannot drift apart.
RUN sed "s|__API_ORIGIN__|${VITE_PUBLIC_API_BASE_URL}|g" \
      apps/web/docker/default.conf.template > /tmp/default.conf \
    && sed "s|__API_ORIGIN__|${VITE_PUBLIC_API_BASE_URL}|g" \
      apps/web/docker/security-headers.conf.template > /tmp/security-headers.conf

FROM nginxinc/nginx-unprivileged:1.31.3-alpine AS runtime

# This base already runs as UID 101 and listens on 8080 — no root master
# process, no privileged port, nothing to drop.
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY --from=build /tmp/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /tmp/security-headers.conf /etc/nginx/snippets/security-headers.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["sh", "-c", "wget --quiet --spider http://127.0.0.1:8080/healthz || exit 1"]
