import { appRoleSchema, DEFAULT_APP_ROLE, type AppRole } from '@avash/types';

/**
 * Where a custom role lives in a Supabase JWT (decision A). `app_metadata`
 * is set server-side only — a user cannot self-assign it via `user_metadata`,
 * which the client can write.
 */
export const APP_ROLE_CLAIM_PATH = 'app_metadata.role';

export type { AppRole };
export { DEFAULT_APP_ROLE };

const APP_ROLES: readonly AppRole[] = appRoleSchema.options;

function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value);
}

/**
 * Reads the custom role out of a decoded JWT's claims. Every access is
 * optional-chained (R7) — `claims` comes from a token the caller does not
 * fully control, and a malformed or absent app_metadata must resolve to
 * "no role", never throw.
 *
 * Returns `null` for "no valid role claim present", which is NOT the same
 * as `citizen`: an anonymous visitor has no claims at all, while a
 * signed-in user with no grant is a citizen. Callers that already know the
 * principal is authenticated resolve the difference with
 * `resolveAppRole()`; keeping the two apart stops an unauthenticated
 * request from silently acquiring citizen's (small, but non-empty)
 * capability set.
 */
export function readAppRole(claims: unknown): AppRole | null {
  if (typeof claims !== 'object' || claims === null) {
    return null;
  }
  const appMetadata = (claims as Record<string, unknown>)?.app_metadata;
  if (typeof appMetadata !== 'object' || appMetadata === null) {
    return null;
  }
  const role = (appMetadata as Record<string, unknown>)?.role;
  return isAppRole(role) ? role : null;
}

/**
 * The role of an *authenticated* principal: whatever the claim says, or
 * `citizen` when it says nothing valid. Use this only once the token has
 * been verified — never to upgrade an anonymous caller.
 */
export function resolveAppRole(claims: unknown): AppRole {
  return readAppRole(claims) ?? DEFAULT_APP_ROLE;
}

/**
 * What a role is allowed to do. Authorization is expressed here and
 * nowhere else — there is deliberately no rank comparison, because the
 * roles do not form a line: a moderator reviews reports but has no
 * business editing a hospital's blood stock, and hospital staff have no
 * business clearing the moderation queue. Only `admin` is a superset, and
 * it is a superset because it is explicitly granted every capability,
 * not because it sorts highest.
 */
export type Capability =
  | 'reports:moderate'
  | 'news:moderate'
  | 'inventory:write'
  | 'hospitals:manage'
  | 'roles:manage';

export const ROLE_CAPABILITIES: Readonly<Record<AppRole, readonly Capability[]>> = {
  citizen: [],
  moderator: ['reports:moderate', 'news:moderate', 'inventory:write', 'hospitals:manage'],
  admin: ['reports:moderate', 'news:moderate', 'inventory:write', 'hospitals:manage', 'roles:manage'],
};

/**
 * The single authorization predicate. A `null`/`undefined` role (no valid
 * claim — i.e. anonymous) can do nothing, so the check fails closed
 * without the caller having to special-case it.
 *
 * `inventory:write` is necessary but NOT sufficient on its own: the
 * `blood_inventory` RLS policy additionally requires membership in
 * `verified_hospital_staff` for that specific hospital, so a
 * hospital_staff token cannot write another hospital's stock. This
 * function answers "may this role attempt the action", never "does this
 * row belong to them" — that stays in the database (defense in depth,
 * §7.2 spoofing row).
 */
export function can(role: AppRole | null | undefined, capability: Capability): boolean {
  if (!role || !isAppRole(role)) {
    return false;
  }
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

/**
 * Retained because `Header.tsx`, `ProtectedRoute.tsx`, and the reports
 * route all read as "is this person on the moderation side", which is
 * exactly `reports:moderate`. Kept as a named helper rather than inlined
 * so the moderator/admin pair is defined once.
 */
export function isModerator(role: AppRole | null | undefined): boolean {
  return can(role, 'reports:moderate');
}

export function isAdmin(role: AppRole | null | undefined): boolean {
  return role === 'admin';
}
