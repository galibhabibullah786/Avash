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
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border, #263048)" />
            <XAxis
              dataKey="x"
              tick={{ fill: 'var(--color-text-muted, #b8c2d1)', fontSize: 12 }}
              axisLine={{ stroke: 'var(--color-border, #263048)' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'var(--color-text-muted, #b8c2d1)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              domain={['auto', 'auto']}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--color-surface, #131c2e)',
                border: '1px solid var(--color-border, #263048)',
                borderRadius: '8px',
                color: 'var(--color-text, #f5f7fa)',
              }}
              itemStyle={{ color: 'var(--color-primary, #0b6e4f)' }}
              formatter={(value: any) => [`${Number(value).toFixed(1)}°`, 'Temperature']}
              labelFormatter={(label) => `Day ${Number(label) + 1}`}
            />
            <Legend
              verticalAlign="top"
              height={36}
              wrapperStyle={{ fontSize: '14px', color: 'var(--color-text-muted, #b8c2d1)' }}
            />
            <Line
              name="Mean Temperature"
              type="monotone"
              dataKey="y"
              stroke="var(--color-primary, #0b6e4f)"
              strokeWidth={2}
              dot={
                chartData.length === 1
                  ? { r: 4, fill: 'var(--color-primary, #0b6e4f)' }
                  : { r: 3, fill: 'var(--color-surface, #131c2e)', stroke: 'var(--color-primary, #0b6e4f)', strokeWidth: 2 }
              }
              activeDot={{ r: 5, fill: 'var(--color-primary, #0b6e4f)', stroke: 'none' }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sparkline__caption">{label}</figcaption>
    </figure>
  );
}
