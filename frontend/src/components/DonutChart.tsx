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

const palette = [
  "#074142",
  "#2d6969",
  "#8f6559",
  "#f9c5b4",
  "#e6c7eb",
  "#5f8c88",
  "#b79f8c",
  "#8b6d92",
];

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
