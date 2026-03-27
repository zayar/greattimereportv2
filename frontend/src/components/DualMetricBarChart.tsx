type Row = {
  label: string;
  primary: number;
  secondary: number;
};

type Props = {
  items: Row[];
  primaryLabel: string;
  secondaryLabel: string;
  formatPrimary?: (n: number) => string;
  formatSecondary?: (n: number) => string;
};

export function DualMetricBarChart({
  items,
  primaryLabel,
  secondaryLabel,
  formatPrimary = (n) => n.toLocaleString("en-US"),
  formatSecondary = (n) => n.toLocaleString("en-US"),
}: Props) {
  const maxPrimary = Math.max(...items.map((item) => item.primary), 1);
  const maxSecondary = Math.max(...items.map((item) => item.secondary), 1);

  return (
    <div className="dual-bar-chart">
      <div className="dual-bar-chart__legend" aria-hidden>
        <span className="dual-bar-chart__swatch dual-bar-chart__swatch--primary" />
        <span>{primaryLabel}</span>
        <span className="dual-bar-chart__swatch dual-bar-chart__swatch--secondary" />
        <span>{secondaryLabel}</span>
      </div>
      <div className="dual-bar-chart__grid">
        {items.map((item) => (
          <div className="dual-bar-chart__item" key={item.label}>
            <div className="dual-bar-chart__pair">
              <div className="dual-bar-chart__bar-wrap">
                <div
                  className="dual-bar-chart__bar dual-bar-chart__bar--primary"
                  style={{ height: `${Math.max(10, (item.primary / maxPrimary) * 100)}%` }}
                  title={`${primaryLabel}: ${formatPrimary(item.primary)}`}
                />
              </div>
              <div className="dual-bar-chart__bar-wrap">
                <div
                  className="dual-bar-chart__bar dual-bar-chart__bar--secondary"
                  style={{ height: `${Math.max(10, (item.secondary / maxSecondary) * 100)}%` }}
                  title={`${secondaryLabel}: ${formatSecondary(item.secondary)}`}
                />
              </div>
            </div>
            <div className="dual-bar-chart__caption">
              <strong>{item.label}</strong>
              <span className="dual-bar-chart__metric dual-bar-chart__metric--primary">{formatPrimary(item.primary)}</span>
              <span className="dual-bar-chart__metric dual-bar-chart__metric--secondary">{formatSecondary(item.secondary)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
