import { useMutation } from "@tanstack/react-query";
import { photoUploadResponseSchema, type PhotoUploadResponse } from "@avash/types";
import { fetchApi } from "../../lib/apiClient";

export async function uploadReportPhoto(
  file: File,
): Promise<PhotoUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const result = await fetchApi(
    "/api/reports/photo",
    photoUploadResponseSchema,
    {
      method: "POST",
      body: formData,
    },
  );
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

export function useUploadReportPhoto() {
  return useMutation<PhotoUploadResponse, Error, File>({
    mutationFn: uploadReportPhoto,
  });
}
