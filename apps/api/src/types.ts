import type { AppRole } from '@avash/security';

export interface Bindings {
  /** Project URL — not secret (docs/security/secrets-matrix.md), but read server-side only under this name. */
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  GEMINI_API_KEY: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  TURNSTILE_SECRET_KEY: string;
  ENVIRONMENT: string;
  /** Comma-separated exact origins, e.g. "https://avash.pages.dev" (§14 `CORS_ALLOWED_ORIGINS`). */
  CORS_ALLOWED_ORIGINS: string;
  /** Bare domain suffix PR-preview origins must end in, e.g. "avash.pages.dev" (no scheme, no leading dot). */
  CORS_PREVIEW_ORIGIN_SUFFIX: string;
  /** Server-only (R2) — signs direct-to-Cloudinary uploads (ADR-015). Never referenced under apps/web. */
  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  /**
   * Never null: `auth` only sets this after `jwtVerify` succeeds, and a
   * verified token with no role claim resolves to `citizen`
   * (`resolveAppRole`). Anonymity is expressed by `Variables.user` being
   * absent, not by a null role here.
   */
  role: AppRole;
}

export interface Variables {
  requestId: string;
  user?: AuthenticatedUser;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: Variables;
}
