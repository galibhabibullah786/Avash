import { useRef, type ChangeEvent } from "react";
import {
  REPORT_PHOTO_ALLOWED_MIME_TYPES,
  REPORT_PHOTO_MAX_BYTES,
} from "@avash/types";

const PHOTO_ACCEPT = REPORT_PHOTO_ALLOWED_MIME_TYPES.join(",");
const PHOTO_MAX_MB = Math.round(REPORT_PHOTO_MAX_BYTES / (1024 * 1024));

export interface ReportPhotoUploadProps {
  photoFile: File | null;
  photoPreviewUrl: string | null;
  photoError: string | null;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  isSubmitting: boolean;
  onPhotoSelected: (file: File) => void;
  onPhotoError: (error: string | null) => void;
  onRemovePhoto: () => void;
  accessToken: string | null;
}

export function ReportPhotoUpload({
  photoFile,
  photoPreviewUrl,
  photoError,
  isPending,
  isError,
  isSuccess,
  isSubmitting,
  onPhotoSelected,
  onPhotoError,
  onRemovePhoto,
  accessToken,
}: ReportPhotoUploadProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;

    if (!(REPORT_PHOTO_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      onPhotoError("অনুগ্রহ করে JPEG, PNG, বা WebP ফরম্যাটের ছবি নির্বাচন করুন।");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > REPORT_PHOTO_MAX_BYTES) {
      onPhotoError(
        `ছবির আকার অনেক বড়। অনুগ্রহ করে ${PHOTO_MAX_MB} মেগাবাইট বা তার চেয়ে ছোট ছবি নির্বাচন করুন।`,
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (!accessToken) {
      onPhotoError("ছবি সংযুক্ত করতে অনুগ্রহ করে প্রথমে লগইন করুন।");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    onPhotoError(null);
    onPhotoSelected(file);
  }

  function handleRemove() {
    onRemovePhoto();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="field">
      <span className="field__label">
        ছবি <span className="optional">(ঐচ্ছিক)</span>
      </span>
      {photoPreviewUrl ? (
        <div className="upload-box upload-box--preview">
          <img
            src={photoPreviewUrl}
            alt="সংযুক্ত ছবির প্রিভিউ"
            className="upload-preview"
          />
          <b>{photoFile?.name}</b>
          <small>
            {isPending
              ? "আপলোড হচ্ছে…"
              : isError
                ? "আপলোড ব্যর্থ হয়েছে। অনুগ্রহ করে মুছে আবার চেষ্টা করুন।"
                : isSuccess
                  ? "ছবি সংযুক্ত হয়েছে"
                  : ""}
          </small>
          <button
            type="button"
            className="button button--quiet"
            onClick={handleRemove}
            disabled={isSubmitting || isPending}
          >
            ✕ ছবি মুছে ফেলুন
          </button>
        </div>
      ) : (
        <label className="upload-box">
          <span aria-hidden="true">⌁</span>
          <b>ছবি সংযুক্ত করুন</b>
          <small>JPEG, PNG, বা WebP — সর্বোচ্চ {PHOTO_MAX_MB} মেগাবাইট</small>
          <input
            ref={fileInputRef}
            type="file"
            accept={PHOTO_ACCEPT}
            onChange={handlePhotoChange}
            disabled={isSubmitting}
            aria-label="মশার প্রজনন ক্ষেত্রের ছবি সংযুক্ত করুন (ঐচ্ছিক)"
          />
        </label>
      )}
      {photoError ? (
        <p className="field__error" role="alert">
          {photoError}
        </p>
      ) : null}
    </div>
  );
}
