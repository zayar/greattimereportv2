import type { CSSProperties } from "react";
import { formatCurrency, formatDate, formatDateTime } from "../../../utils/format";
import type { SalesDocumentConfig } from "./salesDocumentConfig";
import type { SalesDocumentModel } from "./salesDocumentModel";

type Props = {
  model: SalesDocumentModel;
  config: SalesDocumentConfig;
  previewLabel?: string;
};

function buildStatusClass(value: string | null | undefined) {
  const normalized = (value ?? "").toUpperCase();

  if (normalized === "PAID" || normalized === "ACTIVE") {
    return "sales-paper__status sales-paper__status--positive";
  }

  if (normalized === "PARTIAL_PAID") {
    return "sales-paper__status sales-paper__status--attention";
  }

  return "sales-paper__status sales-paper__status--neutral";
}

function shouldShowStatus(value: string | null | undefined) {
  const normalized = (value ?? "").toUpperCase();
  return normalized !== "" && normalized !== "ACTIVE" && normalized !== "PAID";
}

export function SalesDocumentPreview({ model, config, previewLabel = "Paper preview" }: Props) {
  const showAdjustmentColumn = model.items.some((item) => item.adjustmentLabel);
  const visibleStatuses = [model.status, model.paymentStatus].filter(shouldShowStatus);
  const accentStyle = {
    ["--sales-document-accent" as const]: config.accentColor,
    ["--sales-items-accent" as const]: config.itemsAccentColor,
  } as CSSProperties;

  return (
    <article
      className={`sales-paper sales-paper--${config.paperTone} sales-paper--${config.density} sales-paper--${config.headerLayout}`}
      style={accentStyle}
    >
      <div className="sales-paper__topbar" />

      <header className="sales-paper__header">
        <div className="sales-paper__identity">
          {config.showClinicLogo && model.clinic.logoUrl ? (
            <div className="sales-paper__logo-wrap">
              <img className="sales-paper__logo" src={model.clinic.logoUrl} alt={`${model.clinic.name} logo`} />
            </div>
          ) : null}
          <span className="sales-paper__eyebrow">{previewLabel}</span>
          <h2>{config.documentTitle}</h2>
          <p>{config.documentSubtitle}</p>

          <div className="sales-paper__brand-lockup">
            <div>
              <strong>{model.clinic.name}</strong>
              {config.showClinicContact ? (
                <>
                  {model.clinic.address ? <span>{model.clinic.address}</span> : null}
                  {model.clinic.phone ? <span>{model.clinic.phone}</span> : null}
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="sales-paper__meta">
          <div className="sales-paper__meta-card">
            <span>Invoice Number</span>
            <strong>{model.invoiceNumber}</strong>
          </div>
          <div className="sales-paper__meta-card">
            <span>Issued At</span>
            <strong>{formatDateTime(model.createdAt)}</strong>
          </div>
          {visibleStatuses.length > 0 ? (
            <div className="sales-paper__meta-statuses">
              {visibleStatuses.map((status) => (
                <span key={status} className={buildStatusClass(status)}>
                  {status?.split("_").join(" ")}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <section className="sales-paper__info-grid">
        <div className="sales-paper__info-card">
          <span className="sales-paper__section-label">Customer / Member</span>
          <strong>{model.customer.name}</strong>
          <span>Member ID: {model.customer.memberId}</span>
          {config.showMemberPhone && model.customer.phone ? <span>{model.customer.phone}</span> : null}
        </div>

        {config.showSeller ? (
          <div className="sales-paper__info-card">
            <span className="sales-paper__section-label">Sales Team</span>
            <strong>{model.salesperson || "Not assigned"}</strong>
            <span>Sold by: {model.soldBy || "—"}</span>
            <span>Payment method: {model.paymentMethod || "—"}</span>
          </div>
        ) : null}

        <div className="sales-paper__info-card">
          <span className="sales-paper__section-label">Amount Summary</span>
          <strong>{formatCurrency(model.summary.netTotal, model.currency)}</strong>
          <span>Paid: {formatCurrency(model.summary.paidAmount, model.currency)}</span>
          <span>Balance due: {formatCurrency(model.summary.balanceDue, model.currency)}</span>
        </div>
      </section>

      <section className="sales-paper__body">
        <div className="sales-paper__table-block">
          <div className="sales-paper__table-header">
            <span className="sales-paper__section-label">Line Items</span>
            <strong>{model.items.length.toLocaleString("en-US")} items</strong>
          </div>

          <table className="sales-paper__table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Qty</th>
                <th>Unit Price</th>
                {showAdjustmentColumn ? <th>Adjustment</th> : null}
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {model.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="sales-paper__item-main">
                      <strong>{item.name}</strong>
                      {item.detail ? <span>{item.detail}</span> : null}
                    </div>
                  </td>
                  <td>{item.quantity.toLocaleString("en-US")}</td>
                  <td>{formatCurrency(item.unitPrice, model.currency)}</td>
                  {showAdjustmentColumn ? <td>{item.adjustmentLabel || "—"}</td> : null}
                  <td>{formatCurrency(item.total, model.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="sales-paper__summary-panel">
          <span className="sales-paper__section-label">Totals</span>

          <div className="sales-paper__summary-row">
            <span>Subtotal</span>
            <strong>{formatCurrency(model.summary.subtotal, model.currency)}</strong>
          </div>
          <div className="sales-paper__summary-row">
            <span>Discount</span>
            <strong>{formatCurrency(model.summary.discount, model.currency)}</strong>
          </div>
          <div className="sales-paper__summary-row">
            <span>Tax</span>
            <strong>{formatCurrency(model.summary.tax, model.currency)}</strong>
          </div>
          <div className="sales-paper__summary-row sales-paper__summary-row--total">
            <span>Net total</span>
            <strong>{formatCurrency(model.summary.netTotal, model.currency)}</strong>
          </div>
          <div className="sales-paper__summary-row">
            <span>Paid amount</span>
            <strong>{formatCurrency(model.summary.paidAmount, model.currency)}</strong>
          </div>
          <div className="sales-paper__summary-row">
            <span>Outstanding</span>
            <strong>{formatCurrency(model.summary.balanceDue, model.currency)}</strong>
          </div>

          {config.showPaymentDetails && model.payments.length > 0 ? (
            <div className="sales-paper__payments">
              <span className="sales-paper__section-label">Payments</span>
              {model.payments.map((payment) => (
                <div key={payment.id} className="sales-paper__payment-row">
                  <div>
                    <strong>{payment.label}</strong>
                    {payment.date ? <span>{formatDate(payment.date)}</span> : null}
                    {payment.note ? <span>{payment.note}</span> : null}
                  </div>
                  <strong>{formatCurrency(payment.amount, model.currency)}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </aside>
      </section>

      {config.showNotes && model.notes ? (
        <section className="sales-paper__note-block">
          <span className="sales-paper__section-label">Notes / Instructions</span>
          <p>{model.notes}</p>
        </section>
      ) : null}

      {config.showFooterNote && config.footerNote.trim() !== "" ? (
        <footer className="sales-paper__footer">
          <p>{config.footerNote}</p>
        </footer>
      ) : null}
    </article>
  );
}
