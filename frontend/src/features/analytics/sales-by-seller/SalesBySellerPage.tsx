import { useEffect, useState } from "react";
import { fetchSalesBySeller } from "../../../api/analytics";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import { daysAgo, today } from "../../../utils/date";
import { formatCurrency } from "../../../utils/format";
import type { SalesBySellerResponse } from "../../../types/domain";

export function SalesBySellerPage() {
  const { currentClinic } = useAccess();
  const [range, setRange] = useState({
    fromDate: daysAgo(30),
    toDate: today(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SalesBySellerResponse | null>(null);

  useEffect(() => {
    if (!currentClinic) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchSalesBySeller({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
    })
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load seller analytics.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [currentClinic, range.fromDate, range.toDate]);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Analytics"
        title="Sales by seller"
        description="The GT_NewReport sales-by-sales-person idea is preserved here, but the data now comes through guarded backend report endpoints."
        actions={<DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />}
      />

      {error ? <ErrorState label="Seller analytics could not be loaded" detail={error} /> : null}

      <div className="panel-grid panel-grid--split">
        <Panel title="Seller summary" subtitle="Paid invoice totals by seller">
          {loading ? (
            <div className="inline-note">Loading seller totals...</div>
          ) : !data || data.sellers.length === 0 ? (
            <EmptyState label="No seller data found" />
          ) : (
            <DataTable
              rows={data.sellers}
              rowKey={(row) => row.sellerName}
              columns={[
                { key: "seller", header: "Seller", render: (row) => row.sellerName },
                { key: "invoices", header: "Invoices", render: (row) => row.invoiceCount.toLocaleString("en-US") },
                {
                  key: "amount",
                  header: "Total amount",
                  render: (row) => formatCurrency(row.totalAmount, currentClinic?.currency || "MMK"),
                },
              ]}
            />
          )}
        </Panel>

        <Panel title="Recent transactions" subtitle="Latest paid invoice rows in the same date range">
          {!data || data.recentTransactions.length === 0 ? (
            <EmptyState label="No transactions found" />
          ) : (
            <DataTable
              rows={data.recentTransactions}
              rowKey={(row) => `${row.invoiceNumber}-${row.dateLabel}`}
              columns={[
                { key: "date", header: "Date", render: (row) => row.dateLabel },
                { key: "invoice", header: "Invoice", render: (row) => row.invoiceNumber },
                { key: "customer", header: "Customer", render: (row) => row.customerName },
                { key: "seller", header: "Seller", render: (row) => row.sellerName },
                {
                  key: "amount",
                  header: "Amount",
                  render: (row) => formatCurrency(row.totalAmount, currentClinic?.currency || "MMK"),
                },
              ]}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

