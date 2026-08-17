import { describe, test, expect, vi } from 'vitest';
import { buildAuditEntry, writeAuditEntry, type AuditSink } from '../auditLog';

function baseOptions() {
  return {
    action: 'role.assign' as const,
    entityType: 'user' as const,
    entityId: 'user-123',
    actorId: '11111111-1111-4111-8111-111111111111',
    actorRole: 'admin' as const,
    outcome: 'success' as const,
    requestId: 'req-123',
    detail: { previousRole: 'citizen', newRole: 'moderator' },
  };
}

describe('buildAuditEntry', () => {
  test('produces a valid AuditEntry from well-formed options', () => {
    const entry = buildAuditEntry(baseOptions());
    expect(entry).toMatchObject({
      action: 'role.assign',
      entityType: 'user',
      outcome: 'success',
      detail: { previousRole: 'citizen', newRole: 'moderator' },
    });
  });

  test('a missing detail defaults to null', () => {
    const { detail: _detail, ...rest } = baseOptions();
    const entry = buildAuditEntry(rest);
    expect(entry.detail).toBeNull();
  });

  test('throws on an invalid shape (e.g. a nested detail)', () => {
    expect(() =>
      buildAuditEntry({ ...baseOptions(), detail: { nested: { a: 1 } } as never })
    ).toThrow();
  });
});

describe('writeAuditEntry', () => {
  test('maps the entry onto the sink row shape', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const sink: AuditSink = { insert };
    const entry = buildAuditEntry(baseOptions());

    await writeAuditEntry(sink, entry);

    expect(insert).toHaveBeenCalledWith({
      action: 'role.assign',
      entity_type: 'user',
      entity_id: 'user-123',
      actor_id: '11111111-1111-4111-8111-111111111111',
      actor_role: 'admin',
      outcome: 'success',
      request_id: 'req-123',
      detail: { previousRole: 'citizen', newRole: 'moderator' },
    });
  });

  test('surfaces a sink error rather than throwing', async () => {
    const insert = vi.fn().mockResolvedValue({ error: 'boom' });
    const sink: AuditSink = { insert };
    const entry = buildAuditEntry(baseOptions());

    const result = await writeAuditEntry(sink, entry);
    expect(result.error).toBe('boom');
  });
});
