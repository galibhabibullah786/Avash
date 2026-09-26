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
  RISK_LEVEL_ORDER,
} from "../features/risk/riskLevelBands";

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
          <p className="eyebrow">District analysis</p>
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
            <h1>Risk Map</h1>
          )}
          <p className="inner-lede">
            A closer look at the signals shaping dengue risk in this district.
          </p>
        </div>
      </div>



      {!isOnline ? (
        <p className="alert alert--error" data-testid="status-offline">
          You are offline
        </p>
      ) : riskMap.isLoading ? (
        <p className="checker-time" data-testid="status-loading">
          Loading map data…
        </p>
      ) : riskMap.isError ? (
        <p className="alert alert--error" data-testid="status-error">
          API: unavailable right now. Please try again later.
        </p>
      ) : features.length === 0 ? (
        <p className="checker-time" data-testid="status-empty">
          No risk predictions yet — the prediction pipeline has not run.
        </p>
      ) : (
        <p
          className="checker-time"
          data-testid="status-success"
          style={{ color: "var(--teal)" }}
        >
          Showing {features.length} region{features.length === 1 ? "" : "s"}.
        </p>
      )}

      <section
        className="analysis-grid risk-map-grid"
        style={{ marginBottom: "30px" }}
      >
        <div className="chart-panel map-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Interactive map</p>
              <h2>Regional risk overview</h2>
            </div>
          </div>
          <div
            className="map-frame"
            ref={containerRef}
            data-testid="risk-map-container"
            style={{ height: "400px", width: "100%" }}
          >
            {riskMap.isLoading ? (
              <p className="map-frame__status">Loading map data…</p>
            ) : null}
          </div>
        </div>

        <div
          className="signals-panel map-legend-panel"
          aria-label="Risk level legend"
          data-testid="risk-legend"
        >
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Legend</p>
              <h2>Risk levels</h2>
            </div>
          </div>
          <ul className="map-legend">
            {RISK_LEVEL_ORDER.map((level) => {
              const band = RISK_LEVEL_BAND_STYLES[level];
              return (
                <li key={level} className="map-legend__item">
                  <i
                    className="map-legend__swatch"
                    style={{
                      backgroundColor: band.fillColor,
                    }}
                    aria-hidden="true"
                  />
                  <span>
                    <b>{band.label}</b>
                    <small>{band.range}</small>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
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
            <span>{option} weeks</span>
            <i>→</i>
          </button>
        ))}
      </section>

      {activeRegionId ? (
        <section
          className="analysis-grid"
          aria-label="Region risk detail"
          data-testid="risk-detail-panel"
          style={{ marginTop: "30px" }}
        >
          {regionRisk.isLoading ? (
            <div className="chart-panel">
              <p className="checker-time" data-testid="status-loading">
                Loading region detail…
              </p>
            </div>
          ) : regionRisk.isError ? (
            <div className="chart-panel">
              <p className="alert alert--error" data-testid="status-error">
                Unable to load region detail right now.
              </p>
            </div>
          ) : (
            <>
              <div className="chart-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Predictions</p>
                    <h2>{activeRegionName}</h2>
                  </div>
                </div>
                <div className="condition-list">
                  {(regionRisk.data?.predictions ?? []).length === 0 ? (
                    <p>No prediction available for this region.</p>
                  ) : (
                    (regionRisk.data?.predictions ?? []).map((prediction) => (
                      <div className="condition" key={prediction.horizonWeeks}>
                        <div>
                          <b>{prediction.horizonWeeks}-week horizon</b>
                          <small>
                            {(prediction.topFactors ?? []).length === 0
                              ? "No factor breakdown available."
                              : (prediction.topFactors ?? [])
                                .map(
                                  (f) => `${f.feature} ${f.direction} risk`,
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
                    <p className="eyebrow">Current conditions</p>
                    <h2>Latest weather</h2>
                  </div>
                </div>
                <div className="condition-list">
                  {regionRisk.data?.latestWeather ? (
                    <>
                      <div className="condition">
                        <div>
                          <b>Temperature</b>
                        </div>
                        <strong>
                          {regionRisk.data.latestWeather.tempMeanC ?? "—"}°C
                        </strong>
                      </div>
                      <div className="condition">
                        <div>
                          <b>Humidity</b>
                        </div>
                        <strong>
                          {regionRisk.data.latestWeather.humidityPct ?? "—"}%
                        </strong>
                      </div>
                    </>
                  ) : (
                    <p>No weather observations yet.</p>
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
