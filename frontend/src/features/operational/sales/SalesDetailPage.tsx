import { useMemo } from "react";
import { useQuery } from "@apollo/client";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { Panel } from "../../../components/Panel";
import { useAccess } from "../../access/AccessProvider";
import { SalesDocumentPreview } from "./SalesDocumentPreview";
import { buildSalesDocumentModel, type RawSalesOrder } from "./salesDocumentModel";
import { buildSalesListPath } from "./salesDetailLink";
import { GET_SALE_DETAIL } from "./queries";
import { useSalesDocumentConfig } from "./useSalesDocumentConfig";

type SalesDetailResponse = {
  orders: RawSalesOrder[];
};

export function SalesDetailPage() {
  const navigate = useNavigate();
  const { saleId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const { currentClinic } = useAccess();
  const { config, loading: configLoading, errorMessage: configError } = useSalesDocumentConfig(currentClinic?.id);

  const where = useMemo(() => {
    if (!saleId || !currentClinic?.id) {
      return undefined;
    }

    return {
      id: { equals: saleId },
      clinic_id: { equals: currentClinic.id },
    };
  }, [currentClinic?.id, saleId]);

  const { data, loading, error } = useQuery<SalesDetailResponse>(GET_SALE_DETAIL, {
    variables: {
      where,
      take: 1,
      clinicMembersWhere2: { clinic_id: { equals: currentClinic?.id } },
    },
    skip: !where,
  });

  const order = data?.orders?.[0] ?? null;
  const documentModel = order ? buildSalesDocumentModel(order, currentClinic?.currency || "MMK") : null;
  const backPath = buildSalesListPath({
    fromDate: searchParams.get("fromDate") ?? "",
    toDate: searchParams.get("toDate") ?? "",
    search: searchParams.get("search") ?? "",
    page: searchParams.get("page") ?? "",
  });

  return (
    <div className="page-stack page-stack--workspace analytics-report sales-document-page">
      <PageHeader
        title="Sales document"
        hideContext
        actions={
          <div className="sales-document-page__actions">
            <button className="button button--secondary" onClick={() => navigate(backPath)}>
              Back to sales list
            </button>
            <button className="button button--ghost" onClick={() => navigate("/settings/sales-document")}>
              Customize layout
            </button>
            <button className="button button--ghost" onClick={() => window.print()} disabled={!order}>
              Print
            </button>
          </div>
        }
      />

      <div className="sales-document-page__context-bar">
        <div className="sales-document-page__context-copy">
          <strong>{order?.order_id || "Sales document preview"}</strong>
          <span>
            {currentClinic?.name || "Clinic"} · Clean paper-style invoice preview with live template settings
          </span>
        </div>
        {configError ? <span className="sales-document-page__hint">Template settings fallback: {configError}</span> : null}
      </div>

      {loading || configLoading ? <div className="inline-note">Loading sales document preview...</div> : null}
      {error ? <ErrorState label="Sales detail could not be loaded" detail={error.message} /> : null}
      {!loading && !error && !order ? (
        <EmptyState
          label="No sales record matched this route"
          detail="The sales record may have moved clinics, or the link may no longer be valid."
        />
      ) : null}

      {documentModel ? (
        <Panel
          className="analytics-report__panel sales-document-page__panel"
          title="Document preview"
          subtitle="A paper-first layout built for on-screen review now and future print/export support."
        >
          <div className="sales-document-page__preview-stage">
            <SalesDocumentPreview model={documentModel} config={config} />
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
