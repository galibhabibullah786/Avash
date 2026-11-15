import { useMutation } from '@tanstack/react-query';
import {
  type PhotoUploadResponse,
  REPORT_PHOTO_MAX_BYTES,
  REPORT_PHOTO_ALLOWED_MIME_TYPES,
} from '@avash/types';
import { env } from '../../lib/env';

export interface UploadReportPhotoInput {
  file: File;
  accessToken?: string;
}

export function validateReportPhoto(file: File): string | null {
  if (!file || file.size > REPORT_PHOTO_MAX_BYTES) {
    return `File is too large. Maximum size is ${Math.floor(REPORT_PHOTO_MAX_BYTES / (1024 * 1024))} MB.`;
  }
  const mime = file.type;
  if (!REPORT_PHOTO_ALLOWED_MIME_TYPES.includes(mime as (typeof REPORT_PHOTO_ALLOWED_MIME_TYPES)[number])) {
    return 'Unsupported file type. Allowed formats: JPEG, PNG, WebP.';
  }
  return null;
}

export async function uploadReportPhoto(
  input: UploadReportPhotoInput,
): Promise<PhotoUploadResponse> {
  const validationError = validateReportPhoto(input.file);
  if (validationError) {
    throw new Error(validationError);
  }

  const formData = new FormData();
  formData.append('file', input.file);

  const headers: Record<string, string> = {};
  if (input.accessToken) {
    headers['Authorization'] = `Bearer ${input.accessToken}`;
  }

  const response = await fetch(`${env.apiBaseUrl}/api/reports/photo`, {
    method: 'POST',
    headers,
    body: formData,
  }).catch(() => null);

  if (!response || !response.ok) {
    throw new Error('Unable to upload photo. Please try again.');
  }

  const data = (await response.json().catch(() => null)) as { photoUrl?: string };
  if (!data?.photoUrl) {
    throw new Error('Upload response did not contain a valid photo URL.');
  }

  return { photoUrl: data.photoUrl };
}

export function useUploadReportPhoto() {
  return useMutation<PhotoUploadResponse, Error, UploadReportPhotoInput>({
    mutationFn: uploadReportPhoto,
  });
}
