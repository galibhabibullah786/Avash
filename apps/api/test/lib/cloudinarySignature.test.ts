import { describe, test, expect } from 'vitest';
import { signUpload } from '../../src/lib/cloudinarySignature';

describe('signUpload', () => {
  // Known vector — a later refactor of the signing string must not
  // silently change this hash. Computed independently with Node's
  // `crypto.createHash('sha1')` over
  // "allowed_formats=jpg,png&folder=avash/avatars/user-1&public_id=pub-1&timestamp=1700000000test-secret".
  test('matches a known (params, secret) -> hex vector', async () => {
    const signature = await signUpload(
      {
        folder: 'avash/avatars/user-1',
        publicId: 'pub-1',
        timestamp: 1700000000,
        allowedFormats: ['jpg', 'png'],
      },
      'test-secret'
    );
    expect(signature).toBe('b96c9927b17e61126dde3a02a0a23ec217d2e76e');
  });

  test('a different secret yields a different signature', async () => {
    const signature = await signUpload(
      {
        folder: 'avash/avatars/user-1',
        publicId: 'pub-1',
        timestamp: 1700000000,
        allowedFormats: ['jpg', 'png'],
      },
      'other-secret'
    );
    expect(signature).not.toBe('b96c9927b17e61126dde3a02a0a23ec217d2e76e');
  });
});
