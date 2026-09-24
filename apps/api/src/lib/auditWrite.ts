import type { Context } from 'hono';
import { logger } from '@avash/logger';
import { buildAuditEntry, writeAuditEntry, type BuildAuditEntryOptions } from '@avash/security';
import { createSupabaseAdmin } from './supabaseAdmin';
import { createAuditSink } from './auditSink';
import type { AppEnv } from '../types';

/**
 * The create-admin → create-sink → `buildAuditEntry` → `writeAuditEntry`
 * → isolated-try/catch sequence `uploads.ts:103-125` open-codes, factored
 * for new call sites (decision D). Best-effort by design: the write this
 * audits has already taken effect by the time a route reaches this, so a
 * sink failure — a returned `{ error }` or a thrown rejection — is logged
 * and never propagated. Existing call sites (`report.submit`,
 * `report.verify`, `blood.update`, `role.assign`, `upload.sign`) are not
 * refactored onto this helper; only new call sites use it.
 */
export async function recordAudit(c: Context<AppEnv>, entry: BuildAuditEntryOptions): Promise<void> {
  const requestId = c.get('requestId');
  try {
    const supabase = createSupabaseAdmin(c.env);
    const sink = createAuditSink(supabase);
    const built = buildAuditEntry(entry);
    const { error } = await writeAuditEntry(sink, built);
    if (error) {
      logger.error('auditWrite: audit_log write failed', { requestId, action: entry.action });
    }
  } catch (thrown) {
    logger.error('auditWrite: audit_log write threw', {
      requestId,
      action: entry.action,
      message: thrown instanceof Error ? thrown.message : String(thrown),
    });
  }
}
