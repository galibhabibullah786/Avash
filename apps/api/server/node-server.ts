/**
 * Node entry point for the apps/api container image (ADR-012).
 *
 * Production runs on Cloudflare's workerd via `wrangler deploy`; this file
 * exists only so the same app can run in a portable container. It serves
 * the SAME app object exported by ../src/index.ts — no fork, no runtime
 * branching inside src/. Everything Node-specific lives here and is typed
 * by tsconfig.node.json, keeping Node types out of Worker source.
 */
import { serve } from '@hono/node-server';
import app from '../src/index';
import type { Bindings } from '../src/types';

/** In-container port (`APP_CONTAINER_PORTS`, docs/PROJECT_PLAN.md §14). */
const DEFAULT_PORT = 8787;

/**
 * Deploy-time config read on every request. A missing value here is a
 * misconfiguration, not a degraded mode, and the container refuses to
 * start rather than answering wrongly.
 *
 * `CORS_ALLOWED_ORIGINS`: an empty allow-list rejects every browser
 * origin, which is a miserable failure to diagnose from outside the
 * container.
 *
 * The rest are secrets whose absence fails CLOSED inside a guard rather
 * than surfacing as a config error. Both of those guards return a generic
 * body (R10), so from the browser an unset secret is indistinguishable
 * from a real rejection:
 *   - `UPSTASH_REDIS_REST_*` — packages/security/rateLimit.ts cannot
 *     consult a limiter it cannot reach, so every symptom check and every
 *     breeding-site report 429s.
 *   - `TURNSTILE_SECRET_KEY` — siteverify answers `invalid-input-secret`,
 *     so every breeding-site report 403s.
 *   - `SUPABASE_*` — every read and write against PostgREST fails, and
 *     `GET /health/db` reports `ready: false`.
 * Starting a container that answers `/health` with 200 while every write
 * path is dead is worse than not starting, so these are required too.
 */
const REQUIRED_VARS = [
  'CORS_ALLOWED_ORIGINS',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'TURNSTILE_SECRET_KEY',
] as const;

/**
 * Genuinely degradable. `GEMINI_API_KEY` absent means the symptom checker
 * still returns a triage outcome from the checklist alone
 * (`aiAssistAvailable: false`, ADR-004) and a breeding report is still
 * accepted, just flagged for manual review — both are designed fallbacks,
 * not failures. The startup log names it so an operator learns it here
 * rather than wondering why AI assist never appears.
 *
 * `CLOUDINARY_*` absent means `POST /api/uploads/signature` fails closed
 * (ADR-015) — it has no caller in this slice, so a container without them
 * still serves every other route.
 */
const OPTIONAL_VARS = ['GEMINI_API_KEY', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const;

function readBindings(): Bindings {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'compose.yaml forwards these into the api service from the repo-root .env — ' +
        'copy .env.example to .env and fill them in. See docs/security/secrets-matrix.md.'
    );
  }

  const unset = OPTIONAL_VARS.filter((name) => !process.env[name]);
  if (unset.length > 0) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        message: 'Starting with unset optional environment variables — the features they back run in their documented fallback mode',
        variables: unset,
      })
    );
  }

  return {
    SUPABASE_URL: process.env.SUPABASE_URL ?? '',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET ?? '',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '',
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL ?? '',
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY ?? '',
    ENVIRONMENT: process.env.ENVIRONMENT ?? 'development',
    CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS ?? '',
    CORS_PREVIEW_ORIGIN_SUFFIX: process.env.CORS_PREVIEW_ORIGIN_SUFFIX ?? '',
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY ?? '',
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET ?? '',
  };
}

/**
 * workerd hands every request an ExecutionContext; @hono/node-server does
 * not. A route calling waitUntil() must not crash under Node, so this runs
 * the promise fire-and-forget and swallows rejection the way a detached
 * Worker task would.
 */
const executionCtx = {
  waitUntil(promise: Promise<unknown>): void {
    void Promise.resolve(promise).catch(() => undefined);
  },
  passThroughOnException(): void {
    // No Cloudflare origin to fall through to. A thrown error is handled
    // by the app's own onError boundary (§9, R10).
  },
  props: undefined,
};

const bindings = readBindings();
const port = Number(process.env.PORT ?? DEFAULT_PORT);

serve(
  {
    fetch: (request: Request) => app.fetch(request, bindings, executionCtx),
    port,
    hostname: '0.0.0.0',
  },
  (info) => {
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'apps/api listening on the Node runtime (ADR-012)',
        port: info.port,
        environment: bindings.ENVIRONMENT,
      })
    );
  }
);
