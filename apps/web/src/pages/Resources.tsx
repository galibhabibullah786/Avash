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

  const handleToggleNearby = () => {
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
        <ResourceTable results={results} />
      )}
    </main>
  );
}
