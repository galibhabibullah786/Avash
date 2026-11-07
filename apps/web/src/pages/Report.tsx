import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  REPORT_DESCRIPTION_MAX_CHARS,
  REPORT_PHOTO_ALLOWED_MIME_TYPES,
  REPORT_PHOTO_MAX_BYTES,
} from "@avash/types";
import { useSession } from "../features/auth/SessionProvider";
import { useSubmitBreedingReport } from "../features/reports/useSubmitBreedingReport";
import { useUploadReportPhoto } from "../features/reports/useUploadReportPhoto";
import { TurnstileWidget } from "../features/reports/TurnstileWidget";
import { env } from "../lib/env";
import L from "leaflet";
import { useLeafletMap } from "../features/map/useLeafletMap";
import { ReportSubmissionList } from "../features/reports/ReportSubmissionList";

const PHOTO_ACCEPT = REPORT_PHOTO_ALLOWED_MIME_TYPES.join(",");
const PHOTO_MAX_MB = Math.round(REPORT_PHOTO_MAX_BYTES / (1024 * 1024));

export default function Report() {
  const { accessToken } = useSession();
  const [description, setDescription] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const mutation = useSubmitBreedingReport();

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useLeafletMap(mapContainerRef);
  const markerRef = useRef<L.Marker | null>(null);

  // Update map marker when coordinates change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (lat !== null && lng !== null) {
      const pos = new L.LatLng(lat, lng);

      if (!markerRef.current) {
        markerRef.current = L.marker(pos, {
          icon: L.divIcon({
            className: "custom-pin-marker",
            html: '<div style="background-color: var(--teal); width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
        }).addTo(map);
      } else {
        markerRef.current.setLatLng(pos);
      }
      map.setView(pos, 15, { animate: true });
    } else {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    }
  }, [lat, lng, mapRef]);

  const updateManualCoordinate = (next: string, axis: "lat" | "lng") => {
    if (next.trim() === "") {
      if (axis === "lat") setLat(null);
      else setLng(null);
      return;
    }

    const value = Number(next);
    if (!Number.isFinite(value)) {
      if (axis === "lat") setLat(null);
      else setLng(null);
      return;
    }

    if (axis === "lat") setLat(value);
    else setLng(value);
  };

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const uploadPhoto = useUploadReportPhoto();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Local preview only — object URLs are never submitted (R7: a blob: URL
  // is meaningless outside this browser tab), just revoked whenever the
  // selection changes or the page unmounts, so nothing leaks.
  useEffect(() => {
    return () => {
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    };
  }, [photoPreviewUrl]);

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      return;
    }
    if (
      !(REPORT_PHOTO_ALLOWED_MIME_TYPES as readonly string[]).includes(
        file.type,
      )
    ) {
      setPhotoError("অনুগ্রহ করে JPEG, PNG, বা WebP ফরম্যাটের ছবি নির্বাচন করুন।");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > REPORT_PHOTO_MAX_BYTES) {
      setPhotoError(
        `ছবির আকার অনেক বড়। অনুগ্রহ করে ${PHOTO_MAX_MB} মেগাবাইট বা তার চেয়ে ছোট ছবি নির্বাচন করুন।`,
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (!accessToken) {
      setPhotoError("ছবি সংযুক্ত করতে অনুগ্রহ করে প্রথমে লগইন করুন।");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setPhotoError(null);
    setPhotoFile(file);
    setPhotoPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
    uploadPhoto.mutate({ file, accessToken });
  }

  function handleRemovePhoto() {
    setPhotoFile(null);
    setPhotoError(null);
    setPhotoPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
    uploadPhoto.reset();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const hasLocation = lat !== null && lng !== null;
  // A failed optional upload must not trap the report form. The selected
  // photo is omitted below until the user retries or removes it.
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
      description:
        description.trim().length > 0 ? description.trim() : undefined,
      photoUrl: uploadPhoto.data?.photoUrl,
      turnstileToken,
      accessToken,
    });
  }

  if (mutation.isSuccess) {
    return (
      <main className="inner-page report-page">
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
      </main>
    );
  }

  return (
    <main className="inner-page report-page">
      <div className="inner-page__intro">
        <div>
          <p className="eyebrow">নাগরিক সহযোগিতা</p>
          <h1>মশার প্রজনন ক্ষেত্র রিপোর্ট করুন</h1>
          <p className="inner-lede">
            জমে থাকা পানি বা বদ্ধ ড্রেন দেখছেন? আপনার একটি রিপোর্ট এলাকাকে নিরাপদ রাখতে সাহায্য করতে পারে।
          </p>
        </div>
      </div>
      <form
        className="report-form"
        onSubmit={handleSubmit}
        data-testid="report-form"
      >
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
                  {uploadPhoto.isPending
                    ? "আপলোড হচ্ছে…"
                    : uploadPhoto.isError
                      ? "আপলোড ব্যর্থ হয়েছে। অনুগ্রহ করে মুছে আবার চেষ্টা করুন।"
                      : uploadPhoto.isSuccess
                        ? "ছবি সংযুক্ত হয়েছে"
                        : ""}
                </small>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={handleRemovePhoto}
                  disabled={mutation.isPending || uploadPhoto.isPending}
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
                  disabled={mutation.isPending}
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
          <div className="field">
            <TurnstileWidget
              siteKey={env.turnstileSiteKey}
              onVerify={setTurnstileToken}
              onExpire={() => setTurnstileToken(null)}
            />
          </div>
        </div>
        <div className="pin-panel">
          <p className="eyebrow">অবস্থান</p>
          <h3>যেখানে দেখেছেন তা চিহ্নিত করুন</h3>
          <p>
            এলাকার ডেঙ্গু ঝুঁকি মূল্যায়ন ও অনুসন্ধানের জন্যই কেবল আপনার অবস্থান ব্যবহার করা হয়।
          </p>

          <div
            className="pin-map"
            ref={mapContainerRef}
            style={{
              height: "200px",
              width: "100%",
              position: "relative",
              overflow: "hidden",
              borderRadius: "var(--radius-lg)",
            }}
          >
            {!hasLocation && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  zIndex: 1000,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(255,255,255,0.7)",
                  pointerEvents: "none",
                }}
              >
                <span className="pin-label">অবস্থান নির্ধারিত হয়নি</span>
              </div>
            )}
            {hasLocation && (
              <div
                style={{
                  position: "absolute",
                  bottom: "10px",
                  left: "10px",
                  zIndex: 1000,
                  pointerEvents: "none",
                }}
              >
                <span
                  className="pin-label"
                  style={{
                    backgroundColor: "white",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                    fontWeight: 600,
                  }}
                >
                  {lat!.toFixed(4)}, {lng!.toFixed(4)}
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            className="button button--quiet"
            onClick={useMyLocation}
            disabled={locating}
            data-testid="use-my-location"
          >
            ⌖ {locating ? "অবস্থান খোঁজা হচ্ছে…" : "আমার বর্তমান অবস্থান ব্যবহার করুন"}
          </button>

          <div className="location-grid">
            <label style={{ margin: '8px 0' }}>
              অক্ষাংশ (Latitude)
              <input
                id="report-lat"
                type="number"
                inputMode="decimal"
                step="any"
                value={lat ?? ""}
                disabled={locating}
                onChange={(event) =>
                  updateManualCoordinate(event.target.value, "lat")
                }
                data-testid="report-lat"
                aria-label="অক্ষাংশ"
                style={{ padding: '4px' }}
              />
            </label>

            <label>
              দ্রাঘিমাংশ (Longitude)
              <input
                id="report-lng"
                type="number"
                inputMode="decimal"
                step="any"
                value={lng ?? ""}
                disabled={locating}
                onChange={(event) =>
                  updateManualCoordinate(event.target.value, "lng")
                }
                data-testid="report-lng"
                aria-label="দ্রাঘিমাংশ"
                style={{ padding: '4px' }}
              />
            </label>
          </div>

          {locationError ? (
            <p
              className="field__error"
              role="alert"
              data-testid="location-permission-denied"
            >
              {locationError}
            </p>
          ) : null}

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
      <ReportSubmissionList />
    </main>
  );
}
