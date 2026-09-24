import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/env', () => ({ env: { apiBaseUrl: 'https://api.example.test' } }));

const validSignature = {
  uploadUrl: 'https://api.cloudinary.com/v1_1/demo/image/upload',
  cloudName: 'demo',
  apiKey: 'key-123',
  timestamp: 1_700_000_000,
  signature: 'deadbeef',
  folder: 'avash/reports',
  publicId: 'report-abc',
  allowedFormats: ['jpg', 'jpeg', 'png', 'webp'],
  maxBytes: 5_242_880,
  requestId: 'req-1',
};

function makeFile(name: string, sizeBytes: number, type = 'image/png'): File {
  const buffer = new Uint8Array(sizeBytes);
  return new File([buffer], name, { type });
}

describe('useSignedUpload / signedUpload (B-T08)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('an oversized file is rejected before any network call', async () => {
    global.fetch = vi.fn();
    const { signedUpload } = await import('./useSignedUpload');

    const oversized = makeFile('big.png', 6 * 1024 * 1024);

    await expect(signedUpload({ file: oversized, purpose: 'report-photo', accessToken: 'tok' })).rejects.toThrow(
      /too large/i
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('an unsupported file extension is rejected before any network call', async () => {
    global.fetch = vi.fn();
    const { signedUpload } = await import('./useSignedUpload');

    const badExtension = makeFile('report.gif', 1024, 'image/gif');

    await expect(signedUpload({ file: badExtension, purpose: 'report-photo', accessToken: 'tok' })).rejects.toThrow(
      /unsupported/i
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a signature request failure surfaces an error without throwing past the mutation boundary', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const { signedUpload } = await import('./useSignedUpload');

    const file = makeFile('photo.png', 1024);

    await expect(signedUpload({ file, purpose: 'report-photo', accessToken: 'tok' })).rejects.toThrow(
      /request failed/i
    );
  });

  test('a Cloudinary response missing secure_url yields an error rather than undefined', async () => {
    global.fetch = vi
      .fn()
      // signature request
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => validSignature })
      // Cloudinary upload — no secure_url in the body
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ public_id: 'report-abc' }) });

    const { signedUpload } = await import('./useSignedUpload');
    const file = makeFile('photo.png', 1024);

    await expect(signedUpload({ file, purpose: 'report-photo', accessToken: 'tok' })).rejects.toThrow(
      /unexpected response/i
    );
  });

  test('a full round trip resolves with the secure URL and public ID', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => validSignature })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/x.png', public_id: 'report-abc' }),
      });

    const { signedUpload } = await import('./useSignedUpload');
    const file = makeFile('photo.png', 1024);

    const result = await signedUpload({ file, purpose: 'report-photo', accessToken: 'tok' });

    expect(result).toEqual({ secureUrl: 'https://res.cloudinary.com/demo/x.png', publicId: 'report-abc' });
  });

  test('the Cloudinary FormData carries every parameter the server signed, including allowed_formats', async () => {
    let capturedBody: FormData | undefined;
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => validSignature })
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body as FormData;
        return {
          ok: true,
          status: 200,
          json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/x.png', public_id: 'report-abc' }),
        };
      });

    const { signedUpload } = await import('./useSignedUpload');
    const file = makeFile('photo.png', 1024);
    await signedUpload({ file, purpose: 'report-photo', accessToken: 'tok' });

    expect(capturedBody).toBeInstanceOf(FormData);
    // A signature computed over a param the request never sends is a
    // signature Cloudinary can never verify — every field cloudinarySignature.ts
    // signs must be present here, byte for byte.
    expect(capturedBody?.get('timestamp')).toBe(String(validSignature.timestamp));
    expect(capturedBody?.get('signature')).toBe(validSignature.signature);
    expect(capturedBody?.get('folder')).toBe(validSignature.folder);
    expect(capturedBody?.get('public_id')).toBe(validSignature.publicId);
    expect(capturedBody?.get('allowed_formats')).toBe(validSignature.allowedFormats.join(','));
  });
});
