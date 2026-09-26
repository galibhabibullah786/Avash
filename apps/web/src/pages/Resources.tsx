import { useMemo, useState } from "react";
import { bloodGroupSchema, type BloodGroup } from "@avash/types";
import { MAP_DEFAULT_CENTER } from "../features/map/tileLayer";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useBloodAvailability } from "../features/resources/useBloodAvailability";
import { useBloodInventoryRealtime } from "../features/resources/useBloodInventoryRealtime";

const BLOOD_GROUPS = bloodGroupSchema.options;

// No on-page geolocation prompt for this slice — a fixed Dhaka-centered
// search origin, sourced from MAP_DEFAULT_CENTER so the two can never
// drift apart. A future slice can wire this to
// apps/web/src/hooks/useGeolocation.ts once that hook ships.
const DEFAULT_SEARCH_CENTER = {
  lat: MAP_DEFAULT_CENTER[0],
  lng: MAP_DEFAULT_CENTER[1],
};

interface LiveOverride {
  unitsAvailable: number;
  plateletUnits: number;
  updatedAt: string;
}

function formatDistance(distanceM: number | null | undefined): string {
  return typeof distanceM === "number"
    ? `${(distanceM / 1000).toFixed(1)} km`
    : "—";
}

function formatUpdatedAt(updatedAt: string | null | undefined): string {
  return updatedAt ? new Date(updatedAt).toLocaleTimeString() : "—";
}

export default function Resources() {
  const isOnline = useOnlineStatus();
  const [bloodGroup, setBloodGroup] = useState<BloodGroup>("O+");
  const search = useBloodAvailability({ bloodGroup, ...DEFAULT_SEARCH_CENTER });

  const [liveOverrides, setLiveOverrides] = useState<
    Record<number, LiveOverride>
  >({});

  const realtimeStatus = useBloodInventoryRealtime((payload) => {
    if (payload?.inventoryId === null || payload?.inventoryId === undefined) {
      return;
    }
    // A change to a different blood group than the one currently shown
    // still updates the ticker's internal state — it just won't be
    // visible until the caller switches groups, avoiding a stale
    // override lingering if they switch back.
    setLiveOverrides((prev) => ({
      ...prev,
      [payload.inventoryId as number]: {
        unitsAvailable: payload?.unitsAvailable ?? 0,
        plateletUnits: payload?.plateletUnits ?? 0,
        updatedAt: payload?.updatedAt ?? new Date().toISOString(),
      },
    }));
  });

  const results = useMemo(() => {
    const base = search.data?.results ?? [];
    return base.map((row) => {
      const inventoryId = row?.inventoryId;
      const override =
        typeof inventoryId === "number"
          ? liveOverrides[inventoryId]
          : undefined;
      if (!override) {
        return row;
      }
      return {
        ...row,
        unitsAvailable: override.unitsAvailable,
        plateletUnits: override.plateletUnits,
        updatedAt: override.updatedAt,
      };
    });
  }, [search.data, liveOverrides]);

  return (
    <main className="inner-page">
      <div className="inner-page__intro">
        <div>
          <p className="eyebrow">Resources</p>
          <h1>Blood availability</h1>
          <p className="inner-lede">
            Live blood-unit availability at nearby hospitals, updated in real
            time as hospital staff report changes.
          </p>
        </div>
        <label className="location-select">
          Blood group
          <select
            id="blood-group-select"
            data-testid="blood-group-select"
            value={bloodGroup}
            onChange={(event) =>
              setBloodGroup((event?.target?.value as BloodGroup) ?? "O+")
            }
          >
            {BLOOD_GROUPS.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </label>
      </div>

      {realtimeStatus === "unavailable" ? (
        <p
          className="alert alert--error"
          data-testid="realtime-unavailable"
          style={{ marginBottom: "20px" }}
        >
          Live updates unavailable — showing the last fetched availability.
        </p>
      ) : null}

      {!isOnline ? (
        <p className="alert alert--error" data-testid="status-offline">
          You are offline
        </p>
      ) : search.isLoading ? (
        <p className="checker-time" data-testid="status-loading">
          Loading resources…
        </p>
      ) : search.isError ? (
        <p className="alert alert--error" data-testid="resources-error">
          API: unavailable right now. Please try again later.
        </p>
      ) : results.length === 0 ? (
        <p className="checker-time" data-testid="status-empty">
          No hospitals reporting {bloodGroup} availability nearby.
        </p>
      ) : (
        <div
          className="chart-panel report-table-panel"
          style={{ padding: "0" }}
        >
          <div className="responsive-table">
            <table data-testid="status-success">
              <thead>
                <tr>
                  <th style={{ paddingLeft: "25px", paddingTop: "18px" }}>
                    Hospital Name
                  </th>
                  <th style={{ paddingTop: "18px" }}>Address</th>
                  <th style={{ paddingTop: "18px" }}>Contact</th>
                  <th style={{ paddingTop: "18px" }}>Units</th>
                  <th style={{ paddingTop: "18px" }}>Platelets</th>
                  <th style={{ paddingTop: "18px" }}>Distance</th>
                  <th style={{ paddingRight: "25px", paddingTop: "18px" }}>
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((row, index) => {
                  const isLast = index === results.length - 1;
                  return (
                    <tr key={row?.inventoryId} data-testid="hospital-row">
                      <td
                        style={{
                          paddingLeft: "25px",
                          paddingBottom: isLast ? "18px" : undefined,
                        }}
                      >
                        {row?.hospital?.name ?? "—"}
                        {row?.hospital?.verified ? (
                          <span
                            className="table-badge table-badge--medium"
                            style={{ marginLeft: "8px" }}
                          >
                            Verified
                          </span>
                        ) : null}
                      </td>
                      <td
                        style={{ paddingBottom: isLast ? "18px" : undefined }}
                      >
                        {row?.hospital?.address ?? "—"}
                      </td>

                      <td
                        style={{ paddingBottom: isLast ? "18px" : undefined }}
                      >
                        {row?.hospital?.phone ?? "—"}
                      </td>
                      <td
                        style={{ paddingBottom: isLast ? "18px" : undefined }}
                      >
                        {row?.unitsAvailable ?? "—"}
                      </td>
                      <td
                        style={{ paddingBottom: isLast ? "18px" : undefined }}
                      >
                        {row?.plateletUnits ?? "—"}
                      </td>
                      <td
                        style={{ paddingBottom: isLast ? "18px" : undefined }}
                      >
                        {formatDistance(row?.distanceM)}
                      </td>
                      <td
                        style={{
                          paddingRight: "25px",
                          paddingBottom: isLast ? "18px" : undefined,
                        }}
                      >
                        {formatUpdatedAt(row?.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
