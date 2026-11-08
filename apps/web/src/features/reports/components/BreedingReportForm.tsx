import { useEffect, useState, type FormEvent } from "react";
import { REPORT_DESCRIPTION_MAX_CHARS } from "@avash/types";
import { useSession } from "../../auth/SessionProvider";
import { useSubmitBreedingReport } from "../useSubmitBreedingReport";
import { useUploadReportPhoto } from "../useUploadReportPhoto";
import { TurnstileWidget } from "./TurnstileWidget";
import { ReportPhotoUpload } from "./ReportPhotoUpload";
import { ReportLocationPicker } from "./ReportLocationPicker";
import { env } from "../../../lib/env";

export function BreedingReportForm() {
  const { accessToken } = useSession();
  const [description, setDescription] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);

  const mutation = useSubmitBreedingReport();
  const uploadPhoto = useUploadReportPhoto();

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    };
  }, [photoPreviewUrl]);

  useEffect(() => {
    if (mutation.isSuccess) {
      try {
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate([100, 50, 100]);
        }
      } catch {
        // Platform lacks vibration support
      }
    }
  }, [mutation.isSuccess]);

  const handlePhotoSelected = (file: File) => {
    if (!accessToken) return;
    setPhotoFile(file);
    setPhotoPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    uploadPhoto.mutate({ file, accessToken });
  };

  const handleRemovePhoto = () => {
    setPhotoFile(null);
    setPhotoError(null);
    setPhotoPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    uploadPhoto.reset();
  };

  const hasLocation = lat !== null && lng !== null;
  const photoBlocking = Boolean(photoFile) && uploadPhoto.isPending;
  const canSubmit =
    hasLocation &&
    Boolean(turnstileToken) &&
    Boolean(accessToken) &&
    description.length <= REPORT_DESCRIPTION_MAX_CHARS &&
    !photoBlocking &&
    !mutation.isPending;

  function useMyLocation() {
    if (!navigator?.geolocation) {
      setLocationError("এই ব্রাউজারে অবস্থান শনাক্তকরণ সুবিধা নেই।");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setLat(position?.coords?.latitude ?? null);
        setLng(position?.coords?.longitude ?? null);
      },
      () => {
        setLocating(false);
        setLocationError(
          "অবস্থান শনাক্ত করা যায়নি। অনুগ্রহ করে ব্রাউজারে লোকেশন পারমিশন দিন এবং পুনরায় চেষ্টা করুন।",
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || lat === null || lng === null || !turnstileToken || !accessToken) return;
    mutation.mutate({
      lat,
      lng,
      description: description.trim().length > 0 ? description.trim() : undefined,
      photoUrl: uploadPhoto.data?.photoUrl,
      turnstileToken,
      accessToken,
    });
  }

  if (mutation.isSuccess) {
    return (
      <section className="success-card" data-testid="report-success">
        <div className="success-card__icon">✓</div>
        <p className="eyebrow">আপনার এলাকাকে সুরক্ষিত রাখতে সহায়তার জন্য ধন্যবাদ</p>
        <h1>রিপোর্ট সফলভাবে জমা হয়েছে</h1>
        <p>
          আপনার রিপোর্টটি গৃহীত হয়েছে এবং এটি সংশ্লিষ্ট স্বাস্থ্য দলকে এলাকার ডেঙ্গু ঝুঁকি মূল্যায়নে সাহায্য করবে।
        </p>
        <div className="report-id">
          <span>রিপোর্ট নম্বর</span>
          <strong>{mutation.data.id}</strong>
          <b>
            {mutation.data.flaggedForReview
              ? "পর্যালোচনার জন্য চিহ্নিত"
              : "পর্যালোচনাধীন"}
          </b>
        </div>
        <button
          className="button button--primary"
          onClick={() => mutation.reset()}
        >
          আরেকটি রিপোর্ট জমা দিন <span>→</span>
        </button>
      </section>
    );
  }

  return (
    <form className="report-form" onSubmit={handleSubmit} data-testid="report-form">
      <div className="form-column">
        <label>
          বিবরণ (Description)
          <textarea
            rows={5}
            maxLength={REPORT_DESCRIPTION_MAX_CHARS}
            placeholder="স্থানের অবস্থান বা জমে থাকা পানি ও লার্ভার বিস্তারিত লিখুন..."
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            data-testid="report-description"
          />
        </label>
        <div className="field__meta" data-testid="description-counter">
          {description.length}/{REPORT_DESCRIPTION_MAX_CHARS}
        </div>

        <ReportPhotoUpload
          photoFile={photoFile}
          photoPreviewUrl={photoPreviewUrl}
          photoError={photoError}
          isPending={uploadPhoto.isPending}
          isError={uploadPhoto.isError}
          isSuccess={uploadPhoto.isSuccess}
          isSubmitting={mutation.isPending}
          onPhotoSelected={handlePhotoSelected}
          onPhotoError={setPhotoError}
          onRemovePhoto={handleRemovePhoto}
          accessToken={accessToken}
        />

        <div className="field">
          <TurnstileWidget
            siteKey={env.turnstileSiteKey}
            onVerify={setTurnstileToken}
            onExpire={() => setTurnstileToken(null)}
          />
        </div>
      </div>

      <div className="form-column">
        <ReportLocationPicker
          lat={lat}
          lng={lng}
          onCoordinatesChange={(newLat, newLng) => {
            setLat(newLat);
            setLng(newLng);
          }}
          locating={locating}
          locationError={locationError}
          onUseMyLocation={useMyLocation}
        />

        {mutation.isError ? (
          <p className="field__error" role="alert">
            সার্ভারে রিপোর্ট জমা দেওয়া সম্ভব হচ্ছে না। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।
          </p>
        ) : null}

        <button
          type="submit"
          className="button button--dark"
          disabled={!canSubmit}
          data-testid="submit-report"
        >
          {mutation.isPending ? "জমা দেওয়া হচ্ছে…" : "রিপোর্ট জমা দিন"}{" "}
          <span>↗</span>
        </button>
      </div>
    </form>
  );
}
