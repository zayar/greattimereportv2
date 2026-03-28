type Point = {
  label: string;
  value: number;
  compareValue?: number;
};

type Props = {
  points: Point[];
  valueFormatter?: (value: number) => string;
  showComparison?: boolean;
};

const CHART_WIDTH = 960;
const CHART_HEIGHT = 280;
const PADDING_X = 28;
const PADDING_TOP = 18;
const PADDING_BOTTOM = 38;
const PADDING_Y = 26;

function buildLinePath(
  points: Array<{ x: number; y: number }>,
  baselineY: number,
  closeArea: boolean,
) {
  if (points.length === 0) {
    return "";
  }

  const [first, ...rest] = points;
  const commands = [`M ${first.x} ${first.y}`];

  for (const point of rest) {
    commands.push(`L ${point.x} ${point.y}`);
  }

  if (!closeArea) {
    return commands.join(" ");
  }

  commands.push(`L ${points[points.length - 1].x} ${baselineY}`);
  commands.push(`L ${first.x} ${baselineY}`);
  commands.push("Z");

  return commands.join(" ");
}

export function TrendAreaChart({ points, valueFormatter, showComparison = true }: Props) {
  if (points.length === 0) {
    return <div className="trend-chart trend-chart--empty">No trend data for the selected period.</div>;
  }

  const maxValue = Math.max(
    1,
    ...points.map((point) => point.value),
    ...(showComparison ? points.map((point) => point.compareValue ?? 0) : [0]),
  );
  const chartInnerWidth = CHART_WIDTH - PADDING_X * 2;
  const chartInnerHeight = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const baselineY = CHART_HEIGHT - PADDING_BOTTOM;
  const step = points.length === 1 ? 0 : chartInnerWidth / (points.length - 1);

  const currentPoints = points.map((point, index) => ({
    x: PADDING_X + step * index,
    y: baselineY - (point.value / maxValue) * (chartInnerHeight - PADDING_Y),
  }));

  const comparePoints = points.map((point, index) => ({
    x: PADDING_X + step * index,
    y: baselineY - ((point.compareValue ?? 0) / maxValue) * (chartInnerHeight - PADDING_Y),
  }));

  const currentPath = buildLinePath(currentPoints, baselineY, false);
  const areaPath = buildLinePath(currentPoints, baselineY, true);
  const comparePath = buildLinePath(comparePoints, baselineY, false);
  const activePoint = points[points.length - 1];

  return (
    <div className="trend-chart">
      <div className="trend-chart__legend">
        <div className="trend-chart__legend-item">
          <span className="trend-chart__swatch trend-chart__swatch--current" />
          <span>Revenue</span>
        </div>
        {showComparison ? (
          <div className="trend-chart__legend-item">
            <span className="trend-chart__swatch trend-chart__swatch--compare" />
            <span>Previous period</span>
          </div>
        ) : null}
        <strong>{valueFormatter ? valueFormatter(activePoint.value) : activePoint.value.toLocaleString("en-US")}</strong>
      </div>

      <svg className="trend-chart__svg" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="trend-area-fill" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = PADDING_TOP + ratio * (chartInnerHeight - PADDING_Y);
          return (
            <line
              key={ratio}
              x1={PADDING_X}
              x2={CHART_WIDTH - PADDING_X}
              y1={y}
              y2={y}
              className="trend-chart__grid-line"
            />
          );
        })}

        <path d={areaPath} className="trend-chart__area" />
        {showComparison ? <path d={comparePath} className="trend-chart__line trend-chart__line--compare" /> : null}
        <path d={currentPath} className="trend-chart__line trend-chart__line--current" />

        {currentPoints.map((point, index) => (
          <circle key={`${points[index].label}-${index}`} cx={point.x} cy={point.y} r="4" className="trend-chart__dot" />
        ))}

        {points.map((point, index) => {
          const x = PADDING_X + step * index;
          return (
            <text key={`${point.label}-label`} x={x} y={CHART_HEIGHT - 10} textAnchor="middle" className="trend-chart__label">
              {point.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
