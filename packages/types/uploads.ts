import { z } from 'zod';

/** `UPLOAD_MAX_BYTES` (§14) — 5 MiB. */
export const UPLOAD_MAX_BYTES = 5_242_880;
export const UPLOAD_ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp'] as const;

/**
 * The client names a PURPOSE, never a path (decision H). A client-supplied
 * folder is a write-anywhere primitive against your own asset store.
 */
export const uploadPurposeSchema = z.enum(['avatar', 'report-photo']);

export const uploadSignatureRequestSchema = z.object({
  purpose: uploadPurposeSchema,
  /** Advisory only — the server re-derives the extension from allowed formats. */
  contentType: z.string().max(100).optional(),
});

export const uploadSignatureResponseSchema = z.object({
  uploadUrl: z.string().url(),
  cloudName: z.string(),
  apiKey: z.string(),
  timestamp: z.number().int(),
  signature: z.string(),
  folder: z.string(),
  publicId: z.string(),
  allowedFormats: z.array(z.string()),
  maxBytes: z.number().int(),
  requestId: z.string(),
});

export type UploadPurpose = z.infer<typeof uploadPurposeSchema>;
export type UploadSignatureRequest = z.infer<typeof uploadSignatureRequestSchema>;
export type UploadSignatureResponse = z.infer<typeof uploadSignatureResponseSchema>;
