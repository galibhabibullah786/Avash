import { Hono } from 'hono';
import {
  aiValidationSchema,
  breedingReportRequestSchema,
  breedingReportResponseSchema,
  type AiValidation,
} from '@avash/types';
import { buildGenericErrorBody, logger } from '@avash/logger';
import {
  BREEDING_REPORT_RATE_LIMIT,
  REPORT_PHOTO_UPLOAD_RATE_LIMIT,
  REPORT_VERIFY_RATE_LIMIT,
  buildAuditEntry,
  writeAuditEntry,
  type RateLimitRedisLike,
} from '@avash/security';
import { auth } from '../middleware/auth';
import { turnstile } from '../middleware/turnstile';
import { rateLimit } from '../middleware/rate-limit';
import { createSupabaseAdmin } from '../lib/supabaseAdmin';
import { createAuditSink } from '../lib/auditSink';
import { validateReportDescription } from '../lib/reportValidation';
import {
  AI_VALIDATION_UNAVAILABLE,
  extractOptionalReporterId,
  isFlagged,
  handleReportPhotoUpload,
  handleReportsList,
  handleReportVerify,
} from '../lib/reportsService';
import type { AppEnv, Bindings } from '../types';

export interface CreateReportsOptions {
  /** Test seam — route tests inject a fake in place of a real Upstash client. */
  redisFactory?: (env: Bindings) => RateLimitRedisLike;
}

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
    .post(
      '/photo',
      rateLimit({
        guard: 'breeding-report-photo',
        window: 'minute',
        windowSeconds: 60,
        limit: REPORT_PHOTO_UPLOAD_RATE_LIMIT.perMinute,
        keyStrategy: 'ip',
        redisFactory: options?.redisFactory,
      }),
      async (c) => handleReportPhotoUpload(c)
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
      async (c) => handleReportVerify(c)
    )
    .get(
      '/',
      rateLimit({
        guard: 'breeding-report',
        window: 'minute',
        windowSeconds: 60,
        limit: BREEDING_REPORT_RATE_LIMIT.perMinute,
        keyStrategy: 'ip',
        redisFactory: options?.redisFactory,
      }),
      async (c) => handleReportsList(c)
    );
}

export const reports = createReports();
