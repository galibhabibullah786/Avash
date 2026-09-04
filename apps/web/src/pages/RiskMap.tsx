import { useRef, useState } from 'react';
import { RISK_MAP_DEFAULT_HORIZON_WEEKS } from '@avash/types';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useLeafletMap } from '../features/map/useLeafletMap';
import { useRiskMap } from '../features/risk/useRiskMap';
import { useDistrictRisk } from '../features/risk/useDistrictRisk';
import { useRegionRisk } from '../features/risk/useRegionRisk';
import { useRiskMapLayer } from '../features/risk/useRiskMapLayer';
import { RISK_LEVEL_BAND_STYLES } from '../features/risk/riskLevelBands';

const HORIZON_OPTIONS: Array<2 | 4> = [2, 4];

export default function RiskMap() {
  const isOnline = useOnlineStatus();
  const [horizonWeeks, setHorizonWeeks] = useState<2 | 4>(RISK_MAP_DEFAULT_HORIZON_WEEKS);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useLeafletMap(containerRef);

  const riskMap = useRiskMap(horizonWeeks);
  const districtRisk = useDistrictRisk(selectedDistrict);
  const regionRisk = useRegionRisk(selectedRegionId, horizonWeeks);

  useRiskMapLayer(
    mapRef,
    riskMap.data,
    (regionId, district) => {
      setSelectedRegionId(regionId);
      setSelectedDistrict(district);
    },
    districtRisk.data,
    selectedDistrict && districtRisk.isLoading
      ? 'loading'
      : selectedDistrict && districtRisk.isError
        ? 'error'
        : districtRisk.data
          ? 'success'
          : 'idle',
  );

  const features = riskMap.data?.features ?? [];

  return (
    <main className="page page--wide">
      <h1 className="page__title">Risk Map</h1>

      <p className="riskmap__provenance-banner" role="status" data-testid="risk-provenance-banner">
        Latest model snapshot: July 19, 2026. Select a district for its probability breakdown.
      </p>

      <div className="riskmap__controls" data-testid="risk-horizon-toggle">
        <span className="riskmap__controls-label">Horizon</span>
        {HORIZON_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={
              option === horizonWeeks
                ? 'riskmap__horizon-btn riskmap__horizon-btn--active'
                : 'riskmap__horizon-btn'
            }
            aria-pressed={option === horizonWeeks}
            onClick={() => setHorizonWeeks(option)}
          >
            {option} weeks
          </button>
        ))}
      </div>

      {!isOnline ? (
        <p className="status-panel__item" data-testid="status-offline">
          You are offline
        </p>
      ) : riskMap.isLoading ? (
        <p className="status-panel__item" data-testid="status-loading">
          <span className="status-panel__skeleton" aria-hidden="true" />
        </p>
      ) : riskMap.isError ? (
        <p className="status-panel__item" data-testid="status-error">
          API: unavailable right now. Please try again later.
        </p>
      ) : features.length === 0 ? (
        <p className="status-panel__item" data-testid="status-empty">
          No risk predictions yet — the prediction pipeline has not run.
        </p>
      ) : (
        <p className="status-panel__item" data-testid="status-success">
          Showing {features.length} region{features.length === 1 ? '' : 's'}.
        </p>
      )}

      <div className="riskmap__layout">
        <div className="riskmap__map" ref={containerRef} data-testid="risk-map-container" />

        <aside className="riskmap__legend" aria-label="Risk level legend" data-testid="risk-legend">
          <h2 className="riskmap__legend-title">Legend</h2>
          <ul className="riskmap__legend-list">
            {[
              { label: 'Low Risk', fillColor: RISK_LEVEL_BAND_STYLES.low.fillColor, weight: RISK_LEVEL_BAND_STYLES.low.weight, dashArray: RISK_LEVEL_BAND_STYLES.low.dashArray },
              { label: 'Medium Risk', fillColor: RISK_LEVEL_BAND_STYLES.moderate.fillColor, weight: RISK_LEVEL_BAND_STYLES.moderate.weight, dashArray: RISK_LEVEL_BAND_STYLES.moderate.dashArray },
              { label: 'High Risk', fillColor: RISK_LEVEL_BAND_STYLES.severe.fillColor, weight: RISK_LEVEL_BAND_STYLES.severe.weight, dashArray: RISK_LEVEL_BAND_STYLES.severe.dashArray },
            ].map((band) => {
              return (
                <li key={band.label} className="riskmap__legend-item">
                  <span
                    className="riskmap__legend-swatch"
                    style={{
                      backgroundColor: band.fillColor,
                      borderWidth: `${band.weight}px`,
                      borderStyle: band.dashArray ? 'dashed' : 'solid',
                    }}
                    aria-hidden="true"
                  />
                  <span className="riskmap__legend-text">{band.label}</span>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>

      {selectedRegionId ? (
        <section className="riskmap__panel" aria-label="Region risk detail" data-testid="risk-detail-panel">
          {regionRisk.isLoading ? (
            <p data-testid="status-loading">Loading region detail…</p>
          ) : regionRisk.isError ? (
            <p data-testid="status-error">Unable to load region detail right now.</p>
          ) : (
            <>
              <h2 className="riskmap__panel-title">{regionRisk.data?.regionName ?? 'Region'}</h2>

              <div className="riskmap__panel-section">
                <h3>Predictions</h3>
                {(regionRisk.data?.predictions ?? []).length === 0 ? (
                  <p>No prediction available for this region.</p>
                ) : (
                  <ul>
                    {(regionRisk.data?.predictions ?? []).map((prediction) => (
                      <li key={prediction.horizonWeeks}>
                        <p>
                          {prediction.horizonWeeks}-week horizon:{' '}
                          {RISK_LEVEL_BAND_STYLES[prediction.riskLevel]?.label ?? prediction.riskLevel}{' '}
                          ({(prediction.riskScore * 100).toFixed(0)}%)
                        </p>
                        {(prediction.topFactors ?? []).length === 0 ? (
                          <p>No factor breakdown available.</p>
                        ) : (
                          <ul>
                            {(prediction.topFactors ?? []).map((factor) => (
                              <li key={factor.feature}>
                                {factor.feature} {factor.direction} risk
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="riskmap__panel-section">
                <h3>Latest weather</h3>
                {regionRisk.data?.latestWeather ? (
                  <p>
                    {regionRisk.data.latestWeather.tempMeanC ?? '—'}°C,{' '}
                    {regionRisk.data.latestWeather.humidityPct ?? '—'}% humidity
                  </p>
                ) : (
                  <p>No weather observations yet.</p>
                )}
              </div>
            </>
          )}
        </section>
      ) : null}
    </main>
  );
}
