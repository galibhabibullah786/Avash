/**
 * Fail-fast validation for required `VITE_PUBLIC_*` vars (R2, §7.1).
 * A missing var throws a clear, actionable error at module load instead of
 * silently resolving to `undefined` deep inside a fetch call. Each var is
 * a static `import.meta.env.VITE_PUBLIC_*` access so the eslint-config
 * secrets-boundary rule (packages/config/eslint-config) can verify it.
 */
const apiBaseUrl = import.meta.env.VITE_PUBLIC_API_BASE_URL;
const supabaseUrl = import.meta.env.VITE_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY;
const turnstileSiteKey = import.meta.env.VITE_PUBLIC_TURNSTILE_SITE_KEY;
const vapidPublicKey = import.meta.env.VITE_PUBLIC_VAPID_PUBLIC_KEY;

function requireVar(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". Copy apps/web/.env.example to apps/web/.env and set it.`
    );
  }
  return value;
}

export const env = {
  apiBaseUrl: requireVar('VITE_PUBLIC_API_BASE_URL', apiBaseUrl),
  supabaseUrl: requireVar('VITE_PUBLIC_SUPABASE_URL', supabaseUrl),
  supabaseAnonKey: requireVar('VITE_PUBLIC_SUPABASE_ANON_KEY', supabaseAnonKey),
  turnstileSiteKey: requireVar('VITE_PUBLIC_TURNSTILE_SITE_KEY', turnstileSiteKey),
  /**
   * Optional, deliberately — unlike the four above, a missing VAPID key
   * degrades one feature (Web Push registration) rather than breaking the
   * app, so it must not throw at module load and take every page down
   * with it. It IS read here rather than at the call site so the whole
   * client env surface stays in one file and the secrets-boundary lint
   * rule can see the static `import.meta.env.VITE_PUBLIC_*` access.
   *
   * `deploy-web.yml` injects it from the environment's
   * `VITE_PUBLIC_VAPID_PUBLIC_KEY` variable; if that is unset, the build
   * succeeds and push registration reports itself as unconfigured
   * (`usePushSubscription`), which is a named, visible state rather than
   * a generic failure someone has to reverse-engineer from a console.
   */
  vapidPublicKey: vapidPublicKey ?? null,
};
