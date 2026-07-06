import { EmptyState } from "./StatusViews";

export type CustomerUsageHeatmapData = {
  months: string[];
  services: Array<{
    serviceName: string;
    serviceCategory: string;
    counts: number[];
    totalUsage: number;
  }>;
};

type Props = {
  data: CustomerUsageHeatmapData;
};

function heatmapCellBackground(count: number, maxValue: number) {
  if (count <= 0) {
    return "#eef4f7";
  }

  const intensity = Math.min(1, count / maxValue);
  const lightness = 86 - intensity * 28;
  const saturation = 72 + intensity * 10;
  return `hsl(218 ${saturation}% ${lightness}%)`;
}

export function CustomerUsageHeatmap({ data }: Props) {
  if (data.services.length === 0) {
    return (
      <EmptyState
        label="No service usage found"
        detail="Try a different year or widen the overall date range."
      />
    );
  }

  const maxValue = Math.max(
    ...data.services.flatMap((service) => service.counts),
    1,
  );

  return (
    <div className="customer-detail__usage-heatmap">
      <div className="customer-detail__usage-header">
        <div />
        {data.months.map((month) => (
          <span key={month}>{month}</span>
        ))}
      </div>
      <div className="customer-detail__usage-body">
        {data.services.map((service) => (
          <div key={`${service.serviceName}-${service.serviceCategory}`} className="customer-detail__usage-row">
            <div className="customer-detail__usage-service">
              <strong>{service.serviceName}</strong>
              <span>{service.serviceCategory}</span>
            </div>
            {service.counts.map((count, index) => (
              <div
                key={`${service.serviceName}-${data.months[index]}`}
                className="customer-detail__usage-cell"
                title={`${service.serviceName} - ${data.months[index]} - ${count} use${count === 1 ? "" : "s"}`}
                style={{
                  backgroundColor: heatmapCellBackground(count, maxValue),
                }}
              >
                {count > 0 ? count : ""}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
