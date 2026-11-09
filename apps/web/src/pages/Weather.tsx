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
  if (index === 0) return "আজ";
  const parsed = new Date(observedAt);
  if (Number.isNaN(parsed.getTime())) return observedAt;
  return parsed.toLocaleDateString("bn-BD", { weekday: "short" });
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
    dayLabel: formatDay(point.observedAt, index),
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
          <p className="eyebrow">স্থানীয় পরিস্থিতি</p>
          <h1>আবহাওয়া ও ডেঙ্গু ঝুঁকি</h1>
          <p className="inner-lede">
            আবহাওয়ার পরিবর্তনের ধরন এডিস মশার প্রজনন ও ডেঙ্গু ঝুঁকি বুঝতে সাহায্য করে।
          </p>
        </div>
        {locations.length > 0 ? (
          <label className="location-select">
            আপনার এলাকা নির্বাচন করুন
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
          আপনি অফলাইনে আছেন
        </p>
      ) : latest.isError ? (
        <p className="alert alert--error" role="alert">
          আবহাওয়া তথ্য লোড করা যায়নি। অনুগ্রহ করে পুনরায় চেষ্টা করুন।
        </p>
      ) : null}

      {latest.isLoading ? (
        <p className="checker-time">আবহাওয়া তথ্য লোড হচ্ছে…</p>
      ) : null}

      {current ? (
        <section className="weather-current">
          <div className="weather-now">
            <span className="weather-sun">
              {weatherIcon(current.precipitationMm)}
            </span>
            <div>
              <small>{activeRegionName}-এ আজকের তাপমাত্রা</small>
              <strong>
                {current.tempMeanC !== null
                  ? `${Math.round(current.tempMeanC)}°`
                  : "—"}
              </strong>
              <span>{current.source ?? "সর্বশেষ পর্যবেক্ষণ"}</span>
            </div>
          </div>
          {[
            [
              "আর্দ্রতা",
              current.humidityPct !== null
                ? `${Math.round(current.humidityPct)}%`
                : "—",
              "বর্তমান",
            ],
            [
              "বৃষ্টিপাত",
              current.precipitationMm !== null
                ? `${current.precipitationMm} মিমি`
                : "—",
              "সর্বশেষ তথ্য",
            ],
            [
              "তাপমাত্রার পরিসীমা",
              current.tempMinC !== null && current.tempMaxC !== null
                ? `${Math.round(current.tempMinC)}°–${Math.round(current.tempMaxC)}°`
                : "—",
              "সর্বনিম্ন · সর্বোচ্চ",
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
              <p className="eyebrow">বিগত {HISTORY_WINDOW_DAYS} দিন</p>
              <h2>সাম্প্রতিক তাপমাত্রার পরিবর্তন</h2>
            </div>
            <span className="chart-range">
              {activeRegionName} · আজকের আপডেট
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
                      ? `${point.precipitationMm} মিমি`
                      : "—"}
                  </small>
                </div>
              ))}
            </div>
            <Sparkline
              points={sparklinePoints}
              label={`${HISTORY_WINDOW_DAYS} দিনের গড় তাপমাত্রা`}
            />
          </div>
        </div>
        <aside className="suitability">
          <p className="eyebrow">সাপ্তাহিক সংক্ষিপ্তসার</p>
          <h3>{activeRegionName}</h3>
          <p>
            বিগত {HISTORY_WINDOW_DAYS} দিনের সংগৃহীত তথ্যের গড় পরিমাপ।
          </p>
          {[
            [
              "গড় তাপমাত্রা",
              avgTemp !== null ? `${avgTemp.toFixed(1)}°C` : "—",
            ],
            ["মোট বৃষ্টিপাত", `${totalRainfall.toFixed(0)} মিমি`],
            [
              "গড় আর্দ্রতা",
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
