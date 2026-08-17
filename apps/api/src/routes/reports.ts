import { Hono } from 'hono';
import {
  aiValidationSchema,
  breedingReportRequestSchema,
  breedingReportResponseSchema,
  breedingReportVerifyRequestSchema,
  SPAM_LIKELIHOOD_REJECT_THRESHOLD,
  type AiValidation,
} from '@avash/types';
import { buildGenericErrorBody, logger } from '@avash/logger';
import {
  BREEDING_REPORT_RATE_LIMIT,
  REPORT_VERIFY_RATE_LIMIT,
  isModerator,
  buildAuditEntry,
  writeAuditEntry,
  type RateLimitRedisLike,
} from '@avash/security';
import { auth } from '../middleware/auth';
import { turnstile } from '../middleware/turnstile';
import { rateLimit } from '../middleware/rate-limit';
import { createSupabaseAdmin } from '../lib/supabaseAdmin';
import { createAuditSink } from '../lib/auditSink';
import { jwtVerify } from '../lib/jwtVerify';
import { validateReportDescription } from '../lib/reportValidation';
import type { AppEnv, Bindings } from '../types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fallback `ai_validation` payload when Gemini is unavailable/quota-exhausted — always flags for manual review. */
const AI_VALIDATION_UNAVAILABLE: AiValidation = {
  isPlausible: true,
  category: 'other',
  spamLikelihood: 1,
};

function extractBearerToken(header: string | undefined): string | null {
  const [scheme, token] = header?.split(' ') ?? [];
  return scheme === 'Bearer' && token ? token : null;
}

/**
 * Best-effort reporter attribution for the anonymous-by-design create
 * route (ADR-005 — `auth` middleware is deliberately absent here). A
 * missing/invalid/expired token must never 401 this route; it only ever
 * degrades to an anonymous (`null`) report.
 */
async function extractOptionalReporterId(
  authHeader: string | undefined,
  env: Pick<Bindings, 'SUPABASE_JWT_SECRET' | 'SUPABASE_URL'>
): Promise<string | null> {
  const token = extractBearerToken(authHeader);
  if (!token) {
    return null;
  }
  const result = await jwtVerify(token, {
    secret: env?.SUPABASE_JWT_SECRET,
    supabaseUrl: env?.SUPABASE_URL,
  });
  if (!result.ok) {
    return null;
  }
  const sub = result.claims?.sub;
  return typeof sub === 'string' && sub.length > 0 ? sub : null;
}

function isFlagged(aiValidation: AiValidation | null | undefined): boolean {
  return (aiValidation?.spamLikelihood ?? 0) > SPAM_LIKELIHOOD_REJECT_THRESHOLD;
}

export interface CreateReportsOptions {
  /** Test seam — route tests inject a fake in place of a real Upstash client. */
  redisFactory?: (env: Bindings) => RateLimitRedisLike;
}

/**
 * Contract-shaped stubs (Phase 0). Middleware chains match §6: anonymous
 * reporting stays turnstile+rate-limit only (ADR-005 — auth is
 * deliberately absent here); verification is moderator-only. Real bodies
 * ship with the breeding-reports slice.
 */
export function createReports(options?: CreateReportsOptions) {
  return new Hono<AppEnv>()
    .post(
      '/breeding-site',
      turnstile(),
      rateLimit({
        guard: 'breeding-report',
        window: 'minute',
        windowSeconds: 60,
        limit: BREEDING_REPORT_RATE_LIMIT.perMinute,
        keyStrategy: 'ip',
        redisFactory: options?.redisFactory,
      }),
      rateLimit({
        guard: 'breeding-report',
        window: 'day',
        windowSeconds: 86400,
        limit: BREEDING_REPORT_RATE_LIMIT.perDay,
        keyStrategy: 'ip',
        redisFactory: options?.redisFactory,
      }),
      async (c) => {
        const requestId = c.get('requestId');
        const body = await c.req.json().catch(() => undefined);
        const parsed = breedingReportRequestSchema.safeParse(body);
        if (!parsed.success) {
          return c.json(buildGenericErrorBody(requestId), 400);
        }

        const reporterId = await extractOptionalReporterId(c.req.header('Authorization'), c.env);

        let aiValidation: AiValidation = { isPlausible: true, category: 'other', spamLikelihood: 0 };
        const description = parsed.data.description;
        if (description) {
          const result = await validateReportDescription({ apiKey: c.env.GEMINI_API_KEY, description });
          if (result.ok) {
            aiValidation = result.data;
          } else {
            logger.error('reports/breeding-site: Gemini validation unavailable, flagging for manual review', {
              requestId,
              reason: result.reason,
            });
            aiValidation = AI_VALIDATION_UNAVAILABLE;
          }
        }

        try {
          const supabase = createSupabaseAdmin(c.env);
          const { data, error } = await supabase
            .from('breeding_reports')
            .insert({
              reporter_id: reporterId,
              geom: { type: 'Point', coordinates: [parsed.data.lng, parsed.data.lat] },
              description: description ?? null,
              photo_url: parsed.data.photoUrl ?? null,
              ai_validation: aiValidationSchema.parse(aiValidation),
            })
            .select('id, status')
            .single();

          if (error || !data) {
            logger.error('reports/breeding-site: Supabase insert failed', { requestId });
            return c.json(buildGenericErrorBody(requestId), 503);
          }

          const flagged = isFlagged(aiValidation);

          // Audit write is best-effort and isolated so a sink failure —
          // thrown or returned — never turns a row that was already
          // written into a 503. Flagged submissions are recorded as
          // `outcome: 'failure'` even though the row is still stored: the
          // audit trail tracks the spam-rejection signal, not row
          // existence (baseline fact — spam is flagged, not deleted).
          try {
            const sink = createAuditSink(supabase);
            const entry = buildAuditEntry({
              action: 'report.submit',
              entityType: 'breeding_report',
              entityId: String(data.id),
              actorId: reporterId,
              actorRole: null,
              outcome: flagged ? 'failure' : 'success',
              requestId,
              detail: {
                category: aiValidation.category,
                spamLikelihood: aiValidation.spamLikelihood,
              },
            });
            const { error: auditLogError } = await writeAuditEntry(sink, entry);
            if (auditLogError) {
              logger.error('reports/breeding-site: submitted but audit_log write failed', { requestId });
            }
          } catch (auditThrown) {
            logger.error('reports/breeding-site: submitted but audit_log write threw', {
              requestId,
              message: auditThrown instanceof Error ? auditThrown.message : String(auditThrown),
            });
          }

          const responseBody = breedingReportResponseSchema.parse({
            id: data.id,
            status: data.status,
            flaggedForReview: flagged,
            requestId,
          });
          return c.json(responseBody, 201);
        } catch (thrown) {
          logger.error('reports/breeding-site: unexpected failure', {
            requestId,
            message: thrown instanceof Error ? thrown.message : String(thrown),
          });
          return c.json(buildGenericErrorBody(requestId), 503);
        }
      }
    )
    .patch(
      '/breeding-site/:id/verify',
      auth({ capability: 'reports:moderate' }),
      rateLimit({
        guard: 'report-verify',
        window: 'minute',
        windowSeconds: 60,
        limit: REPORT_VERIFY_RATE_LIMIT.perMinute,
        keyStrategy: 'user',
        redisFactory: options?.redisFactory,
      }),
      async (c) => {
        const requestId = c.get('requestId');

        // Defense in depth (intentional, not dead code) — the `auth({
        // capability: 'reports:moderate' })` middleware above already gates
        // this, but the handler re-checks so a future middleware refactor
        // can't silently reopen this route.
        const user = c.get('user');
        if (!user || !isModerator(user.role)) {
          return c.json(buildGenericErrorBody(requestId), 403);
        }

        const id = c.req.param('id');
        if (!UUID_PATTERN.test(id)) {
          return c.json(buildGenericErrorBody(requestId), 400);
        }
        const body = await c.req.json().catch(() => undefined);
        const parsed = breedingReportVerifyRequestSchema.safeParse(body);
        if (!parsed.success) {
          return c.json(buildGenericErrorBody(requestId), 400);
        }

        try {
          const supabase = createSupabaseAdmin(c.env);
          const { data, error } = await supabase
            .from('breeding_reports')
            .update({
              status: parsed.data.status,
              verified_by: user.id,
              ...(parsed.data.municipalRefId !== undefined ? { municipal_ref_id: parsed.data.municipalRefId } : {}),
            })
            .eq('id', id)
            .select('id, status, ai_validation')
            .maybeSingle();

          if (error) {
            logger.error('reports/breeding-site/verify: Supabase update failed', { requestId });
            return c.json(buildGenericErrorBody(requestId), 503);
          }
          if (!data) {
            return c.json(buildGenericErrorBody(requestId), 404);
          }

          // Best-effort, isolated (see the POST handler above for why).
          try {
            const sink = createAuditSink(supabase);
            const entry = buildAuditEntry({
              action: 'report.verify',
              entityType: 'breeding_report',
              entityId: String(data.id),
              actorId: user.id,
              actorRole: user.role,
              outcome: 'success',
              requestId,
              detail: { status: parsed.data.status },
            });
            const { error: auditLogError } = await writeAuditEntry(sink, entry);
            if (auditLogError) {
              logger.error('reports/breeding-site/verify: verified but audit_log write failed', { requestId });
            }
          } catch (auditThrown) {
            logger.error('reports/breeding-site/verify: verified but audit_log write threw', {
              requestId,
              message: auditThrown instanceof Error ? auditThrown.message : String(auditThrown),
            });
          }

          const responseBody = breedingReportResponseSchema.parse({
            id: data.id,
            status: data.status,
            flaggedForReview: isFlagged(data.ai_validation as AiValidation | null),
            requestId,
          });
          return c.json(responseBody, 200);
        } catch (thrown) {
          logger.error('reports/breeding-site/verify: unexpected failure', {
            requestId,
            message: thrown instanceof Error ? thrown.message : String(thrown),
          });
          return c.json(buildGenericErrorBody(requestId), 503);
        }
      }
    );
}

export const reports = createReports();
