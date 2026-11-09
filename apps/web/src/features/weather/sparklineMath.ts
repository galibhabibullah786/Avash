export interface SparklinePoint {
  x: number;
  y: number | null;
  dayLabel?: string;
}

export interface ScaledPoint {
  x: number;
  y: number;
}

export interface SparklineScale {
  /** Points with a non-null `y`, scaled into the viewBox. Empty when every value is null. */
  points: ScaledPoint[];
  /** Human-readable trend summary for the `aria-label`. */
  trendSummary: string;
}

const VIEW_WIDTH = 200;
const VIEW_HEIGHT = 50;
const PADDING = 4;

/**
 * Pure scaling function for the sparkline SVG. Handles the four degenerate
 * cases explicitly: empty input, a single point, an all-null series, and a
 * flat series (min === max, which would otherwise divide by zero).
 */
export function scaleSparklinePoints(points: SparklinePoint[]): SparklineScale {
  const withValues = (points ?? []).filter(
    (point): point is { x: number; y: number } => typeof point?.y === 'number',
  );

  if (withValues.length === 0) {
    return { points: [], trendSummary: 'No data available' };
  }

  const xs = withValues.map((point) => point.x);
  const ys = withValues.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = maxX - minX;
  const spanY = maxY - minY;

  const scaleX = (x: number) => (spanX === 0 ? VIEW_WIDTH / 2 : PADDING + ((x - minX) / spanX) * (VIEW_WIDTH - 2 * PADDING));
  const scaleY = (y: number) =>
    spanY === 0
      ? VIEW_HEIGHT / 2
      : VIEW_HEIGHT - PADDING - ((y - minY) / spanY) * (VIEW_HEIGHT - 2 * PADDING);

  const scaled = withValues.map((point) => ({ x: scaleX(point.x), y: scaleY(point.y) }));

  const trendSummary = describeTrend(withValues.map((point) => point.y));

  return { points: scaled, trendSummary };
}

function describeTrend(values: number[]): string {
  if (values.length === 1) {
    return `Single value: ${values[0]?.toFixed(1) ?? ''}`;
  }
  const first = values[0];
  const last = values[values.length - 1];
  if (first === undefined || last === undefined) {
    return 'No data available';
  }
  const delta = last - first;
  if (Math.abs(delta) < 0.01) {
    return `Flat trend, around ${first.toFixed(1)}`;
  }
  const direction = delta > 0 ? 'up' : 'down';
  return `Trending ${direction} from ${first.toFixed(1)} to ${last.toFixed(1)}`;
}
