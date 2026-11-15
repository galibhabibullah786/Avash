import type { RiskDetailResponse } from '@avash/types';
import { RISK_LEVEL_BAND_STYLES } from './riskLevelBands';
import { formatFactor } from './riskFormatters';

interface RiskDetailPanelProps {
  activeRegionName: string;
  isLoading: boolean;
  isError: boolean;
  data: RiskDetailResponse | undefined;
}

export function RiskDetailPanel({
  activeRegionName,
  isLoading,
  isError,
  data,
}: RiskDetailPanelProps) {
  if (isLoading) {
    return (
      <section
        className="analysis-grid max-md:!flex max-md:!flex-col"
        aria-label="Region risk detail"
        data-testid="risk-detail-panel"
        style={{ marginTop: '30px' }}
      >
        <div className="chart-panel">
          <p className="checker-time" data-testid="status-loading">
            এলাকার বিস্তারিত তথ্য লোড হচ্ছে…
          </p>
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section
        className="analysis-grid max-md:!flex max-md:!flex-col"
        aria-label="Region risk detail"
        data-testid="risk-detail-panel"
        style={{ marginTop: '30px' }}
      >
        <div className="chart-panel">
          <p className="alert alert--error" data-testid="status-error">
            এই মুহূর্তে বিস্তারিত তথ্য লোড করা যায়নি।
          </p>
        </div>
      </section>
    );
  }

  const predictions = data?.predictions ?? [];
  const latestWeather = data?.latestWeather;

  return (
    <section
      className="analysis-grid max-md:!flex max-md:!flex-col"
      aria-label="Region risk detail"
      data-testid="risk-detail-panel"
      style={{ marginTop: '30px' }}
    >
      <div className="chart-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">ঝুঁকি পূর্বাভাস</p>
            <h2>{activeRegionName}</h2>
          </div>
        </div>
        <div className="condition-list flex flex-col gap-2">
          {predictions.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)] py-2">
              এই এলাকার জন্য কোনো পূর্বাভাস নেই।
            </p>
          ) : (
            predictions.map((prediction) => {
              const band = RISK_LEVEL_BAND_STYLES[prediction.riskLevel];
              return (
                <div
                  className="condition flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 py-3.5 border-t border-[var(--color-border)] first:border-t-0"
                  key={prediction.horizonWeeks}
                >
                  <div className="min-w-0 flex-1">
                    <b className="block text-sm font-semibold text-[var(--color-heading)] leading-snug">
                      {prediction.horizonWeeks === 2 ? '২ সপ্তাহ' : '৪ সপ্তাহ'} আগাম পূর্বাভাস
                    </b>
                    <small className="block text-xs text-[var(--color-text-muted)] mt-1.5 leading-relaxed break-words">
                      {(prediction.topFactors ?? []).length === 0
                        ? 'কোনো বিশেষ কারণ চিহ্নিত করা যায়নি।'
                        : (prediction.topFactors ?? [])
                            .map((f) => formatFactor(f.feature, f.direction))
                            .join(', ')}
                    </small>
                  </div>
                  <strong
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border border-[var(--color-border)] shadow-xs flex-shrink-0 self-start sm:self-center whitespace-nowrap"
                    style={{
                      backgroundColor: 'var(--color-surface-subtle)',
                      color: band?.fillColor || 'var(--color-text)',
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full inline-block"
                      style={{ backgroundColor: band?.fillColor || 'var(--color-text)' }}
                      aria-hidden="true"
                    />
                    <span>
                      {band?.label ?? prediction.riskLevel} ({(prediction.riskScore * 100).toFixed(0)}%)
                    </span>
                  </strong>
                </div>
              );
            })
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
        <div className="condition-list flex flex-col gap-2">
          {latestWeather ? (
            <>
              <div className="condition flex items-center justify-between py-3 border-t border-[var(--color-border)] first:border-t-0">
                <span className="text-sm font-semibold text-[var(--color-text)]">তাপমাত্রা</span>
                <strong className="text-base font-bold text-[var(--color-heading)] tabular-nums">
                  {latestWeather.tempMeanC ?? '—'}°C
                </strong>
              </div>
              <div className="condition flex items-center justify-between py-3 border-t border-[var(--color-border)]">
                <span className="text-sm font-semibold text-[var(--color-text)]">আর্দ্রতা</span>
                <strong className="text-base font-bold text-[var(--color-heading)] tabular-nums">
                  {latestWeather.humidityPct ?? '—'}%
                </strong>
              </div>
            </>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)] py-2">
              আবহাওয়ার কোনো তথ্য পাওয়া যায়নি।
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
