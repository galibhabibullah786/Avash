import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/env', () => ({ env: { apiBaseUrl: 'https://api.example.test' } }));

const ID = '123e4567-e89b-42d3-a456-426614174000';

describe('deleteAnnouncement', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('sends DELETE to the row URL with the caller Bearer token', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    global.fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return Promise.resolve({ ok: true, status: 204, json: async () => null } as unknown as Response);
    });

    const { deleteAnnouncement } = await import('./useDeleteAnnouncement');
    await deleteAnnouncement({ id: ID, accessToken: 'token-1' });

    expect(capturedUrl).toBe(`https://api.example.test/api/announcements/${ID}`);
    expect(capturedInit?.method).toBe('DELETE');
    expect((capturedInit?.headers as Record<string, string>)?.Authorization).toBe('Bearer token-1');
  });

  test('percent-encodes the id rather than interpolating it into the path raw', async () => {
    let capturedUrl: string | undefined;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({ ok: true, status: 204, json: async () => null } as unknown as Response);
    });

    const { deleteAnnouncement } = await import('./useDeleteAnnouncement');
    await deleteAnnouncement({ id: '../../admin/users', accessToken: 'token-1' });

    expect(capturedUrl).toBe('https://api.example.test/api/announcements/..%2F..%2Fadmin%2Fusers');
  });

  test('a 204 with an empty body resolves rather than failing schema validation', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 204, json: async () => null } as unknown as Response);
    const { deleteAnnouncement } = await import('./useDeleteAnnouncement');
    await expect(deleteAnnouncement({ id: ID, accessToken: 'token-1' })).resolves.toBeUndefined();
  });

  test('a 403 (not the author, not an admin) rejects with the sign-in-required message', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) } as Response);
    const { deleteAnnouncement } = await import('./useDeleteAnnouncement');
    await expect(deleteAnnouncement({ id: ID, accessToken: 'token-1' })).rejects.toThrow('Sign-in required');
  });

  test('rejects with a generic error on a transport failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const { deleteAnnouncement } = await import('./useDeleteAnnouncement');
    await expect(deleteAnnouncement({ id: ID, accessToken: 'token-1' })).rejects.toThrow(
      'Unable to reach the server'
    );
  });
});
