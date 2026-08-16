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

# Fail here, not in the user's browser. apps/web/src/lib/env.ts calls
# requireVar() on each of these and throws at module load when one is
# empty, so an image built without them builds fine and then serves a
# blank page. This list must stay in step with that file's `env` export.
RUN for name in VITE_PUBLIC_API_BASE_URL \
                VITE_PUBLIC_SUPABASE_URL \
                VITE_PUBLIC_SUPABASE_ANON_KEY \
                VITE_PUBLIC_TURNSTILE_SITE_KEY; do \
      eval "value=\$$name"; \
      test -n "$value" || { \
        echo "ERROR: --build-arg $name is required; apps/web/src/lib/env.ts throws without it."; \
        echo "       Set it in the repo-root .env (compose.yaml passes it through as a build arg)."; \
        exit 1; \
      }; \
    done

RUN pnpm --filter web build \
    && rm -f apps/web/dist/bundle-report.html

# Both nginx configs are generated from the same build args as the
# compiled bundle, so the served CSP and the origins inside the
# JavaScript cannot drift apart.
#
# The Realtime socket origin is VITE_PUBLIC_SUPABASE_URL with the scheme
# swapped to ws/wss — the derivation supabase-js itself does. Handled with
# two ordered substitutions rather than one, because `https://` must be
# rewritten before the bare `http://` case or it matches the prefix first.
RUN SUPABASE_WS_ORIGIN="$(printf '%s' "${VITE_PUBLIC_SUPABASE_URL}" \
      | sed -e 's|^https://|wss://|' -e 's|^http://|ws://|')" \
    && for template in default security-headers; do \
         sed -e "s|__API_ORIGIN__|${VITE_PUBLIC_API_BASE_URL}|g" \
             -e "s|__SUPABASE_ORIGIN__|${VITE_PUBLIC_SUPABASE_URL}|g" \
             -e "s|__SUPABASE_WS_ORIGIN__|${SUPABASE_WS_ORIGIN}|g" \
             "apps/web/docker/${template}.conf.template" > "/tmp/${template}.conf"; \
       done

FROM nginxinc/nginx-unprivileged:1.31.3-alpine AS runtime

# This base already runs as UID 101 and listens on 8080 — no root master
# process, no privileged port, nothing to drop.
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY --from=build /tmp/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /tmp/security-headers.conf /etc/nginx/snippets/security-headers.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["sh", "-c", "wget --quiet --spider http://127.0.0.1:8080/healthz || exit 1"]
