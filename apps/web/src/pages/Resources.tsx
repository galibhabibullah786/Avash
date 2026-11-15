import { useMemo, useState } from "react";
import { bloodGroupSchema, type BloodGroup } from "@avash/types";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useGeolocation } from "../hooks/useGeolocation";
import { useBloodAvailability, type BloodSearchParams } from "../features/resources/useBloodAvailability";
import { useBloodInventoryRealtime } from "../features/resources/useBloodInventoryRealtime";
import { ResourceTable } from "../features/resources/components/ResourceTable";

const BLOOD_GROUPS = bloodGroupSchema.options;

interface LiveOverride {
  unitsAvailable: number;
  plateletUnits: number;
  updatedAt: string;
}

export default function Resources() {
  const isOnline = useOnlineStatus();
  const geolocation = useGeolocation();
  const [bloodGroup, setBloodGroup] = useState<BloodGroup>("O+");
  const [useNearby, setUseNearby] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handleToggleNearby = () => {
    setCurrentPage(1);
    if (!useNearby) {
      geolocation.request();
      setUseNearby(true);
    } else {
      setUseNearby(false);
    }
  };

  const searchParams: BloodSearchParams = useMemo(() => {
    if (useNearby && typeof geolocation.lat === "number" && typeof geolocation.lng === "number") {
      return { bloodGroup, lat: geolocation.lat, lng: geolocation.lng };
    }
    return { bloodGroup };
  }, [bloodGroup, useNearby, geolocation.lat, geolocation.lng]);

  const search = useBloodAvailability(searchParams);

  const [liveOverrides, setLiveOverrides] = useState<Record<number, LiveOverride>>({});

  const realtimeStatus = useBloodInventoryRealtime((payload) => {
    if (payload?.inventoryId === null || payload?.inventoryId === undefined) {
      return;
    }
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
      const override = typeof inventoryId === "number" ? liveOverrides[inventoryId] : undefined;
      if (!override) return row;
      return {
        ...row,
        unitsAvailable: override.unitsAvailable,
        plateletUnits: override.plateletUnits,
        updatedAt: override.updatedAt,
      };
    });
  }, [search.data, liveOverrides]);

  const totalResults = results.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedResults = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return results.slice(start, start + pageSize);
  }, [results, safePage, pageSize]);

  return (
    <main className="inner-page">
      <div className="inner-page__intro">
        <div>
          <p className="eyebrow">জরুরি সেবা</p>
          <h1>রক্তের প্রাপ্যতা ও মজুদ (Blood Availability)</h1>
          <p className="inner-lede">
            হাসপাতালসমূহে রক্তের বর্তমান মজুদ, হাসপাতাল কর্মীদের তথ্য অনুযায়ী সরাসরি হালনাগাদকৃত।
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="location-select">
            রক্তের গ্রুপ
            <select
              id="blood-group-select"
              data-testid="blood-group-select"
              value={bloodGroup}
              onChange={(event) => {
                setBloodGroup((event?.target?.value as BloodGroup) ?? "O+");
                setCurrentPage(1);
              }}
            >
              {BLOOD_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            data-testid="location-filter-toggle"
            onClick={handleToggleNearby}
            className={`px-3 py-2 rounded text-sm font-semibold border transition ${
              useNearby
                ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                : "bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-subtle)]"
            }`}
          >
            {geolocation.status === "requesting"
              ? "অবস্থান খোঁজা হচ্ছে…"
              : useNearby
              ? "সকল হাসপাতাল দেখুন"
              : "আমার নিকটস্থ হাসপাতাল"}
          </button>
        </div>
      </div>

      {useNearby && (geolocation.status === "denied" || geolocation.status === "unavailable") ? (
        <p className="alert alert--warning" data-testid="location-denied-note" style={{ marginBottom: "15px" }}>
          অবস্থান পাওয়া যায়নি — সকল হাসপাতাল প্রদর্শিত হচ্ছে।
        </p>
      ) : null}

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
          কোনো হাসপাতালে {bloodGroup} রক্তের মজুদের তথ্য পাওয়া যায়নি।
        </p>
      ) : (
        <>
          <ResourceTable results={paginatedResults} />
          {results.length > 0 && (
            <div
              data-testid="resource-pagination"
              className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4 px-2 border-t border-[var(--color-border)] mt-4"
            >
              <div className="text-sm text-[var(--color-text-muted)]">
                মোট <span className="font-semibold text-[var(--color-text)]">{results.length}</span>টি ফলাফলের মধ্যে{' '}
                <span className="font-semibold text-[var(--color-text)]">
                  {(safePage - 1) * pageSize + 1}
                </span>{' '}
                থেকে{' '}
                <span className="font-semibold text-[var(--color-text)]">
                  {Math.min(safePage * pageSize, results.length)}
                </span>{' '}
                দেখানো হচ্ছে
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label htmlFor="resource-page-size" className="text-xs text-[var(--color-text-muted)]">
                    প্রতি পৃষ্ঠায়:
                  </label>
                  <select
                    id="resource-page-size"
                    data-testid="resource-page-size"
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="text-xs px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                  >
                    <option value={5}>৫</option>
                    <option value={10}>১০</option>
                    <option value={25}>২৫</option>
                    <option value={50}>৫০</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="pagination-prev"
                    onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                    disabled={safePage <= 1}
                    className="px-3 py-1.5 rounded text-sm font-semibold border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)] disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    পূর্ববর্তী
                  </button>
                  <span className="text-sm font-medium text-[var(--color-text)] px-2">
                    {safePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    data-testid="pagination-next"
                    onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                    disabled={safePage >= totalPages}
                    className="px-3 py-1.5 rounded text-sm font-semibold border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)] disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    পরবর্তী
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
