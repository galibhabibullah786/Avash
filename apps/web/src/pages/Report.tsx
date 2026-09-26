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
      setPhotoError("Please choose a JPEG, PNG, or WebP image.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > REPORT_PHOTO_MAX_BYTES) {
      setPhotoError(
        `That photo is too large. Please choose one under ${PHOTO_MAX_MB} MB.`,
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (!accessToken) {
      setPhotoError("You must be signed in to upload a photo.");
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
      setLocationError("Location is not available in this browser.");
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
          "Unable to get your location. Please allow location access and try again.",
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
          <p className="eyebrow">Thank you for helping your community</p>
          <h1>Report submitted</h1>
          <p>
            Your report has been received and will help local teams understand
            dengue risk in your area.
          </p>
          <div className="report-id">
            <span>Report ID</span>
            <strong>{mutation.data.id}</strong>
            <b>
              {mutation.data.flaggedForReview
                ? "Flagged for review"
                : "Under review"}
            </b>
          </div>
          <button
            className="button button--primary"
            onClick={() => mutation.reset()}
          >
            Submit another report <span>→</span>
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="inner-page report-page">
      <div className="inner-page__intro">
        <div>
          <p className="eyebrow">Community action</p>
          <h1>Report a breeding site</h1>
          <p className="inner-lede">
            See standing water or a blocked drain? Your report can help make
            your neighborhood safer.
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
            Description
            <textarea
              rows={5}
              maxLength={REPORT_DESCRIPTION_MAX_CHARS}
              placeholder="Tell us a little about the location or what you noticed..."
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
              Photo <span className="optional">(optional)</span>
            </span>
            {photoPreviewUrl ? (
              <div className="upload-box upload-box--preview">
                <img
                  src={photoPreviewUrl}
                  alt="Selected breeding-site photo preview"
                  className="upload-preview"
                />
                <b>{photoFile?.name}</b>
                <small>
                  {uploadPhoto.isPending
                    ? "Uploading…"
                    : uploadPhoto.isError
                      ? "Upload failed. Please remove and try again."
                      : uploadPhoto.isSuccess
                        ? "Photo attached"
                        : ""}
                </small>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={handleRemovePhoto}
                  disabled={mutation.isPending || uploadPhoto.isPending}
                >
                  ✕ Remove photo
                </button>
              </div>
            ) : (
              <label className="upload-box">
                <span aria-hidden="true">⌁</span>
                <b>Add a photo</b>
                <small>JPEG, PNG, or WebP — up to {PHOTO_MAX_MB} MB</small>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={PHOTO_ACCEPT}
                  onChange={handlePhotoChange}
                  disabled={mutation.isPending}
                  aria-label="Add a photo of the breeding site (optional)"
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
          <p className="eyebrow">Location</p>
          <h3>Share where you saw it</h3>
          <p>
            We use your location only to understand local risk and route this
            report for review.
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
                <span className="pin-label">Location not set</span>
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
            ⌖ {locating ? "Locating…" : "Use my location"}
          </button>

          <div className="location-grid">
            <label style={{ margin: '8px 0' }}>
              Latitude
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={lat ?? ""}
                onChange={(event) =>
                  updateManualCoordinate(event.target.value, "lat")
                }
                data-testid="report-lat"
                aria-label="Latitude"
                style={{ padding: '4px' }}
              />
            </label>

            <label>
              Longitude
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={lng ?? ""}
                onChange={(event) =>
                  updateManualCoordinate(event.target.value, "lng")
                }
                data-testid="report-lng"
                aria-label="Longitude"
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
              Unable to submit your report right now. Please try again.
            </p>
          ) : null}

          <button
            type="submit"
            className="button button--dark"
            disabled={!canSubmit}
            data-testid="submit-report"
          >
            {mutation.isPending ? "Submitting…" : "Submit report"}{" "}
            <span>↗</span>
          </button>
        </div>
      </form>
      <ReportSubmissionList />
    </main>
  );
}
