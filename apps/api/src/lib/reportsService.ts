import type { Context } from 'hono';
import {
  breedingReportVerifyRequestSchema,
  breedingReportResponseSchema,
  REPORT_PHOTO_ALLOWED_MIME_TYPES,
  REPORT_PHOTO_MAX_BYTES,
  REPORT_PHOTO_STORAGE_BUCKET,
  SPAM_LIKELIHOOD_REJECT_THRESHOLD,
  type AiValidation,
} from '@avash/types';
import { buildGenericErrorBody, logger } from '@avash/logger';
import { isModerator, buildAuditEntry, writeAuditEntry } from '@avash/security';
import { createSupabaseAdmin } from './supabaseAdmin';
import { createAuditSink } from './auditSink';
import { jwtVerify } from './jwtVerify';
import type { AppEnv, Bindings } from '../types';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fallback `ai_validation` payload when Gemini is unavailable/quota-exhausted — always flags for manual review. */
export const AI_VALIDATION_UNAVAILABLE: AiValidation = {
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
 * route (ADR-005 — `auth` middleware is deliberately absent here).
 */
export async function extractOptionalReporterId(
  authHeader: string | undefined,
  env: Pick<Bindings, 'SUPABASE_JWT_SECRET' | 'SUPABASE_URL'>
): Promise<string | null> {
  const token = extractBearerToken(authHeader);
  if (!token) return null;
  const result = await jwtVerify(token, {
    secret: env?.SUPABASE_JWT_SECRET,
    supabaseUrl: env?.SUPABASE_URL,
  });
  if (!result.ok) return null;
  const sub = result.claims?.sub;
  return typeof sub === 'string' && sub.length > 0 ? sub : null;
}

export function isFlagged(aiValidation: AiValidation | null | undefined): boolean {
  return (aiValidation?.spamLikelihood ?? 0) > SPAM_LIKELIHOOD_REJECT_THRESHOLD;
}

export async function handleReportPhotoUpload(c: Context<AppEnv>): Promise<Response> {
  const requestId = c.get('requestId');
  try {
    const formData = await c.req.formData().catch(() => null);
    const file = formData?.get('file');
    if (!file || typeof file === 'string' || !(file instanceof File)) {
      return c.json(buildGenericErrorBody(requestId), 400);
    }

    const mime = file.type as (typeof REPORT_PHOTO_ALLOWED_MIME_TYPES)[number];
    if (!REPORT_PHOTO_ALLOWED_MIME_TYPES.includes(mime)) {
      return c.json(buildGenericErrorBody(requestId), 400);
    }

    if (file.size > REPORT_PHOTO_MAX_BYTES) {
      return c.json(buildGenericErrorBody(requestId), 400);
    }

    const supabase = createSupabaseAdmin(c.env);
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${crypto.randomUUID()}-${safeName}`;

    const { error } = await supabase.storage
      .from(REPORT_PHOTO_STORAGE_BUCKET)
      .upload(fileName, file, { contentType: file.type });

    if (error) {
      logger.error('reports/photo: storage upload failed', { requestId });
      return c.json(buildGenericErrorBody(requestId), 503);
    }

    const { data: urlData } = supabase.storage
      .from(REPORT_PHOTO_STORAGE_BUCKET)
      .getPublicUrl(fileName);

    return c.json({ photoUrl: urlData.publicUrl, requestId }, 201);
  } catch (thrown) {
    logger.error('reports/photo: unexpected failure', {
      requestId,
      message: thrown instanceof Error ? thrown.message : String(thrown),
    });
    return c.json(buildGenericErrorBody(requestId), 503);
  }
}

export async function handleReportsList(c: Context<AppEnv>): Promise<Response> {
  const requestId = c.get('requestId');

  const latStr = c.req.query('lat');
  const lngStr = c.req.query('lng');
  const lat = latStr !== undefined && latStr !== '' ? Number(latStr) : null;
  const lng = lngStr !== undefined && lngStr !== '' ? Number(lngStr) : null;
  const hasCoords = lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng);

  try {
    const supabase = createSupabaseAdmin(c.env);
    const { data, error } = await supabase
      .from('breeding_reports')
      .select('id, description, photo_url, status, created_at, geom')
      .in('status', ['verified', 'resolved'])
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      logger.error('reports/list: Supabase select failed', { requestId });
      return c.json(buildGenericErrorBody(requestId), 503);
    }

    const items = (data ?? [])
      .map((row) => {
        const geom = row.geom as { coordinates?: number[] };
        const pointLat = geom?.coordinates?.[1] ?? 0;
        const pointLng = geom?.coordinates?.[0] ?? 0;
        let dist = 0;
        if (hasCoords) {
          const dLat = pointLat - (lat as number);
          const dLng = pointLng - (lng as number);
          dist = Math.sqrt(dLat * dLat + dLng * dLng);
        }
        return {
          id: row.id,
          description: row.description,
          photoUrl: row.photo_url,
          status: row.status,
          createdAt: row.created_at,
          lat: pointLat,
          lng: pointLng,
          distance: dist,
        };
      })
      .filter((r) => !hasCoords || r.distance < 0.1);

    if (hasCoords) {
      items.sort((a, b) => a.distance - b.distance);
    }

    return c.json({ items, requestId }, 200);
  } catch (thrown) {
    logger.error('reports/list: unexpected failure', {
      requestId,
      message: thrown instanceof Error ? thrown.message : String(thrown),
    });
    return c.json(buildGenericErrorBody(requestId), 503);
  }
}

export async function handleReportVerify(c: Context<AppEnv>) {
  const requestId = c.get('requestId');

  const user = c.get('user');
  if (!user || !isModerator(user.role)) {
    return c.json(buildGenericErrorBody(requestId), 403);
  }

  const id = c.req.param('id');
  if (!id || !UUID_PATTERN.test(id)) {
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
