import type { AiRevenueAction } from "../../../../types/domain";

type ScoreBand = "high" | "medium" | "low";

type InsightRow = {
  label: string;
  value: string;
  helper?: string;
};

type TimelineItem = {
  label: string;
  value: string;
  helper?: string;
};

function text(value: string | number | null | undefined) {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

function numberValue(value: number | null | undefined) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function formatNumber(value: number | null | undefined) {
  return Math.round(value ?? 0).toLocaleString("en-US");
}

function formatMoney(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  return amount > 0 ? `${Math.round(amount).toLocaleString("en-US")} MMK` : "Not available";
}

function titleCase(value: string | null | undefined) {
  return text(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function findEvidence(action: AiRevenueAction, labels: string[]) {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  return action.evidence.find((item) => normalizedLabels.includes(item.label.toLowerCase()))?.value;
}

function daysSinceLastVisit(action: AiRevenueAction) {
  const directValue =
    findEvidence(action, ["Days since last visit", "Days since activity", "Days since last usage"]) ??
    null;
  const numeric = Number(directValue);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.round(numeric);
  }

  const lastDate = action.service.lastVisitDate ?? action.packageInfo.lastUsedAt;
  if (!lastDate) {
    return null;
  }

  const parsed = new Date(`${lastDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const today = new Date();
  return Math.max(0, Math.round((today.getTime() - parsed.getTime()) / 86_400_000));
}

function purchasedUnits(action: AiRevenueAction) {
  return numberValue(action.packageInfo.purchasedUnits) || Number(findEvidence(action, ["Purchased sessions"]) ?? 0);
}

function usedUnits(action: AiRevenueAction) {
  return numberValue(action.packageInfo.usedUnits) || Number(findEvidence(action, ["Used sessions"]) ?? 0);
}

function remainingUnits(action: AiRevenueAction) {
  return numberValue(action.packageInfo.remainingUnits) || Number(findEvidence(action, ["Remaining sessions", "Remaining package sessions"]) ?? 0);
}

function purchaseDate(action: AiRevenueAction) {
  return text(findEvidence(action, ["Purchase date", "Package purchase date", "Purchased date"]));
}

function lastUsageDate(action: AiRevenueAction) {
  return text(action.packageInfo.lastUsedAt ?? action.service.lastVisitDate ?? findEvidence(action, ["Last usage date", "Last visit date"]));
}

function totalSpend(action: AiRevenueAction) {
  const lifetimeSpend = findEvidence(action, ["Lifetime spend", "Total spending", "Total spend"]);
  const averageSpend = findEvidence(action, ["Average spend"]);
  return text(lifetimeSpend || averageSpend);
}

export function getReturnScore(action: AiRevenueAction): {
  band: ScoreBand;
  label: string;
  description: string;
} {
  const remaining = remainingUnits(action);
  const inactiveDays = daysSinceLastVisit(action) ?? 0;
  const purchased = purchasedUnits(action);
  const hasPackageHistory = remaining > 0 || purchased > 0;
  const customerValue = totalSpend(action);
  let score = action.priorityScore;

  if (remaining > 0) {
    score += remaining >= 3 ? 18 : 12;
  }
  if (hasPackageHistory) {
    score += 8;
  }
  if (inactiveDays >= 30 && inactiveDays <= 180) {
    score += 8;
  }
  if (inactiveDays > 365) {
    score -= 12;
  }
  if (customerValue) {
    score += 6;
  }

  if (score >= 82) {
    return {
      band: "high",
      label: "High chance to return",
      description: "Strong follow-up candidate based on remaining balance, timing, or customer value.",
    };
  }

  if (score >= 55) {
    return {
      band: "medium",
      label: "Medium chance",
      description: "Worth contacting after checking customer context.",
    };
  }

  return {
    band: "low",
    label: "Low chance",
    description: "Use a softer follow-up or wait for a better timing signal.",
  };
}

export function buildBusinessReasons(action: AiRevenueAction) {
  const reasons = new Set<string>();
  const remaining = remainingUnits(action);
  const inactiveDays = daysSinceLastVisit(action);

  if (action.actionType === "service_reminder_overdue" || action.actionType === "service_reminder_follow_up") {
    reasons.add("Treatment due");
  }
  if (action.actionType === "unused_package_follow_up" || remaining > 0) {
    reasons.add("Still has remaining sessions");
  }
  if (action.actionType === "appointment_confirmation_reminder") {
    reasons.add("Appointment reminder");
  }
  if (action.actionType === "no_show_recovery") {
    reasons.add("No-show recovery");
  }
  if (action.actionType === "cancelled_appointment_recovery") {
    reasons.add("Cancelled appointment recovery");
  }
  if (action.actionType === "inactive_vip_recovery") {
    reasons.add("High-value customer");
  }
  if ((inactiveDays ?? 0) >= 30) {
    reasons.add("Has not visited for 30+ days");
  }
  if (action.priority === "high" || action.priorityScore >= 75) {
    reasons.add("Likely to repurchase");
  }
  if (text(findEvidence(action, ["Expiry date", "Package expiry date", "Expired date"]))) {
    reasons.add("Package about to expire");
  }

  return [...reasons];
}

export function buildPurchaseSummary(action: AiRevenueAction): InsightRow[] {
  const rows: InsightRow[] = [];
  const packageName = text(action.packageInfo.packageName);
  const serviceName = text(action.service.serviceName);
  const remaining = remainingUnits(action);
  const purchased = purchasedUnits(action);
  const used = usedUnits(action);
  const lastDate = lastUsageDate(action);
  const spend = totalSpend(action);
  const purchasedOn = purchaseDate(action);

  rows.push({
    label: "Purchased services",
    value: serviceName || text(findEvidence(action, ["Service(s)", "Last service", "Service"])) || "Not available",
  });
  rows.push({
    label: "Purchased packages",
    value: packageName || "Not available",
  });
  rows.push({
    label: "Remaining sessions",
    value: purchased > 0 ? `${formatNumber(remaining)} / ${formatNumber(purchased)}` : `${formatNumber(remaining)}`,
    helper: used > 0 ? `${formatNumber(used)} already used` : undefined,
  });
  rows.push({
    label: "Purchase date",
    value: purchasedOn || "Not available",
  });
  rows.push({
    label: "Last visit",
    value: lastDate || "Not available",
    helper: daysSinceLastVisit(action) != null ? `${formatNumber(daysSinceLastVisit(action))} days ago` : undefined,
  });
  rows.push({
    label: "Total spending",
    value: spend || formatMoney(action.revenue.actualRevenue || action.revenue.influencedRevenue),
  });

  return rows;
}

export function buildUsageTimeline(action: AiRevenueAction): TimelineItem[] {
  const timeline: TimelineItem[] = [];
  const purchased = purchasedUnits(action);
  const used = usedUnits(action);
  const remaining = remainingUnits(action);
  const purchasedOn = purchaseDate(action);
  const lastDate = lastUsageDate(action);
  const inactiveDays = daysSinceLastVisit(action);

  if (purchasedOn) {
    timeline.push({
      label: "Package purchased",
      value: purchasedOn,
      helper: purchased > 0 ? `${formatNumber(purchased)} session(s)` : undefined,
    });
  }
  if (lastDate) {
    timeline.push({
      label: "Last usage",
      value: lastDate,
      helper: inactiveDays != null ? `${formatNumber(inactiveDays)} days since last usage` : undefined,
    });
  }
  if (purchased > 0 || used > 0 || remaining > 0) {
    timeline.push({
      label: "Current balance",
      value: `${formatNumber(remaining)} remaining`,
      helper: purchased > 0 ? `${formatNumber(used)} used of ${formatNumber(purchased)}` : undefined,
    });
  }

  return timeline;
}

export function quickAnswer(action: AiRevenueAction) {
  const remaining = remainingUnits(action);
  const serviceName = text(action.service.serviceName) || text(findEvidence(action, ["Last service", "Service"])) || "their service";
  const inactiveDays = daysSinceLastVisit(action);

  if (remaining > 0) {
    return `Contact now: ${action.customer.customerName ?? "this customer"} still has ${formatNumber(remaining)} session(s) remaining for ${serviceName}.`;
  }
  if (inactiveDays != null && inactiveDays >= 30) {
    return `Contact now: last visit was ${formatNumber(inactiveDays)} days ago for ${serviceName}.`;
  }
  return action.summary || `Contact about ${serviceName}.`;
}

export function AiOpportunityScoreBadge({ action }: { action: AiRevenueAction }) {
  const score = getReturnScore(action);

  return (
    <div className={`ai-followup-score ai-followup-score--${score.band}`}>
      <strong>{score.label}</strong>
      <span>{score.description}</span>
    </div>
  );
}

export function AiReasonChips({ action }: { action: AiRevenueAction }) {
  const reasons = buildBusinessReasons(action);

  return (
    <div className="ai-followup-reasons" aria-label="AI recommendation reasons">
      {reasons.map((reason) => (
        <span key={reason}>{reason}</span>
      ))}
    </div>
  );
}

export function AiPurchaseSummary({ action }: { action: AiRevenueAction }) {
  return (
    <div className="ai-followup-summary-grid">
      {buildPurchaseSummary(action).map((row) => (
        <div key={row.label} className="ai-followup-summary-item">
          <span>{row.label}</span>
          <strong>{row.value}</strong>
          {row.helper ? <small>{row.helper}</small> : null}
        </div>
      ))}
    </div>
  );
}

export function AiPackageUsageTimeline({ action }: { action: AiRevenueAction }) {
  const timeline = buildUsageTimeline(action);
  if (timeline.length === 0) {
    return null;
  }

  return (
    <div className="ai-followup-timeline">
      {timeline.map((item) => (
        <div key={`${item.label}-${item.value}`} className="ai-followup-timeline__item">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {item.helper ? <small>{item.helper}</small> : null}
        </div>
      ))}
    </div>
  );
}

export function AiFollowUpSnapshot({ action }: { action: AiRevenueAction }) {
  return (
    <section className="ai-followup-snapshot">
      <div className="ai-followup-snapshot__intro">
        <div>
          <span>AI follow-up recommendation</span>
          <strong>{quickAnswer(action)}</strong>
        </div>
        <AiOpportunityScoreBadge action={action} />
      </div>
      <AiReasonChips action={action} />
      <div className="ai-followup-section">
        <div className="ai-followup-section__header">
          <strong>Customer purchase summary</strong>
          <span>What staff should know before contacting</span>
        </div>
        <AiPurchaseSummary action={action} />
      </div>
      <div className="ai-followup-section">
        <div className="ai-followup-section__header">
          <strong>Package usage timeline</strong>
          <span>Simple behavior pattern from available data</span>
        </div>
        <AiPackageUsageTimeline action={action} />
      </div>
    </section>
  );
}

export { daysSinceLastVisit, remainingUnits, titleCase };
