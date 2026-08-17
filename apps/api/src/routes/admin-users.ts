import { Hono } from 'hono';
import { z } from 'zod';
import {
  roleAssignmentRequestSchema,
  roleAssignmentResponseSchema,
  listQueryFor,
  paginatedResponseSchema,
  managedUserSchema,
  LIST_PAGE_SIZE_MAX,
  type ManagedUser,
} from '@avash/types';
import { buildGenericErrorBody, logger } from '@avash/logger';
import {
  ROLE_ASSIGNMENT_RATE_LIMIT,
  resolveAppRole,
  buildAuditEntry,
  writeAuditEntry,
  type RateLimitRedisLike,
} from '@avash/security';
import { auth } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { createSupabaseAdmin } from '../lib/supabaseAdmin';
import { createAuditSink } from '../lib/auditSink';
import { parseListQuery, buildPageMeta } from '../lib/listQuery';
import type { AppEnv, Bindings } from '../types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `ADMIN_USER_PAGE_SIZE` (§14) — default page size for the admin user list (decision F). */
const ADMIN_USER_PAGE_SIZE = 50;

/**
 * The Admin API cannot sort, so the sortable set is empty (baseline fact
 * 3) — but its page size default is this route's own constant rather than
 * the shared `LIST_PAGE_SIZE_DEFAULT` (decision F); `LIST_PAGE_SIZE_MAX`
 * still bounds it.
 */
const adminUsersListQuerySchema = listQueryFor([]).extend({
  pageSize: z.coerce.number().int().min(1).max(LIST_PAGE_SIZE_MAX).default(ADMIN_USER_PAGE_SIZE),
});

/**
 * The Supabase Admin API's user shape, narrowed to what this route reads.
 * Every field is optional-chained at the call site (R7) — this comes from
 * a third-party SDK response, not from our own schema.
 */
interface AdminApiUser {
  id?: unknown;
  email?: unknown;
  created_at?: unknown;
  last_sign_in_at?: unknown;
  app_metadata?: unknown;
}

function toManagedUser(user: AdminApiUser | null | undefined): ManagedUser | null {
  const id = user?.id;
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    return null;
  }
  return {
    id,
    email: typeof user?.email === 'string' ? user.email : null,
    role: resolveAppRole(user),
    createdAt: typeof user?.created_at === 'string' ? user.created_at : new Date(0).toISOString(),
    lastSignInAt: typeof user?.last_sign_in_at === 'string' ? user.last_sign_in_at : null,
  };
}

export interface CreateAdminUsersOptions {
  /** Test seam — route tests inject a fake in place of a real Upstash client. */
  redisFactory?: (env: Bindings) => RateLimitRedisLike;
}

/**
 * Admin-only role administration. This is the mechanism that was missing:
 * before it, `app_metadata.role` could only be set by hand in the Supabase
 * dashboard, which is neither auditable nor delegable.
 *
 * Why `apps/api` and not the browser: writing `app_metadata` requires the
 * service-role key (the Admin API rejects the anon key outright), and that
 * key must never reach `apps/web` (R2). The browser holds only its own
 * session token; the Worker verifies it, checks `roles:manage`, and makes
 * the privileged call on its behalf.
 *
 * Why `app_metadata` and not a `user_roles` table as the source of truth:
 * `app_metadata` is signed into the JWT, so RLS (`public.app_role()`) and
 * the Worker can both read it with no extra round trip, and — unlike
 * `user_metadata` — a signed-in user cannot write it. `role_assignments`
 * records history alongside it but never gates a request.
 */
export function createAdminUsers(options?: CreateAdminUsersOptions) {
  return (
    new Hono<AppEnv>()
      .get(
        '/',
        auth({ capability: 'roles:manage' }),
        rateLimit({
          guard: 'role-admin',
          window: 'minute',
          windowSeconds: 60,
          limit: ROLE_ASSIGNMENT_RATE_LIMIT.perMinute,
          keyStrategy: 'user',
          redisFactory: options?.redisFactory,
        }),
        async (c) => {
          const requestId = c.get('requestId');
          const parsedQuery = parseListQuery(c, adminUsersListQuerySchema);
          if (!parsedQuery.ok) {
            return parsedQuery.response;
          }
          const { page, pageSize, sort, dir } = parsedQuery.query;

          try {
            const supabase = createSupabaseAdmin(c.env);
            const { data, error } = await supabase.auth.admin.listUsers({
              page,
              perPage: pageSize,
            });

            if (error || !data) {
              logger.error('admin/users: listUsers failed', { requestId });
              return c.json(buildGenericErrorBody(requestId), 503);
            }

            const rawUsers = Array.isArray(data?.users) ? data.users : [];
            // A user row the Admin API returns in an unexpected shape is
            // dropped, never rendered half-parsed into an authorization UI.
            const users = rawUsers
              .map((user) => toManagedUser(user as AdminApiUser))
              .filter((user): user is ManagedUser => user !== null);

            // total stays null (decision A) — the Admin API's listUsers
            // cannot count (baseline fact 3), so hasNext is derived from
            // whether a full page came back.
            const body = paginatedResponseSchema(managedUserSchema).parse({
              items: users,
              page: buildPageMeta({
                page,
                pageSize,
                total: null,
                returned: rawUsers.length,
                sort: sort ?? null,
                dir,
              }),
              requestId,
            });
            return c.json(body, 200);
          } catch (thrown) {
            logger.error('admin/users: unexpected failure', {
              requestId,
              message: thrown instanceof Error ? thrown.message : String(thrown),
            });
            return c.json(buildGenericErrorBody(requestId), 503);
          }
        }
      )
      .patch(
        '/:id/role',
        auth({ capability: 'roles:manage' }),
        rateLimit({
          guard: 'role-admin',
          window: 'minute',
          windowSeconds: 60,
          limit: ROLE_ASSIGNMENT_RATE_LIMIT.perMinute,
          keyStrategy: 'user',
          redisFactory: options?.redisFactory,
        }),
        async (c) => {
          const requestId = c.get('requestId');
          const actor = c.get('user');
          if (!actor) {
            // auth() always sets this before next() — defensive only.
            return c.json(buildGenericErrorBody(requestId), 401);
          }

          const id = c.req.param('id');
          if (!UUID_PATTERN.test(id)) {
            return c.json(buildGenericErrorBody(requestId), 400);
          }

          const body = await c.req.json().catch(() => undefined);
          const parsed = roleAssignmentRequestSchema.safeParse(body);
          if (!parsed.success) {
            return c.json(buildGenericErrorBody(requestId), 400);
          }

          // Self-demotion lockout guard. An admin removing their own
          // `roles:manage` can leave a project with zero admins and no
          // in-app way back — the only recovery is the Supabase dashboard
          // or the bootstrap script. Refused rather than warned, because
          // by the time the warning is useful the capability is gone.
          if (id === actor.id && parsed.data.role !== 'admin') {
            logger.warn('admin/users: refused self-demotion', { requestId });
            return c.json(buildGenericErrorBody(requestId), 409);
          }

          try {
            const supabase = createSupabaseAdmin(c.env);

            // Read the current role first so the audit row records what
            // was actually replaced, rather than what the caller assumed.
            const { data: existing, error: readError } = await supabase.auth.admin.getUserById(id);
            if (readError || !existing?.user) {
              return c.json(buildGenericErrorBody(requestId), 404);
            }
            const previousRole = resolveAppRole(existing.user);

            // Merge, never replace: app_metadata carries Supabase's own
            // keys (provider, providers) and overwriting the object whole
            // would drop them.
            const existingMetadata =
              typeof existing.user?.app_metadata === 'object' && existing.user?.app_metadata !== null
                ? existing.user.app_metadata
                : {};

            const { data: updated, error: updateError } = await supabase.auth.admin.updateUserById(id, {
              app_metadata: { ...existingMetadata, role: parsed.data.role },
            });

            if (updateError || !updated?.user) {
              logger.error('admin/users: updateUserById failed', { requestId });
              return c.json(buildGenericErrorBody(requestId), 503);
            }

            // Audit write is best-effort and deliberately does NOT fail the
            // request: the grant has already taken effect in the JWT claim
            // at this point, so 503-ing here would report a false negative
            // for a change that did happen. Logged loudly instead.
            const { error: auditError } = await supabase.from('role_assignments').insert({
              user_id: id,
              previous_role: previousRole,
              new_role: parsed.data.role,
              assigned_by: actor.id,
              reason: parsed.data.reason ?? null,
            });
            if (auditError) {
              logger.error('admin/users: role changed but audit row failed to persist', {
                requestId,
                userId: id,
              });
            }

            // Same best-effort semantics for the generic audit trail,
            // deliberately isolated in its own try/catch: unlike the
            // `role_assignments` insert above, `writeAuditEntry` can throw
            // (a rejected sink promise, or a malformed entry failing
            // `auditEntrySchema.parse`), and a throw here must not turn an
            // already-effective role change into a 503.
            try {
              const sink = createAuditSink(supabase);
              const entry = buildAuditEntry({
                action: 'role.assign',
                entityType: 'user',
                entityId: id,
                actorId: actor.id,
                actorRole: actor.role,
                outcome: 'success',
                requestId,
                detail: { previousRole, newRole: parsed.data.role },
              });
              const { error: auditLogError } = await writeAuditEntry(sink, entry);
              if (auditLogError) {
                logger.error('admin/users: role changed but audit_log write failed', {
                  requestId,
                  userId: id,
                });
              }
            } catch (auditThrown) {
              logger.error('admin/users: role changed but audit_log write threw', {
                requestId,
                userId: id,
                message: auditThrown instanceof Error ? auditThrown.message : String(auditThrown),
              });
            }

            const managed = toManagedUser(updated.user as AdminApiUser);
            if (!managed) {
              logger.error('admin/users: updated user came back in an unexpected shape', { requestId });
              return c.json(buildGenericErrorBody(requestId), 503);
            }

            logger.info('admin/users: role assigned', {
              requestId,
              previousRole,
              newRole: parsed.data.role,
            });

            const responseBody = roleAssignmentResponseSchema.parse({ user: managed, requestId });
            return c.json(responseBody, 200);
          } catch (thrown) {
            logger.error('admin/users: unexpected failure', {
              requestId,
              message: thrown instanceof Error ? thrown.message : String(thrown),
            });
            return c.json(buildGenericErrorBody(requestId), 503);
          }
        }
      )
  );
}

export const adminUsers = createAdminUsers();
