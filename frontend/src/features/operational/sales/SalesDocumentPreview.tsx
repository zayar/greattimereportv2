import type { CSSProperties } from "react";
import { formatCurrency, formatDate, formatDateTime } from "../../../utils/format";
import type {
  SalesDocumentConfig,
  SalesDocumentMarginPreset,
  SalesDocumentOrientation,
  SalesDocumentPaperSize,
} from "./salesDocumentConfig";
import type { SalesDocumentModel } from "./salesDocumentModel";

type Props = {
  model: SalesDocumentModel;
  config: SalesDocumentConfig;
  previewLabel?: string;
};

function shouldShowStatus(value: string | null | undefined) {
  const normalized = (value ?? "").toUpperCase();
  return normalized !== "" && normalized !== "ACTIVE" && normalized !== "PAID";
}

function formatStatus(value: string | null | undefined) {
  return (value ?? "").split("_").join(" ");
}

function getPaperWidth(paperSize: SalesDocumentPaperSize, orientation: SalesDocumentOrientation) {
  if (paperSize === "Letter" && orientation === "landscape") {
    return "1120px";
  }

  if (paperSize === "Letter") {
    return "860px";
  }

  if (orientation === "landscape") {
    return "1160px";
  }

  return "880px";
}

function getMarginPadding(marginPreset: SalesDocumentMarginPreset) {
  if (marginPreset === "narrow") {
    return {
      horizontal: "28px",
      vertical: "24px",
    };
  }

  if (marginPreset === "wide") {
    return {
      horizontal: "48px",
      vertical: "42px",
    };
  }

  return {
    horizontal: "38px",
    vertical: "32px",
  };
}

export function SalesDocumentPreview({ model, config, previewLabel }: Props) {
  const showAdjustmentColumn = model.items.some((item) => item.adjustmentLabel);
  const visibleStatuses = [
    shouldShowStatus(model.status) ? { label: "Status", value: formatStatus(model.status) } : null,
    shouldShowStatus(model.paymentStatus) ? { label: "Payment status", value: formatStatus(model.paymentStatus) } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  const supportMeta = config.showSeller
    ? [
        model.salesperson ? `Advisor: ${model.salesperson}` : null,
        model.soldBy ? `Sold by: ${model.soldBy}` : null,
        model.paymentMethod ? `Payment: ${model.paymentMethod}` : null,
      ].filter(Boolean)
    : [];
  const paymentSummaries = model.payments.map((payment) => {
    const primary = [payment.label ? `Paid via ${payment.label}` : "Payment recorded", formatCurrency(payment.amount, model.currency)].join(
      " · ",
    );
    const secondary = [payment.date ? formatDate(payment.date) : null, payment.note].filter(Boolean).join(" · ");

    return {
      id: payment.id,
      primary,
      secondary: secondary || null,
    };
  });
  const padding = getMarginPadding(config.marginPreset);
  const accentStyle = {
    ["--sales-document-accent" as const]: config.accentColor,
    ["--sales-header-text" as const]: config.headerTextColor,
    ["--sales-items-accent" as const]: config.itemsAccentColor,
    ["--sales-paper-width" as const]: getPaperWidth(config.paperSize, config.orientation),
    ["--sales-paper-padding-x" as const]: padding.horizontal,
    ["--sales-paper-padding-y" as const]: padding.vertical,
  } as CSSProperties;

  return (
    <article
      className={`sales-paper sales-paper--${config.paperTone} sales-paper--${config.density} sales-paper--${config.headerLayout} sales-paper--${config.orientation}`}
      style={accentStyle}
    >
      <div className="sales-paper__topbar" />

      <header className="sales-paper__header sales-paper__header--classic">
        <div className="sales-paper__brand">
          {config.showClinicLogo && model.clinic.logoUrl ? (
            <div className="sales-paper__logo-wrap">
              <img className="sales-paper__logo" src={model.clinic.logoUrl} alt={`${model.clinic.name} logo`} />
            </div>
          ) : null}

          <div className="sales-paper__brand-copy">
            {previewLabel ? <span className="sales-paper__eyebrow">{previewLabel}</span> : null}
            <strong className="sales-paper__clinic-name">{model.clinic.name}</strong>
            {config.showClinicContact ? (
              <>
                {model.clinic.address ? <span>{model.clinic.address}</span> : null}
                {model.clinic.phone ? <span>{model.clinic.phone}</span> : null}
              </>
            ) : null}
          </div>
        </div>

        <div className="sales-paper__document-head">
          <h2 className="sales-paper__document-title">{config.documentTitle}</h2>

          <dl className="sales-paper__meta-list">
            <div className="sales-paper__meta-item">
              <dt>Invoice Number</dt>
              <dd>{model.invoiceNumber}</dd>
            </div>
            <div className="sales-paper__meta-item">
              <dt>Invoice Date</dt>
              <dd>{formatDateTime(model.createdAt)}</dd>
            </div>
            {visibleStatuses.map((status) => (
              <div key={status.label} className="sales-paper__meta-item">
                <dt>{status.label}</dt>
                <dd>{status.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      <section className="sales-paper__party-row">
        <div className="sales-paper__billto">
          <span className="sales-paper__section-label">Customer / Bill To</span>
          <div className="sales-paper__billto-body">
            <strong>{model.customer.name}</strong>
            <span>Member ID: {model.customer.memberId}</span>
            {config.showMemberPhone && model.customer.phone ? <span>{model.customer.phone}</span> : null}
          </div>
        </div>

        {supportMeta.length > 0 ? (
          <div className="sales-paper__support-meta">
            {supportMeta.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        ) : null}
      </section>

      {config.showItemsTable ? (
        <section className="sales-paper__items-section">
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
        </section>
      ) : null}

      <section className="sales-paper__bottom">
        <div className="sales-paper__summary-wrap">
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
              <span>Total</span>
              <strong>{formatCurrency(model.summary.netTotal, model.currency)}</strong>
            </div>
            <div className="sales-paper__summary-row">
              <span>Paid</span>
              <strong>{formatCurrency(model.summary.paidAmount, model.currency)}</strong>
            </div>
            <div className="sales-paper__summary-row sales-paper__summary-row--outstanding">
              <span>Outstanding</span>
              <strong>{formatCurrency(model.summary.balanceDue, model.currency)}</strong>
            </div>

            {config.showPaymentDetails && paymentSummaries.length > 0 ? (
              <div className="sales-paper__payment-note">
                <span className="sales-paper__section-label">Payment note</span>
                {paymentSummaries.map((payment) => (
                  <div key={payment.id} className="sales-paper__payment-note-item">
                    <strong>{payment.primary}</strong>
                    {payment.secondary ? <span>{payment.secondary}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </aside>
        </div>

        {config.showNotes && model.notes ? (
          <section className="sales-paper__note-block">
            <span className="sales-paper__section-label">Notes / Instructions</span>
            <p>{model.notes}</p>
          </section>
        ) : null}
      </section>

      {config.showFooterNote && config.footerNote.trim() !== "" ? (
        <footer className="sales-paper__footer">
          <p>{config.footerNote}</p>
        </footer>
      ) : null}
    </article>
  );
}
