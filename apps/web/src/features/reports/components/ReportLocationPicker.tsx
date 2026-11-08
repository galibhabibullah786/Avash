import { useEffect, useRef } from "react";
import L from "leaflet";
import { useLeafletMap } from "../../map/useLeafletMap";

export interface ReportLocationPickerProps {
  lat: number | null;
  lng: number | null;
  onCoordinatesChange: (lat: number | null, lng: number | null) => void;
  locating: boolean;
  locationError: string | null;
  onUseMyLocation: () => void;
}

export function ReportLocationPicker({
  lat,
  lng,
  onCoordinatesChange,
  locating,
  locationError,
  onUseMyLocation,
}: ReportLocationPickerProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useLeafletMap(mapContainerRef);
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (lat !== null && lng !== null) {
      const pos = new L.LatLng(lat, lng);

      if (!markerRef.current) {
        markerRef.current = L.marker(pos, {
          icon: L.divIcon({
            className: "custom-pin-marker",
            html: '<div style="background-color: var(--color-primary); width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--color-surface); box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>',
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
      if (axis === "lat") onCoordinatesChange(null, lng);
      else onCoordinatesChange(lat, null);
      return;
    }

    const value = Number(next);
    if (!Number.isFinite(value)) {
      if (axis === "lat") onCoordinatesChange(null, lng);
      else onCoordinatesChange(lat, null);
      return;
    }

    if (axis === "lat") onCoordinatesChange(value, lng);
    else onCoordinatesChange(lat, value);
  };

  const hasLocation = lat !== null && lng !== null;

  return (
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
          border: "1px solid var(--color-border)",
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
              backgroundColor: "color-mix(in srgb, var(--color-surface) 85%, transparent)",
              backdropFilter: "blur(2px)",
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
                backgroundColor: "var(--color-surface)",
                color: "var(--color-text)",
                border: "1px solid var(--color-border)",
                padding: "4px 8px",
                borderRadius: "4px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
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
        onClick={onUseMyLocation}
        disabled={locating}
        data-testid="use-my-location"
        style={{ minHeight: "48px", width: "100%", justifyContent: "center" }}
      >
        ⌖ {locating ? "অবস্থান খোঁজা হচ্ছে…" : "আমার বর্তমান অবস্থান ব্যবহার করুন"}
      </button>

      <div className="location-grid">
        <label style={{ margin: "8px 0" }}>
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
            style={{ padding: "8px 12px", minHeight: "44px" }}
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
            style={{ padding: "8px 12px", minHeight: "44px" }}
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
    </div>
  );
}
