import type { Bindings } from '../types';

type CorsEnv = Pick<Bindings, 'CORS_ALLOWED_ORIGINS' | 'CORS_PREVIEW_ORIGIN_SUFFIX'>;

/** `CORS_PREFLIGHT_MAX_AGE_S` (§14) — 24h preflight cache max-age header. */
export const CORS_PREFLIGHT_MAX_AGE_S = 86400;

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `CORS_ALLOWED_ORIGINS` (§14) — read from Worker vars (`wrangler.toml`),
 * never hardcoded in source. This is deploy-time configuration, not a
 * secret: the production Pages domain and PR-preview suffix are public
 * knowledge, and keeping them in `wrangler.toml` means a domain change
 * doesn't require a code change or redeploy of new source.
 */
export function isAllowedOrigin(origin: string | undefined, env: CorsEnv): boolean {
  if (!origin) return false;

  const rawOrigins = env?.CORS_ALLOWED_ORIGINS ?? '';
  const exactOrigins = rawOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (exactOrigins.includes(origin)) return true;

  const suffix = env?.CORS_PREVIEW_ORIGIN_SUFFIX?.trim();
  if (suffix) {
    const previewPattern = new RegExp(`^https://[a-z0-9-]+\\.${escapeForRegExp(suffix)}$`);
    if (previewPattern.test(origin)) return true;
  }

  return false;
}
