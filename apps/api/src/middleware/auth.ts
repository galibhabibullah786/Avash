import type { MiddlewareHandler } from 'hono';
import { buildGenericErrorBody } from '@avash/logger';
import { can, resolveAppRole, type Capability } from '@avash/security';
import { jwtVerify } from '../lib/jwtVerify';
import type { AppEnv, AuthenticatedUser } from '../types';

export interface AuthOptions {
  /**
   * When set, a valid token whose role lacks this capability 403s instead
   * of proceeding. Gating on a capability rather than a role name means
   * adding a role never silently locks it out of routes it should reach,
   * and never silently admits it to routes it should not — the grant is
   * made once, in `ROLE_CAPABILITIES`.
   */
  capability?: Capability;
}

function extractBearerToken(header: string | undefined): string | null {
  const [scheme, token] = header?.split(' ') ?? [];
  return scheme === 'Bearer' && token ? token : null;
}

/**
 * Verifies the caller's Supabase session and, optionally, a capability
 * derived from the app_metadata role (decision A). 401s a
 * missing/invalid/expired token; 403s a valid token whose role lacks
 * `options.capability`. Both use the generic error body — the distinction
 * is the status code only, never a message string (R10).
 *
 * A verified token with no (or an unrecognized) role claim resolves to
 * `citizen`, never to "unrestricted" — `resolveAppRole` only ever runs
 * after `jwtVerify` has succeeded, so an anonymous caller cannot reach it.
 */
export const auth =
  (options?: AuthOptions): MiddlewareHandler<AppEnv> =>
    async (c, next) => {
      const requestId = c.get('requestId');
      const token = extractBearerToken(c.req.header('Authorization'));

      if (!token) {
        return c.json(buildGenericErrorBody(requestId), 401);
      }

      const result = await jwtVerify(token, {
        secret: c.env.SUPABASE_JWT_SECRET,
        supabaseUrl: c.env.SUPABASE_URL,
      });
      if (!result.ok) {
        return c.json(buildGenericErrorBody(requestId), 401);
      }

      const role = resolveAppRole(result.claims);
      const user: AuthenticatedUser = {
        id: String(result.claims?.sub ?? ''),
        email: typeof result.claims?.email === 'string' ? result.claims.email : null,
        role,
      };

      if (options?.capability && !can(role, options.capability)) {
        return c.json(buildGenericErrorBody(requestId), 403);
      }

      c.set('user', user);
      await next();
    };
