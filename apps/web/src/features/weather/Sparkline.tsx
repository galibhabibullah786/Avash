import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { scaleSparklinePoints, type SparklinePoint } from './sparklineMath';

interface SparklineProps {
  points: SparklinePoint[];
  label: string;
}

/**
 * Sparkline component using recharts.
 */
export function Sparkline({ points, label }: SparklineProps) {
  const scaled = scaleSparklinePoints(points ?? []);

  if (scaled.points.length === 0) {
    return (
      <figure className="sparkline" data-testid="weather-sparkline">
        <figcaption className="sparkline__caption">
          {label}: {scaled.trendSummary}
        </figcaption>
      </figure>
    );
  }

  const ariaLabel = `${label}: ${scaled.trendSummary}`;

  // Recharts handles its own scaling, so we pass the unscaled data with y-values.
  // We still use scaleSparklinePoints to get the accessible trend summary.
  const chartData = (points ?? []).filter((p) => p.y !== null);

  return (
    <figure className="sparkline" data-testid="weather-sparkline">
      <div style={{ width: '100%', height: '250px', maxWidth: '600px', margin: '0 auto' }} aria-label={ariaLabel} role="img">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border, #e2e8f0)" />
            <XAxis
              dataKey={chartData.some((p) => p.dayLabel) ? "dayLabel" : "x"}
              tick={{ fill: 'var(--color-text-muted, #64748b)', fontSize: 12 }}
              axisLine={{ stroke: 'var(--color-border, #e2e8f0)' }}
              tickLine={false}
              tickFormatter={(val) => typeof val === 'number' ? `দিন ${val + 1}` : String(val)}
            />
            <YAxis
              tick={{ fill: 'var(--color-text-muted, #64748b)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              domain={['auto', 'auto']}
              unit="°"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--color-surface, #ffffff)',
                border: '1px solid var(--color-border, #e2e8f0)',
                borderRadius: '8px',
                color: 'var(--color-text, #0f172a)',
              }}
              itemStyle={{ color: 'var(--color-primary, #0f766e)' }}
              formatter={(value: unknown) => [`${Number(value).toFixed(1)}°C`, 'তাপমাত্রা']}
              labelFormatter={(label) => typeof label === 'string' && label ? label : `দিন ${Number(label) + 1}`}
            />
            <Legend
              height={36}
              wrapperStyle={{ fontSize: '14px', color: 'var(--color-text-muted, #64748b)' }}
            />
            <Line
              name="গড় তাপমাত্রা"
              type="monotone"
              dataKey="y"
              stroke="var(--color-primary, #0f766e)"
              strokeWidth={2}
              dot={
                chartData.length === 1
                  ? { r: 4, fill: 'var(--color-primary, #0f766e)' }
                  : { r: 3, fill: 'var(--color-surface, #ffffff)', stroke: 'var(--color-primary, #0f766e)', strokeWidth: 2 }
              }
              activeDot={{ r: 5, fill: 'var(--color-primary, #0f766e)', stroke: 'none' }}
              isAnimationActive={true}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sparkline__caption">{label}</figcaption>
    </figure>
  );
}
