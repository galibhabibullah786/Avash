import type { AuditAction, AuditEntry } from '@avash/types';
import { auditEntrySchema } from '@avash/types';

/**
 * The injection seam: this package must not gain a `supabase-js`
 * dependency, so the writer takes a structural sink rather than a real
 * client. `apps/api/src/lib/auditSink.ts` adapts the service-role Supabase
 * client to this shape; tests pass a fake.
 */
export interface AuditSink {
  insert(row: Record<string, unknown>): Promise<{ error: unknown }>;
}

export interface BuildAuditEntryOptions {
  action: AuditAction;
  entityType: AuditEntry['entityType'];
  entityId: string | null;
  actorId: string | null;
  actorRole: AuditEntry['actorRole'];
  outcome: AuditEntry['outcome'];
  requestId: string;
  detail?: AuditEntry['detail'];
}

/** Pure — validates and shapes an entry without touching any sink. */
export function buildAuditEntry(options: BuildAuditEntryOptions): AuditEntry {
  return auditEntrySchema.parse({
    action: options.action,
    entityType: options.entityType,
    entityId: options.entityId,
    actorId: options.actorId,
    actorRole: options.actorRole,
    outcome: options.outcome,
    requestId: options.requestId,
    detail: options.detail ?? null,
  });
}

/**
 * Best-effort by design: a write already took effect by the time most call
 * sites reach this, so a sink failure is logged by the caller (which holds
 * the logger) and must never fail the request. This function surfaces the
 * sink's error rather than swallowing it, so the caller decides how loud to
 * be.
 */
export async function writeAuditEntry(sink: AuditSink, entry: AuditEntry): Promise<{ error: unknown }> {
  return sink.insert({
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    actor_id: entry.actorId,
    actor_role: entry.actorRole,
    outcome: entry.outcome,
    request_id: entry.requestId,
    detail: entry.detail,
  });
}
