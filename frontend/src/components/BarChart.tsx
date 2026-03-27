type Item = {
  label: string;
  value: number;
  meta?: string;
  /** When set, shown instead of the raw numeric value (e.g. currency). */
  valueLabel?: string;
};

type Props = {
  items: Item[];
  compact?: boolean;
};

export function BarChart({ items, compact = false }: Props) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);

  return (
    <div className={`bar-chart ${compact ? "bar-chart--compact" : ""}`.trim()}>
      {items.map((item) => (
        <div className="bar-chart__item" key={`${item.label}-${item.meta ?? ""}`}>
          <div className="bar-chart__bar-wrap">
            <div
              className="bar-chart__bar"
              style={{ height: `${Math.max(8, (item.value / maxValue) * 100)}%` }}
            />
          </div>
          <div className="bar-chart__legend">
            <strong>{item.label}</strong>
            <span>{item.valueLabel ?? item.value.toLocaleString("en-US")}</span>
            {item.meta ? <small>{item.meta}</small> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

