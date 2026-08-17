import { describe, test, expect } from 'vitest';
import { uploadSignatureRequestSchema, uploadSignatureResponseSchema } from '../uploads';

describe('uploadSignatureRequestSchema — purpose enum (decision H)', () => {
  test('an unknown purpose is rejected', () => {
    const result = uploadSignatureRequestSchema.safeParse({ purpose: 'anything-else' });
    expect(result.success).toBe(false);
  });

  test('a valid purpose parses', () => {
    const result = uploadSignatureRequestSchema.safeParse({ purpose: 'avatar' });
    expect(result.success).toBe(true);
  });
});

describe('uploadSignatureResponseSchema', () => {
  test('a fully-shaped response parses', () => {
    const result = uploadSignatureResponseSchema.safeParse({
      uploadUrl: 'https://api.cloudinary.com/v1_1/demo/image/upload',
      cloudName: 'demo',
      apiKey: 'key-123',
      timestamp: 1700000000,
      signature: 'abc123',
      folder: 'avash/avatars/user-1',
      publicId: 'pub-1',
      allowedFormats: ['jpg', 'png'],
      maxBytes: 5_242_880,
      requestId: 'req-123',
    });
    expect(result.success).toBe(true);
  });
});
