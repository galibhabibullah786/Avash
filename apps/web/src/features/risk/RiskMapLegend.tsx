import {
  RISK_LEVEL_BAND_STYLES,
  RISK_LEVEL_ORDER,
} from './riskLevelBands';

export function RiskMapLegend() {
  return (
    <div
      className="signals-panel map-legend-panel"
      aria-label="Risk level legend"
      data-testid="risk-legend"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">নির্দেশিকা</p>
          <h2>ঝুঁকির মাত্রা</h2>
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
  );
}
