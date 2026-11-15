import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateReportPhoto,
  uploadReportPhoto,
  type UploadReportPhotoInput,
} from './useUploadReportPhoto';
import { REPORT_PHOTO_MAX_BYTES } from '@avash/types';

function makeFile(name: string, sizeBytes: number, type: string = 'image/png'): File {
  const bytes = new Uint8Array(sizeBytes);
  return new File([bytes], name, { type });
}

describe('useUploadReportPhoto / uploadReportPhoto (Supabase Storage)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('an oversized file is rejected before any network call', async () => {
    const oversized = makeFile('huge.png', REPORT_PHOTO_MAX_BYTES + 1, 'image/png');
    const input: UploadReportPhotoInput = { file: oversized };

    expect(validateReportPhoto(oversized)).toMatch(/too large/i);
    await expect(uploadReportPhoto(input)).rejects.toThrow(/too large/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('an unsupported mime type is rejected before any network call', async () => {
    const badFile = makeFile('script.sh', 100, 'text/plain');
    const input: UploadReportPhotoInput = { file: badFile };

    expect(validateReportPhoto(badFile)).toMatch(/unsupported/i);
    await expect(uploadReportPhoto(input)).rejects.toThrow(/unsupported/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a successful upload returns the photoUrl from Supabase bucket response', async () => {
    const file = makeFile('sample.png', 1024, 'image/png');
    const expectedUrl = 'https://supabase.local/storage/v1/object/public/breeding-report-photos/test.png';

    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ photoUrl: expectedUrl, requestId: 'req-123' }),
    });

    const result = await uploadReportPhoto({ file, accessToken: 'token-xyz' });
    expect(result.photoUrl).toBe(expectedUrl);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/reports/photo'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-xyz',
        }),
      })
    );
  });

  test('a non-200 server response rejects with a user-friendly error message', async () => {
    const file = makeFile('sample.png', 1024, 'image/png');

    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: 'Service unavailable' } }),
    });

    await expect(uploadReportPhoto({ file })).rejects.toThrow(/unable to upload photo/i);
  });
});
