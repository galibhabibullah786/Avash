import { useRef, useState, useMemo } from "react";
import { RISK_MAP_DEFAULT_HORIZON_WEEKS } from "@avash/types";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useLeafletMap } from "../features/map/useLeafletMap";
import { useRiskMap } from "../features/risk/useRiskMap";
import { useRegionRisk } from "../features/risk/useRegionRisk";
import { useRiskMapLayer } from "../features/risk/useRiskMapLayer";
import { useRiskReportsLayer } from "../features/risk/useRiskReportsLayer";
import {
  RISK_LEVEL_BAND_STYLES,
} from "../features/risk/riskLevelBands";
import { RiskMapLegend } from "../features/risk/RiskMapLegend";

const HORIZON_OPTIONS: Array<2 | 4> = [2, 4];

export default function RiskMap() {
  const isOnline = useOnlineStatus();
  const [horizonWeeks, setHorizonWeeks] = useState<2 | 4>(
    RISK_MAP_DEFAULT_HORIZON_WEEKS,
  );
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useLeafletMap(containerRef);

  const riskMap = useRiskMap(horizonWeeks);

  const regions = useMemo(
    () => (riskMap.data?.features ?? []).map((feature) => feature.properties),
    [riskMap.data],
  );

  const activeRegionId = selectedRegionId ?? regions[0]?.regionId ?? null;
  const regionRisk = useRegionRisk(activeRegionId, horizonWeeks);

  const activeRegionName =
    regionRisk.data?.regionName ??
    regions.find((region) => region.regionId === activeRegionId)?.regionName ??
    "Region";

  useRiskMapLayer(mapRef, riskMap.data, setSelectedRegionId);
  useRiskReportsLayer(mapRef, regionRisk.data?.verifiedReports);

  const features = riskMap.data?.features ?? [];

  return (
    <main className="inner-page">
      <div className="inner-page__intro">
        <div>
          <p className="eyebrow">জেলা ও এলাকাভিত্তিক বিশ্লেষণ</p>
          {regions.length > 0 ? (
            <label className="location-select">
              <select
                value={activeRegionId ?? ""}
                onChange={(event) => setSelectedRegionId(event.target.value)}
              >
                {regions.map((region) => (
                  <option key={region.regionId} value={region.regionId}>
                    {region.regionName}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <h1>ঝুঁকির মানচিত্র</h1>
          )}
          <p className="inner-lede">
            এই জেলার ডেঙ্গু ঝুঁকি পরিস্থিতি এবং পারিপার্শ্বিক প্রভাবকসমূহের বিস্তারিত চিত্র।
          </p>
        </div>
      </div>



      {!isOnline ? (
        <p className="alert alert--error" data-testid="status-offline">
          আপনি অফলাইনে আছেন
        </p>
      ) : riskMap.isLoading ? (
        <p className="checker-time" data-testid="status-loading">
          মানচিত্রের তথ্য লোড হচ্ছে…
        </p>
      ) : riskMap.isError ? (
        <p className="alert alert--error" data-testid="status-error">
          সার্ভার সংযোগ এই মুহূর্তে অনুপলব্ধ। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।
        </p>
      ) : features.length === 0 ? (
        <p className="checker-time" data-testid="status-empty">
          এখনো কোনো ঝুঁকি পূর্বাভাস প্রস্তুত হয়নি।
        </p>
      ) : (
        <p
          className="checker-time"
          data-testid="status-success"
          style={{ color: "var(--teal)" }}
        >
          {features.length}টি এলাকার ঝুঁকি তথ্য প্রদর্শিত হচ্ছে।
        </p>
      )}

      <section
        className="analysis-grid risk-map-grid max-md:!flex max-md:!flex-col"
        style={{ marginBottom: "30px" }}
      >
        <div className="chart-panel map-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ইন্টারেক্টিভ মানচিত্র</p>
              <h2>এলাকাভিত্তিক ঝুঁকি পর্যালোচনা</h2>
            </div>
          </div>
          <div
            className="map-frame"
            ref={containerRef}
            data-testid="risk-map-container"
            style={{ height: "clamp(280px, 45vh, 420px)", width: "100%" }}
          >
            {riskMap.isLoading ? (
              <p className="map-frame__status">মানচিত্রের তথ্য লোড হচ্ছে…</p>
            ) : null}
          </div>
        </div>

        <RiskMapLegend />
      </section>

      <section className="prediction-row" data-testid="risk-horizon-toggle">
        {HORIZON_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`prediction-card ${horizonWeeks === option ? "is-active" : ""}`}
            aria-pressed={option === horizonWeeks}
            onClick={() => setHorizonWeeks(option)}
          >
            <span>{option === 2 ? "২ সপ্তাহ" : "৪ সপ্তাহ"} ({option} weeks)</span>
            <i>→</i>
          </button>
        ))}
      </section>

      {activeRegionId ? (
        <section
          className="analysis-grid max-md:!flex max-md:!flex-col"
          aria-label="Region risk detail"
          data-testid="risk-detail-panel"
          style={{ marginTop: "30px" }}
        >
          {regionRisk.isLoading ? (
            <div className="chart-panel">
              <p className="checker-time" data-testid="status-loading">
                এলাকার বিস্তারিত তথ্য লোড হচ্ছে…
              </p>
            </div>
          ) : regionRisk.isError ? (
            <div className="chart-panel">
              <p className="alert alert--error" data-testid="status-error">
                এই মুহূর্তে বিস্তারিত তথ্য লোড করা যায়নি।
              </p>
            </div>
          ) : (
            <>
              <div className="chart-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">ঝুঁকি পূর্বাভাস</p>
                    <h2>{activeRegionName}</h2>
                  </div>
                </div>
                <div className="condition-list">
                  {(regionRisk.data?.predictions ?? []).length === 0 ? (
                    <p>এই এলাকার জন্য কোনো পূর্বাভাস নেই।</p>
                  ) : (
                    (regionRisk.data?.predictions ?? []).map((prediction) => (
                      <div className="condition" key={prediction.horizonWeeks}>
                        <div>
                          <b>{prediction.horizonWeeks === 2 ? "২ সপ্তাহ" : "৪ সপ্তাহ"} আগাম পূর্বাভাস</b>
                          <small>
                            {(prediction.topFactors ?? []).length === 0
                              ? "কোনো বিশেষ কারণ চিহ্নিত করা যায়নি।"
                              : (prediction.topFactors ?? [])
                                .map(
                                  (f) => `${f.feature} ${f.direction} ঝুঁকি`,
                                )
                                .join(", ")}
                          </small>
                        </div>
                        <strong>
                          {RISK_LEVEL_BAND_STYLES[prediction.riskLevel]
                            ?.label ?? prediction.riskLevel}{" "}
                          ({(prediction.riskScore * 100).toFixed(0)}%)
                        </strong>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="signals-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">বর্তমান অবস্থা</p>
                    <h2>সর্বশেষ আবহাওয়া</h2>
                  </div>
                </div>
                <div className="condition-list">
                  {regionRisk.data?.latestWeather ? (
                    <>
                      <div className="condition">
                        <div>
                          <b>তাপমাত্রা</b>
                        </div>
                        <strong>
                          {regionRisk.data.latestWeather.tempMeanC ?? "—"}°C
                        </strong>
                      </div>
                      <div className="condition">
                        <div>
                          <b>আর্দ্রতা</b>
                        </div>
                        <strong>
                          {regionRisk.data.latestWeather.humidityPct ?? "—"}%
                        </strong>
                      </div>
                    </>
                  ) : (
                    <p>আবহাওয়ার কোনো তথ্য পাওয়া যায়নি।</p>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      ) : null}
    </main>
  );
}
