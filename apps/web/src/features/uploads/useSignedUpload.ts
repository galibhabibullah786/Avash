import { useMutation } from '@tanstack/react-query';
import {
  uploadSignatureResponseSchema,
  UPLOAD_MAX_BYTES,
  UPLOAD_ALLOWED_FORMATS,
  type UploadPurpose,
  type UploadSignatureResponse,
} from '@avash/types';
import { fetchApi } from '../../lib/apiClient';

export interface SignedUploadResult {
  secureUrl: string;
  publicId: string;
}

export interface UseSignedUploadInput {
  file: File;
  purpose: UploadPurpose;
  accessToken: string;
}

function extensionFor(file: File): string | undefined {
  const name = file?.name ?? '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : undefined;
}

/**
 * Client-side pre-check only (decision G) — the real enforcement is the
 * server-controlled signed parameter set. This just avoids the common
 * rejection (wrong type, too large) costing a round trip.
 */
export function validateFileBeforeUpload(file: File): string | null {
  if (!file || file.size > UPLOAD_MAX_BYTES) {
    return `File is too large. Maximum size is ${Math.floor(UPLOAD_MAX_BYTES / (1024 * 1024))} MB.`;
  }
  const extension = extensionFor(file);
  if (!extension || !(UPLOAD_ALLOWED_FORMATS as readonly string[]).includes(extension)) {
    return `Unsupported file type. Allowed formats: ${UPLOAD_ALLOWED_FORMATS.join(', ')}.`;
  }
  return null;
}

export async function requestUploadSignature(
  purpose: UploadPurpose,
  accessToken: string
): Promise<UploadSignatureResponse> {
  const result = await fetchApi('/api/uploads/signature', uploadSignatureResponseSchema, {
    method: 'POST',
    body: { purpose },
    accessToken,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

/**
 * The bytes go straight to Cloudinary, never through `apps/api` (decision
 * G). Cloudinary's response is untrusted third-party JSON — every access
 * is optional-chained, and a response missing `secure_url` is treated as
 * an error rather than handed back as `undefined` (R7).
 */
async function uploadToCloudinary(file: File, signature: UploadSignatureResponse): Promise<SignedUploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('api_key', signature.apiKey);
  formData.append('timestamp', String(signature.timestamp));
  formData.append('signature', signature.signature);
  formData.append('folder', signature.folder);
  formData.append('public_id', signature.publicId);
  formData.append('allowed_formats', signature.allowedFormats.join(','));

  let response: Response | undefined;
  try {
    response = await fetch(signature.uploadUrl, { method: 'POST', body: formData });
  } catch {
    throw new Error('Unable to reach the upload server.');
  }

  if (!response?.ok) {
    throw new Error('The upload was rejected.');
  }

  const json = (await response.json?.().catch(() => null)) as Record<string, unknown> | null;
  const secureUrl = json?.secure_url;
  const publicId = json?.public_id;

  if (typeof secureUrl !== 'string' || secureUrl.length === 0) {
    throw new Error('The upload service returned an unexpected response.');
  }

  return { secureUrl, publicId: typeof publicId === 'string' ? publicId : signature.publicId };
}

export async function signedUpload(input: UseSignedUploadInput): Promise<SignedUploadResult> {
  const validationError = validateFileBeforeUpload(input.file);
  if (validationError) {
    throw new Error(validationError);
  }
  const signature = await requestUploadSignature(input.purpose, input.accessToken);
  return uploadToCloudinary(input.file, signature);
}

/**
 * Ships with no caller in this slice (B-T08) — the profile and map slices
 * are its consumers.
 */
export function useSignedUpload() {
  return useMutation<SignedUploadResult, Error, UseSignedUploadInput>({
    mutationFn: signedUpload,
  });
}
