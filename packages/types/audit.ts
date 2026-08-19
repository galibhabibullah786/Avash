import { z } from 'zod';
import { appRoleSchema } from './api';

/** `AUDIT_DETAIL_MAX_KEYS` (§14) — caps the audit detail map (decision C). */
export const AUDIT_DETAIL_MAX_KEYS = 12;

/**
 * Every auditable action, one per write path that exists today. A later
 * slice adding a write path extends this enum in ITS Phase 0 — never
 * inline at a call site.
 */
export const auditActionSchema = z.enum([
  'role.assign',
  'report.submit',
  'report.verify',
  'blood.update',
  'upload.sign',
  'alert.subscribe',
  'alert.unsubscribe',
  'push.subscribe',
  'announcement.create',
  'announcement.delete',
  'auth.signout',
]);

export const auditEntityTypeSchema = z.enum([
  'user',
  'breeding_report',
  'blood_inventory',
  'upload',
  'alert_subscription',
  'push_subscription',
  'announcement',
]);

export const auditOutcomeSchema = z.enum(['success', 'failure']);

/**
 * Scalars only, one level deep, key-capped (decision C). An unconstrained
 * jsonb audit payload is where PII and secrets end up — someone dumps a
 * whole request body "for debugging" and it is permanently in an
 * append-only table. Flattening nested context into dotted keys is the
 * intended friction.
 */
export const auditDetailSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .refine((d) => Object.keys(d ?? {}).length <= AUDIT_DETAIL_MAX_KEYS, {
    message: 'too many detail keys',
  });

export const auditEntrySchema = z.object({
  action: auditActionSchema,
  entityType: auditEntityTypeSchema,
  entityId: z.string().max(64).nullable(),
  actorId: z.string().uuid().nullable(),
  actorRole: appRoleSchema.nullable(),
  outcome: auditOutcomeSchema,
  requestId: z.string(),
  detail: auditDetailSchema.nullable(),
});

export type AuditAction = z.infer<typeof auditActionSchema>;
export type AuditEntry = z.infer<typeof auditEntrySchema>;
