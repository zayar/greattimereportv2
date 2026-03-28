type Item = {
  label: string;
  value: number;
  meta?: string;
};

type Props = {
  items: Item[];
  totalLabel?: string;
  centerLabel?: string;
};

const palette = ["#5b67f3", "#8ea7ff", "#7ab7aa", "#f0b353", "#d78bb6", "#8cc1d9", "#c5d7a0", "#9f8cf2"];

export function DonutChart({ items, totalLabel = "Total", centerLabel }: Props) {
  if (items.length === 0) {
    return <div className="donut-chart donut-chart--empty">No payment mix found for this period.</div>;
  }

  const total = items.reduce((sum, item) => sum + item.value, 0);
  const segments = items.map((item, index) => ({
    ...item,
    color: palette[index % palette.length],
    ratio: total === 0 ? 0 : item.value / total,
  }));

  let cursor = 0;
  const background = segments
    .map((item) => {
      const start = cursor * 360;
      cursor += item.ratio;
      const end = cursor * 360;
      return `${item.color} ${start}deg ${end}deg`;
    })
    .join(", ");

  return (
    <div className="donut-chart">
      <div className="donut-chart__visual" style={{ background: `conic-gradient(${background})` }}>
        <div className="donut-chart__center">
          <span>{totalLabel}</span>
          <strong>{centerLabel ?? total.toLocaleString("en-US")}</strong>
        </div>
      </div>

      <div className="donut-chart__legend">
        {segments.map((item) => (
          <div key={item.label} className="donut-chart__legend-row">
            <div className="donut-chart__legend-label">
              <span className="donut-chart__legend-swatch" style={{ backgroundColor: item.color }} />
              <span>{item.label}</span>
            </div>
            <div className="donut-chart__legend-value">
              <strong>{item.value.toLocaleString("en-US")}</strong>
              <small>{total === 0 ? "0%" : `${(item.ratio * 100).toFixed(1)}%`}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
