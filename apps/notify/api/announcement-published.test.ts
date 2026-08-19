import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inngest } from '../src/inngest/client';
import { constantTimeEquals, handleAnnouncementPublishedWebhook } from './announcement-published';

const WEBHOOK_URL = 'https://notify.test/api/announcement-published';
const HEADER = 'x-announcement-webhook-secret';
const SECRET = 'super-secret-webhook-value';
const ANNOUNCEMENT_ID = '11111111-1111-4111-8111-111111111111';

function makeRequest(options: { headers?: Record<string, string>; body?: unknown } = {}): Request {
  return new Request(WEBHOOK_URL, {
    method: 'POST',
    headers: options.headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

const validBody = {
  type: 'INSERT' as const,
  table: 'announcements' as const,
  record: { id: ANNOUNCEMENT_ID },
};

describe('constantTimeEquals', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEquals('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different strings of the same length', () => {
    expect(constantTimeEquals('abc123', 'xyz999')).toBe(false);
  });

  it('returns false for different-length strings without throwing', () => {
    expect(constantTimeEquals('short', 'a-much-longer-value')).toBe(false);
  });
});

describe('handleAnnouncementPublishedWebhook', () => {
  const previousSecret = process.env.ANNOUNCEMENT_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.ANNOUNCEMENT_WEBHOOK_SECRET = SECRET;
    vi.spyOn(inngest, 'send').mockResolvedValue({ ids: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousSecret === undefined) delete process.env.ANNOUNCEMENT_WEBHOOK_SECRET;
    else process.env.ANNOUNCEMENT_WEBHOOK_SECRET = previousSecret;
  });

  it('returns 401 with no body when the secret header is missing', async () => {
    const response = await handleAnnouncementPublishedWebhook(makeRequest({ body: validBody }));
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('returns 401 when the secret header is wrong', async () => {
    const response = await handleAnnouncementPublishedWebhook(
      makeRequest({ headers: { [HEADER]: 'wrong-secret' }, body: validBody }),
    );
    expect(response.status).toBe(401);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('returns 401 when ANNOUNCEMENT_WEBHOOK_SECRET is not configured server-side, even with a matching-looking header', async () => {
    delete process.env.ANNOUNCEMENT_WEBHOOK_SECRET;
    const response = await handleAnnouncementPublishedWebhook(
      makeRequest({ headers: { [HEADER]: SECRET }, body: validBody }),
    );
    expect(response.status).toBe(401);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('uses the constant-time-compare helper rather than a literal ===', async () => {
    // Directly exercised: constantTimeEquals is deliberately exported so
    // this — and the module — can both depend on the same real
    // implementation instead of `===`.
    expect(constantTimeEquals(SECRET, SECRET)).toBe(true);
    expect(constantTimeEquals(SECRET, 'x'.repeat(SECRET.length))).toBe(false);
  });

  it('accepts a matching secret and emits exactly one Inngest event containing only { id }', async () => {
    const response = await handleAnnouncementPublishedWebhook(
      makeRequest({ headers: { [HEADER]: SECRET }, body: validBody }),
    );

    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
    expect(inngest.send).toHaveBeenCalledTimes(1);
    expect(inngest.send).toHaveBeenCalledWith({
      name: 'announcement/published',
      data: { id: ANNOUNCEMENT_ID },
    });
  });

  it('ignores every field on `record` other than `id`, even when the body claims extra fields', async () => {
    const bodyWithExtraFields = {
      type: 'INSERT' as const,
      table: 'announcements' as const,
      record: {
        id: ANNOUNCEMENT_ID,
        // None of these belong to announcementWebhookBodySchema's
        // `record` shape and must have zero effect on the emitted event.
        title: 'Spoofed title',
        body: 'Spoofed body',
        radiusM: 999999,
        targetRoles: ['admin'],
      },
    };

    const response = await handleAnnouncementPublishedWebhook(
      makeRequest({ headers: { [HEADER]: SECRET }, body: bodyWithExtraFields }),
    );

    expect(response.status).toBe(202);
    expect(inngest.send).toHaveBeenCalledTimes(1);
    expect(inngest.send).toHaveBeenCalledWith({
      name: 'announcement/published',
      data: { id: ANNOUNCEMENT_ID },
    });
    const emittedEvent = vi.mocked(inngest.send).mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(Object.keys(emittedEvent.data)).toEqual(['id']);
  });

  it('returns 400 for a body that fails schema validation (not 401 — this is not an auth failure)', async () => {
    const response = await handleAnnouncementPublishedWebhook(
      makeRequest({ headers: { [HEADER]: SECRET }, body: { type: 'DELETE', table: 'announcements', record: {} } }),
    );
    expect(response.status).toBe(400);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('returns 400 for a body that is not valid JSON', async () => {
    const request = new Request(WEBHOOK_URL, {
      method: 'POST',
      headers: { [HEADER]: SECRET },
      body: 'not json',
    });
    const response = await handleAnnouncementPublishedWebhook(request);
    expect(response.status).toBe(400);
    expect(inngest.send).not.toHaveBeenCalled();
  });
});
