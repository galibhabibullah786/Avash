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
          <p className="eyebrow">জরুরি সেবা</p>
          <h1>রক্তের প্রাপ্যতা ও মজুদ (Blood Availability)</h1>
          <p className="inner-lede">
            নিকটস্থ হাসপাতালসমূহে রক্তের বর্তমান মজুদ, হাসপাতাল কর্মীদের তথ্য অনুযায়ী সরাসরি হালনাগাদকৃত।
          </p>
        </div>
        <label className="location-select">
          রক্তের গ্রুপ
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
          লাইভ আপডেট এই মুহূর্তে পাওয়া যাচ্ছে না — পূর্বে সংগৃহীত তথ্য প্রদর্শিত হচ্ছে।
        </p>
      ) : null}

      {!isOnline ? (
        <p className="alert alert--error" data-testid="status-offline">
          আপনি অফলাইনে আছেন
        </p>
      ) : search.isLoading ? (
        <p className="checker-time" data-testid="status-loading">
          তথ্য লোড হচ্ছে…
        </p>
      ) : search.isError ? (
        <p className="alert alert--error" data-testid="resources-error">
          সার্ভার সংযোগ এই মুহূর্তে অনুপলব্ধ। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।
        </p>
      ) : results.length === 0 ? (
        <p className="checker-time" data-testid="status-empty">
          নিকটস্থ কোনো হাসপাতালে {bloodGroup} রক্তের মজুদের তথ্য পাওয়া যায়নি।
        </p>
      ) : (
        <div
          className="chart-panel report-table-panel"
          style={{ padding: "0" }}
        >
          <div className="responsive-table">
            <table data-testid="status-success" className="w-full max-md:block">
              <thead className="max-md:hidden">
                <tr>
                  <th style={{ paddingLeft: "25px", paddingTop: "18px" }}>
                    হাসপাতালের নাম
                  </th>
                  <th style={{ paddingTop: "18px" }}>ঠিকানা</th>
                  <th style={{ paddingTop: "18px" }}>যোগাযোগ</th>
                  <th style={{ paddingTop: "18px" }}>মোট রক্ত (Units)</th>
                  <th style={{ paddingTop: "18px" }}>প্লাটিলেট (Platelets)</th>
                  <th style={{ paddingTop: "18px" }}>দূরত্ব</th>
                  <th style={{ paddingRight: "25px", paddingTop: "18px" }}>
                    সর্বশেষ আপডেট
                  </th>
                </tr>
              </thead>
              <tbody className="max-md:block">
                {results.map((row, index) => {
                  const isLast = index === results.length - 1;
                  return (
                    <tr key={row?.inventoryId} data-testid="hospital-row" className="max-md:block max-md:mb-4 max-md:border max-md:border-[var(--color-border)] max-md:rounded-lg max-md:p-4 max-md:bg-[var(--color-surface)]">
                      <td
                        className="max-md:flex max-md:justify-between max-md:items-center max-md:py-2 max-md:border-b max-md:border-dashed max-md:border-[var(--color-border)] max-md:!p-2 max-md:!pb-2"
                        style={{
                          paddingLeft: "25px",
                          paddingBottom: isLast ? "18px" : undefined,
                        }}
                      >
                        <span className="md:hidden font-bold text-[var(--color-text-muted)] mr-4">নাম</span>
                        <span className="max-md:text-right">
                          {row?.hospital?.name ?? "—"}
                          {row?.hospital?.verified ? (
                            <span
                              className="table-badge table-badge--medium"
                              style={{ marginLeft: "8px" }}
                            >
                              যাচাইকৃত
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td
                        className="max-md:flex max-md:justify-between max-md:items-center max-md:py-2 max-md:border-b max-md:border-dashed max-md:border-[var(--color-border)] max-md:!p-2 max-md:!pb-2"
                        style={{ paddingBottom: isLast ? "18px" : undefined }}
                      >
                        <span className="md:hidden font-bold text-[var(--color-text-muted)] mr-4">ঠিকানা</span>
                        <span className="max-md:text-right">{row?.hospital?.address ?? "—"}</span>
                      </td>

                      <td
                        className="max-md:flex max-md:justify-between max-md:items-center max-md:py-2 max-md:border-b max-md:border-dashed max-md:border-[var(--color-border)] max-md:!p-2 max-md:!pb-2"
                        style={{ paddingBottom: isLast ? "18px" : undefined }}
                      >
                        <span className="md:hidden font-bold text-[var(--color-text-muted)] mr-4">যোগাযোগ</span>
                        <span className="max-md:text-right">{row?.hospital?.phone ?? "—"}</span>
                      </td>
                      <td
                        className="max-md:flex max-md:justify-between max-md:items-center max-md:py-2 max-md:border-b max-md:border-dashed max-md:border-[var(--color-border)] max-md:!p-2 max-md:!pb-2"
                        style={{ paddingBottom: isLast ? "18px" : undefined }}
                      >
                        <span className="md:hidden font-bold text-[var(--color-text-muted)] mr-4">মোট রক্ত</span>
                        <span className="max-md:text-right">{row?.unitsAvailable ?? "—"}</span>
                      </td>
                      <td
                        className="max-md:flex max-md:justify-between max-md:items-center max-md:py-2 max-md:border-b max-md:border-dashed max-md:border-[var(--color-border)] max-md:!p-2 max-md:!pb-2"
                        style={{ paddingBottom: isLast ? "18px" : undefined }}
                      >
                        <span className="md:hidden font-bold text-[var(--color-text-muted)] mr-4">প্লাটিলেট</span>
                        <span className="max-md:text-right">{row?.plateletUnits ?? "—"}</span>
                      </td>
                      <td
                        className="max-md:flex max-md:justify-between max-md:items-center max-md:py-2 max-md:border-b max-md:border-dashed max-md:border-[var(--color-border)] max-md:!p-2 max-md:!pb-2"
                        style={{ paddingBottom: isLast ? "18px" : undefined }}
                      >
                        <span className="md:hidden font-bold text-[var(--color-text-muted)] mr-4">দূরত্ব</span>
                        <span className="max-md:text-right">{formatDistance(row?.distanceM)}</span>
                      </td>
                      <td
                        className="max-md:flex max-md:justify-between max-md:items-center max-md:py-2 max-md:border-0 max-md:!p-2 max-md:!pb-2"
                        style={{
                          paddingRight: "25px",
                          paddingBottom: isLast ? "18px" : undefined,
                        }}
                      >
                        <span className="md:hidden font-bold text-[var(--color-text-muted)] mr-4">হালনাগাদ</span>
                        <span className="max-md:text-right">{formatUpdatedAt(row?.updatedAt)}</span>
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
