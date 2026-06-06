import { DataTable } from "./DataTable";

export type CustomerPackageEvidenceRow = {
  serviceName: string;
  packageName: string | null;
  serviceCategory: string;
  packageTotal: number;
  usedCount: number;
  remainingCount: number;
  latestUsageDate: string | null;
  latestTherapist: string | null;
  status?: string | null;
};

type Props = {
  packages: CustomerPackageEvidenceRow[];
  formatDate: (value: string | null | undefined) => string;
};

function statusTone(status: string | null | undefined) {
  if (status === "Low remaining" || status === "Not started" || status === "Overdue") {
    return "attention";
  }

  if (status === "Active" || status === "Completed") {
    return "positive";
  }

  return "neutral";
}

export function CustomerPackageEvidenceTable({ packages, formatDate }: Props) {
  return (
    <DataTable
      rows={packages}
      rowKey={(row) => `${row.serviceName}-${row.packageName ?? "package"}-${row.packageTotal}-${row.remainingCount}`}
      columns={[
        {
          key: "service",
          header: "Service",
          render: (row) => (
            <div className="customer-detail__metric-cell">
              <strong>{row.serviceName}</strong>
              <span>{row.packageName || row.serviceCategory}</span>
            </div>
          ),
        },
        { key: "category", header: "Category", render: (row) => row.serviceCategory },
        { key: "total", header: "Package total", render: (row) => row.packageTotal.toLocaleString("en-US") },
        { key: "used", header: "Used", render: (row) => row.usedCount.toLocaleString("en-US") },
        { key: "remaining", header: "Remaining", render: (row) => row.remainingCount.toLocaleString("en-US") },
        { key: "latest", header: "Latest usage", render: (row) => formatDate(row.latestUsageDate) },
        { key: "therapist", header: "Therapist", render: (row) => row.latestTherapist || "Unknown" },
        {
          key: "status",
          header: "Status",
          render: (row) => {
            const status = row.status ?? (row.remainingCount > 0 ? "Active" : "Completed");
            return <span className={`status-pill status-pill--${statusTone(status)}`}>{status}</span>;
          },
        },
      ]}
    />
  );
}
