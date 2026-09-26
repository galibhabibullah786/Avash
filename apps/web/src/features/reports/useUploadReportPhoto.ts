import { useMutation } from "@tanstack/react-query";
import { type PhotoUploadResponse } from "@avash/types";
import { signedUpload } from "../uploads/useSignedUpload";

export interface UploadReportPhotoInput {
  file: File;
  accessToken: string;
}

export async function uploadReportPhoto(
  input: UploadReportPhotoInput,
): Promise<PhotoUploadResponse> {
  const result = await signedUpload({
    file: input.file,
    purpose: 'report-photo',
    accessToken: input.accessToken,
  });
  return { photoUrl: result.secureUrl };
}

export function useUploadReportPhoto() {
  return useMutation<PhotoUploadResponse, Error, UploadReportPhotoInput>({
    mutationFn: uploadReportPhoto,
  });
}
