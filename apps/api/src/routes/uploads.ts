import { Hono } from 'hono';
import {
  uploadSignatureRequestSchema,
  uploadSignatureResponseSchema,
  UPLOAD_MAX_BYTES,
  UPLOAD_ALLOWED_FORMATS,
} from '@avash/types';
import { buildGenericErrorBody, logger } from '@avash/logger';
import {
  UPLOAD_SIGNATURE_RATE_LIMIT,
  REPORT_PHOTO_UPLOAD_RATE_LIMIT,
  buildAuditEntry,
  writeAuditEntry,
  checkRateLimit,
  rateLimitKey,
  type RateLimitRedisLike,
} from '@avash/security';
import { Redis } from '@upstash/redis';
import { auth } from '../middleware/auth';
import { createSupabaseAdmin } from '../lib/supabaseAdmin';
import { createAuditSink } from '../lib/auditSink';
import { signUpload } from '../lib/cloudinarySignature';
import type { AppEnv, Bindings } from '../types';

export interface CreateUploadsOptions {
  /** Test seam — route tests inject a fake in place of a real Upstash client. */
  redisFactory?: (env: Bindings) => RateLimitRedisLike;
}

/**
 * The client names a PURPOSE, never a path (decision H) — the folder below
 * is derived server-side and a client-supplied `folder` field in the
 * request body, if present, is ignored entirely.
 */
function folderForPurpose(purpose: 'avatar' | 'report-photo', userId: string): string {
  return purpose === 'avatar' ? `avash/avatars/${userId}` : 'avash/reports';
}

const defaultRedisFactory = (env: Bindings): RateLimitRedisLike =>
  new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });

/**
 * Signed direct-to-Cloudinary uploads (decision G, ADR-015). Every
 * signed-in role may mint a signature — no `capability` is required —
 * followed by a per-user rate limit (`UPLOAD_SIGNATURE_RATE_LIMIT`). The
 * Worker never sees the file bytes; it only signs the parameters the
 * browser then POSTs straight to Cloudinary.
 */
export function createUploads(options?: CreateUploadsOptions) {
  return new Hono<AppEnv>().post(
    '/',
    auth(),
    async (c) => {
      const requestId = c.get('requestId');
      const user = c.get('user');
      
      if (!user) {
        return c.json(buildGenericErrorBody(requestId), 401);
      }

      const body = await c.req.json().catch(() => undefined);
      const parsed = uploadSignatureRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(buildGenericErrorBody(requestId), 400);
      }

      // Rate limit logic
      if (c.env.UPSTASH_REDIS_REST_URL && c.env.UPSTASH_REDIS_REST_TOKEN) {
        const redis = (options?.redisFactory ?? defaultRedisFactory)(c.env);
        const guard = parsed.data.purpose === 'report-photo' ? 'report-photo-upload' : 'upload-signature';
        const limitConfig = parsed.data.purpose === 'report-photo' ? REPORT_PHOTO_UPLOAD_RATE_LIMIT : UPLOAD_SIGNATURE_RATE_LIMIT;
        const actor = user.id;
        const key = rateLimitKey(guard, 'minute', actor);

        try {
          const result = await checkRateLimit(redis, { key, limit: limitConfig.perMinute, windowSeconds: 60 });
          if (!result.ok || !result.allowed) {
            if (result.ok && !result.allowed) c.header('Retry-After', '60');
            logger.error('uploads: rate limit exceeded or unreachable', { requestId, guard });
            return c.json(buildGenericErrorBody(requestId), 429);
          }
        } catch {
          return c.json(buildGenericErrorBody(requestId), 429);
        }
      }

      try {
        const folder = folderForPurpose(parsed.data.purpose, user.id);
        const publicId = crypto.randomUUID();
        const timestamp = Math.floor(Date.now() / 1000);

        const signature = await signUpload(
          {
            folder,
            publicId,
            timestamp,
            allowedFormats: UPLOAD_ALLOWED_FORMATS,
          },
          c.env.CLOUDINARY_API_SECRET
        );

        const responseBody = uploadSignatureResponseSchema.parse({
          uploadUrl: `https://api.cloudinary.com/v1_1/${c.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
          cloudName: c.env.CLOUDINARY_CLOUD_NAME,
          apiKey: c.env.CLOUDINARY_API_KEY,
          timestamp,
          signature,
          folder,
          publicId,
          allowedFormats: [...UPLOAD_ALLOWED_FORMATS],
          maxBytes: UPLOAD_MAX_BYTES,
          requestId,
        });

        // Audit write is best-effort and deliberately isolated in its own
        // try/catch: the signature has already been minted by this point,
        // so a sink failure — including a thrown rejection, not just a
        // returned `{ error }` — must never turn a successful mint into a
        // 503 (mirrors admin-users.ts's role-assignment audit write).
        try {
          const supabase = createSupabaseAdmin(c.env);
          const sink = createAuditSink(supabase);
          const entry = buildAuditEntry({
            action: 'upload.sign',
            entityType: 'upload',
            entityId: publicId,
            actorId: user.id,
            actorRole: user.role,
            outcome: 'success',
            requestId,
            detail: { purpose: parsed.data.purpose, folder },
          });
          const { error: auditError } = await writeAuditEntry(sink, entry);
          if (auditError) {
            logger.error('uploads: signature minted but audit_log write failed', { requestId });
          }
        } catch (auditThrown) {
          logger.error('uploads: signature minted but audit_log write threw', {
            requestId,
            message: auditThrown instanceof Error ? auditThrown.message : String(auditThrown),
          });
        }

        return c.json(responseBody, 200);
      } catch (thrown) {
        logger.error('uploads: unexpected failure', {
          requestId,
          message: thrown instanceof Error ? thrown.message : String(thrown),
        });
        return c.json(buildGenericErrorBody(requestId), 503);
      }
    }
  );
}

export const uploads = createUploads();
