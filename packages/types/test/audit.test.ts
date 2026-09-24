import { describe, test, expect } from 'vitest';
import { auditEntrySchema, auditDetailSchema, AUDIT_DETAIL_MAX_KEYS } from '../audit';

const baseEntry = {
  action: 'role.assign' as const,
  entityType: 'user' as const,
  entityId: 'user-123',
  actorId: '11111111-1111-4111-8111-111111111111',
  actorRole: 'admin' as const,
  outcome: 'success' as const,
  requestId: 'req-123',
};

describe('auditEntrySchema — detail shape (decision C)', () => {
  test('a nested value fails to parse', () => {
    const result = auditEntrySchema.safeParse({
      ...baseEntry,
      detail: { nested: { a: 1 } },
    });
    expect(result.success).toBe(false);
  });

  test('a 13-key detail map fails to parse', () => {
    const detail = Object.fromEntries(
      Array.from({ length: AUDIT_DETAIL_MAX_KEYS + 1 }, (_, i) => [`k${i}`, i]),
    );
    const result = auditDetailSchema.safeParse(detail);
    expect(result.success).toBe(false);
  });

  test('a scalar-only, within-cap detail map parses', () => {
    const result = auditEntrySchema.safeParse({
      ...baseEntry,
      detail: { previousRole: 'citizen', newRole: 'moderator' },
    });
    expect(result.success).toBe(true);
  });

  test('a null detail parses', () => {
    const result = auditEntrySchema.safeParse({ ...baseEntry, detail: null });
    expect(result.success).toBe(true);
  });
});
