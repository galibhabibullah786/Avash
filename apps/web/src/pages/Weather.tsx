import { useMemo, useState } from "react";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useLatestWeather } from "../features/weather/useLatestWeather";
import { useWeatherHistory } from "../features/weather/useWeatherHistory";
import { Sparkline } from "../features/weather/Sparkline";

const HISTORY_WINDOW_DAYS = 7;

function weatherIcon(precipitationMm: number | null | undefined): string {
  if (precipitationMm === null || precipitationMm === undefined) return "☼";
  if (precipitationMm >= 10) return "☂";
  if (precipitationMm > 0) return "☁";
  return "☼";
}

function formatDay(observedAt: string, index: number): string {
  if (index === 0) return "Today";
  const parsed = new Date(observedAt);
  if (Number.isNaN(parsed.getTime())) return observedAt;
  return parsed.toLocaleDateString(undefined, { weekday: "short" });
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export default function Weather() {
  const isOnline = useOnlineStatus();
  const latest = useLatestWeather();

  const observations = latest.data?.observations ?? [];

  const locations = useMemo(() => {
    const seen = new Map<string, string>();
    for (const observation of observations) {
      if (!seen.has(observation.regionCode)) {
        seen.set(observation.regionCode, observation.regionName);
      }
    }
    return Array.from(seen.entries());
  }, [observations]);

  const [selectedRegionCode, setSelectedRegionCode] = useState<string | null>(
    null,
  );
  const activeRegionCode = selectedRegionCode ?? locations[0]?.[0] ?? null;
  const activeRegionName =
    locations.find(([code]) => code === activeRegionCode)?.[1] ?? "—";

  const current = observations.find(
    (observation) => observation.regionCode === activeRegionCode,
  );
  const history = useWeatherHistory(activeRegionCode, HISTORY_WINDOW_DAYS);
  const points = history.data?.points ?? [];

  const sparklinePoints = points.map((point, index) => ({
    x: index,
    y: point?.tempMeanC ?? null,
  }));

  const temps = points
    .map((point) => point.tempMeanC)
    .filter((value): value is number => value !== null);
  const avgTemp = average(temps);
  const totalRainfall = points.reduce(
    (sum, point) => sum + (point.precipitationMm ?? 0),
    0,
  );
  const avgHumidity = average(
    points
      .map((point) => point.humidityPct)
      .filter((value): value is number => value !== null),
  );

  return (
    <main className="inner-page">
      <div className="inner-page__intro">
        <div>
          <p className="eyebrow">Local conditions</p>
          <h1>Weather insight</h1>
          <p className="inner-lede">
            Weather patterns help us understand where dengue risk may rise next.
          </p>
        </div>
        {locations.length > 0 ? (
          <label className="location-select">
            Your location
            <select
              value={activeRegionCode ?? ""}
              onChange={(event) => setSelectedRegionCode(event.target.value)}
            >
              {locations.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {!isOnline ? (
        <p className="alert alert--error" role="alert">
          You are offline
        </p>
      ) : latest.isError ? (
        <p className="alert alert--error" role="alert">
          Unable to load weather data right now. Please try again.
        </p>
      ) : null}

      {latest.isLoading ? (
        <p className="checker-time">Loading weather data…</p>
      ) : null}

      {current ? (
        <section className="weather-current">
          <div className="weather-now">
            <span className="weather-sun">
              {weatherIcon(current.precipitationMm)}
            </span>
            <div>
              <small>Today in {activeRegionName}</small>
              <strong>
                {current.tempMeanC !== null
                  ? `${Math.round(current.tempMeanC)}°`
                  : "—"}
              </strong>
              <span>{current.source ?? "Latest observation"}</span>
            </div>
          </div>
          {[
            [
              "Humidity",
              current.humidityPct !== null
                ? `${Math.round(current.humidityPct)}%`
                : "—",
              "Current",
            ],
            [
              "Rainfall",
              current.precipitationMm !== null
                ? `${current.precipitationMm} mm`
                : "—",
              "Last observation",
            ],
            [
              "Temp range",
              current.tempMinC !== null && current.tempMaxC !== null
                ? `${Math.round(current.tempMinC)}°–${Math.round(current.tempMaxC)}°`
                : "—",
              "Min · Max",
            ],
          ].map(([label, value, note]) => (
            <div className="weather-stat" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{note}</small>
            </div>
          ))}
        </section>
      ) : null}

      <section className="weather-grid max-md:!flex max-md:!flex-col">
        <div className="chart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Past {HISTORY_WINDOW_DAYS} days</p>
              <h2>Recent temperature trend</h2>
            </div>
            <span className="chart-range">
              {activeRegionName} · Updated today
            </span>
          </div>
          <div className="weather-chart">
            <div className="weather-days">
              {points.map((point, index) => (
                <div key={point.observedAt}>
                  <b>{formatDay(point.observedAt, index)}</b>
                  <span>{weatherIcon(point.precipitationMm)}</span>
                  <strong>
                    {point.tempMeanC !== null
                      ? `${Math.round(point.tempMeanC)}°`
                      : "—"}
                  </strong>
                  <small>
                    {point.precipitationMm !== null
                      ? `${point.precipitationMm} mm`
                      : "—"}
                  </small>
                </div>
              ))}
            </div>
            <Sparkline
              points={sparklinePoints}
              label={`${HISTORY_WINDOW_DAYS}-day mean temperature`}
            />
          </div>
        </div>
        <aside className="suitability">
          <p className="eyebrow">Weekly summary</p>
          <h3>{activeRegionName}</h3>
          <p>
            Averages over the last {HISTORY_WINDOW_DAYS} days of observations.
          </p>
          {[
            [
              "Average temperature",
              avgTemp !== null ? `${avgTemp.toFixed(1)}°C` : "—",
            ],
            ["Total rainfall", `${totalRainfall.toFixed(0)} mm`],
            [
              "Average humidity",
              avgHumidity !== null ? `${avgHumidity.toFixed(0)}%` : "—",
            ],
          ].map(([label, value]) => (
            <div className="weather-stat" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </aside>
      </section>
    </main>
  );
}
