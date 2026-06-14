import {
  GT_GROWTH_AI_FEATURE_GATE,
  type ReportAiInsight,
  type ReportAiPayload,
  type ReportAiReportType,
  type ReportNextAction,
} from "../../types/report-ai.js";

type CountItem = {
  label: string;
  count: number;
};

type NamedCountItem = {
  name: string;
  count: number;
};

type AmountCountItem = {
  name: string;
  count: number;
  amount: number;
};

export type AppointmentReportAiInput = {
  dateKey: string;
  totalAppointments: number;
  completedAppointments: number;
  upcomingAppointments: number;
  cancelledAppointments: number;
  noShowAppointments: number;
  cancellationRatePercent: number | null;
  noShowRatePercent: number | null;
  busyHours: CountItem[];
  underutilizedHours: CountItem[];
  topServices: NamedCountItem[];
  therapistLoad: NamedCountItem[];
  completedCustomersWithoutFutureBookingCount: number | null;
  comparison?: {
    previousSameWeekdayAverageAppointments?: number | null;
    previousSameWeekdayAverageNoShowRatePercent?: number | null;
    previousSameWeekdayAverageCancellationRatePercent?: number | null;
  } | null;
};

export type PaymentReportAiInput = {
  dateKey: string;
  totalPaymentAmount: number;
  paymentCount: number;
  paidInvoiceCount: number;
  averageInvoiceValue: number;
  paymentMethods: Array<{ paymentMethod: string; count: number; amount: number }>;
  sellerTotals: Array<{ sellerName: string; count: number; amount: number }>;
  outstandingAmount: number;
  partialPaymentInvoiceCount: number;
  previousDayTotalPaymentAmount: number | null;
  previousDayPaymentCount: number | null;
  revenueByServiceOrPackage: AmountCountItem[];
  refundVoidDiscountAmount: number | null;
};

export type WeeklySummaryReportAiInput = {
  weekStartDateKey: string;
  weekEndDateKey: string;
  weeklyAppointmentCount: number;
  weeklyCompletedAppointments: number;
  weeklyCancelledAppointments: number;
  weeklyNoShowAppointments: number;
  weeklyRevenue: number;
  weekOverWeekRevenueChangePercent: number | null;
  weekOverWeekAppointmentChangePercent: number | null;
  previousWeekRevenue: number | null;
  previousWeekAppointmentCount: number | null;
  previousWeekCancelledAppointments: number | null;
  topServices: NamedCountItem[];
  topTherapists: NamedCountItem[];
  busyDays: CountItem[];
  underutilizedDays: CountItem[];
  underutilizedHours: CountItem[];
  packageSalesSummary: string | null;
  customerRetentionOpportunityCount: number | null;
};

function roundOne(value: number) {
  return Number(value.toFixed(1));
}

export function percentageRate(count: number, total: number) {
  if (total <= 0) {
    return null;
  }

  return roundOne((count / total) * 100);
}

export function percentageChange(current: number, previous: number | null | undefined) {
  if (previous == null || previous <= 0) {
    return null;
  }

  return roundOne(((current - previous) / previous) * 100);
}

function formatPercent(value: number | null | undefined) {
  return value == null ? "Not available" : `${value.toFixed(1)}%`;
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString("en-US")} MMK`;
}

function formatSignedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function buildPayload(params: {
  generatedAt: string;
  summary: string;
  insights: ReportAiInsight[];
  nextActions: ReportNextAction[];
  businessOpportunity: string | null;
  dataQualityNotes: string[];
}): ReportAiPayload {
  return {
    featureGate: GT_GROWTH_AI_FEATURE_GATE,
    isPremiumFeature: true,
    entitlementChecked: false,
    generatedAt: params.generatedAt,
    summary: params.summary,
    insights: params.insights,
    nextActions: params.nextActions,
    businessOpportunity: params.businessOpportunity,
    dataQualityNotes: [
      // TODO(gt_growth_ai): apply entitlement checks here when subscriptions are available.
      "GT Growth AI fields are prepared as premium report sections. Billing entitlement is not checked yet.",
      ...params.dataQualityNotes,
    ],
  };
}

function insight(params: Omit<ReportAiInsight, "createdAt"> & { createdAt: string }) {
  return params;
}

function firstNonEmpty(items: Array<string | null | undefined>, fallback: string | null) {
  return items.map((item) => item?.trim() ?? "").find(Boolean) ?? fallback;
}

function summarizeActionTitles(actions: ReportNextAction[]) {
  return actions.slice(0, 3).map((action) => action.title);
}

function appendNextActionFromInsight(
  actions: ReportNextAction[],
  input: Omit<ReportNextAction, "id"> & { id: string },
) {
  if (actions.some((action) => action.id === input.id)) {
    return;
  }

  actions.push(input);
}

function buildAppointmentSummary(input: AppointmentReportAiInput, actions: ReportNextAction[]) {
  if (input.totalAppointments === 0) {
    return "No appointment activity is available for today yet. Recommended action: check whether the clinic schedule has synced before making business decisions.";
  }

  const topService = input.topServices[0]?.name;
  const positive = topService
    ? `The strongest service today is ${topService}.`
    : input.completedAppointments > 0
      ? `${input.completedAppointments.toLocaleString("en-US")} appointment(s) are already completed.`
      : null;
  const risk =
    input.noShowRatePercent != null && input.noShowRatePercent >= 10
      ? `No-show rate is ${formatPercent(input.noShowRatePercent)}.`
      : input.cancellationRatePercent != null && input.cancellationRatePercent >= 15
        ? `Cancellation rate is ${formatPercent(input.cancellationRatePercent)}.`
        : null;
  const opportunity =
    input.completedCustomersWithoutFutureBookingCount != null &&
    input.completedCustomersWithoutFutureBookingCount > 0
      ? `${input.completedCustomersWithoutFutureBookingCount.toLocaleString("en-US")} completed customer(s) have no future booking.`
      : input.underutilizedHours[0]
        ? `${input.underutilizedHours[0].label} is underbooked.`
        : null;
  const action = summarizeActionTitles(actions)[0] ?? "Review today's appointment board and confirm remaining bookings.";

  return [
    `Today's appointment flow has ${input.totalAppointments.toLocaleString("en-US")} appointment(s), with ${input.completedAppointments.toLocaleString("en-US")} completed and ${input.upcomingAppointments.toLocaleString("en-US")} upcoming.`,
    positive,
    risk,
    opportunity,
    `Recommended action: ${action}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildAppointmentReportAiPayload(
  input: AppointmentReportAiInput,
  generatedAt = new Date().toISOString(),
) {
  const insights: ReportAiInsight[] = [];
  const nextActions: ReportNextAction[] = [];
  const dataQualityNotes: string[] = [];

  if (input.completedCustomersWithoutFutureBookingCount == null) {
    dataQualityNotes.push("Future booking data was unavailable, so rebooking opportunity count was not calculated.");
  }

  if (input.comparison?.previousSameWeekdayAverageAppointments == null) {
    dataQualityNotes.push("Same-weekday appointment comparison was unavailable.");
  }

  const underutilizedHour = input.underutilizedHours[0];
  if (underutilizedHour && input.totalAppointments > 0) {
    const busiestHour = input.busyHours[0];
    insights.push(
      insight({
        id: "daily-appointment-underutilized-slot",
        reportType: "daily_appointment",
        category: "opportunity",
        severity: "warning",
        title: `${underutilizedHour.label} is underbooked`,
        summary: `This time slot has ${underutilizedHour.count.toLocaleString("en-US")} booking(s) in today's schedule.`,
        evidence: [
          { label: "Current bookings for slot", value: underutilizedHour.count },
          ...(busiestHour
            ? [
                {
                  label: "Busiest slot today",
                  value: busiestHour.label,
                  comparison: `${busiestHour.count.toLocaleString("en-US")} booking(s)`,
                },
              ]
            : []),
          ...(input.comparison?.previousSameWeekdayAverageAppointments != null
            ? [
                {
                  label: "Recent same-weekday average appointments",
                  value: input.comparison.previousSameWeekdayAverageAppointments,
                },
              ]
            : []),
        ],
        recommendedAction:
          "Create a same-day promotion for this time slot or ask staff to contact customers due for follow-up.",
        estimatedImpact: "May help recover unused appointment capacity today.",
        confidence: busiestHour ? "medium" : "low",
        createdAt: generatedAt,
      }),
    );
    appendNextActionFromInsight(nextActions, {
      id: "daily-appointment-promote-underutilized-slot",
      priority: "medium",
      actionType: "promote_time_slot",
      title: `Promote ${underutilizedHour.label}`,
      description: "Use a same-day offer or front desk follow-up to fill the weakest visible slot.",
      reason: `${underutilizedHour.label} has only ${underutilizedHour.count.toLocaleString("en-US")} booking(s) in today's schedule.`,
      suggestedOwner: "Front desk",
      dueDate: input.dateKey,
    });
  }

  const noShowComparison = input.comparison?.previousSameWeekdayAverageNoShowRatePercent;
  const noShowIsHigh =
    input.noShowAppointments > 0 &&
    (input.noShowRatePercent == null ||
      input.noShowRatePercent >= 10 ||
      (noShowComparison != null && input.noShowRatePercent > noShowComparison + 2));

  if (noShowIsHigh) {
    insights.push(
      insight({
        id: "daily-appointment-no-show-risk",
        reportType: "daily_appointment",
        category: "risk",
        severity: input.noShowRatePercent != null && input.noShowRatePercent >= 20 ? "critical" : "warning",
        title: "No-show rate needs attention",
        summary: `${input.noShowAppointments.toLocaleString("en-US")} appointment(s) are marked no-show today.`,
        evidence: [
          { label: "No-show count", value: input.noShowAppointments },
          { label: "No-show rate", value: formatPercent(input.noShowRatePercent) },
          ...(noShowComparison != null
            ? [
                {
                  label: "Recent same-weekday no-show average",
                  value: formatPercent(noShowComparison),
                },
              ]
            : []),
        ],
        recommendedAction: "Send reminders to today's remaining customers and confirm tomorrow's high-risk appointments.",
        estimatedImpact: "Can reduce missed slots and protect therapist utilization.",
        confidence: input.noShowRatePercent == null ? "low" : "medium",
        createdAt: generatedAt,
      }),
    );
    appendNextActionFromInsight(nextActions, {
      id: "daily-appointment-confirm-remaining-bookings",
      priority: input.noShowRatePercent != null && input.noShowRatePercent >= 20 ? "high" : "medium",
      actionType: "send_reminder",
      title: "Confirm remaining appointments",
      description: "Send reminders for the rest of today and tomorrow's first appointments.",
      reason: `${input.noShowAppointments.toLocaleString("en-US")} no-show appointment(s) are visible today.`,
      suggestedOwner: "Reception",
      dueDate: input.dateKey,
    });
  }

  if (input.therapistLoad.length >= 2) {
    const sortedLoad = [...input.therapistLoad].sort((left, right) => right.count - left.count);
    const highest = sortedLoad[0];
    const lowest = sortedLoad[sortedLoad.length - 1];
    const difference = highest.count - lowest.count;

    if (difference >= 2 && highest.count >= Math.max(2, lowest.count * 2)) {
      insights.push(
        insight({
          id: "daily-appointment-therapist-load-imbalance",
          reportType: "daily_appointment",
          category: "staff",
          severity: "warning",
          title: "Therapist schedule is uneven",
          summary: `${highest.name} has ${difference.toLocaleString("en-US")} more booking(s) than ${lowest.name}.`,
          evidence: [
            { label: "Highest booked therapist", value: highest.name, comparison: `${highest.count} appointment(s)` },
            { label: "Lowest booked therapist", value: lowest.name, comparison: `${lowest.count} appointment(s)` },
            { label: "Appointment count difference", value: difference },
          ],
          recommendedAction: "Move flexible bookings or assign walk-ins to underutilized therapists.",
          estimatedImpact: "May improve therapist utilization and reduce service bottlenecks.",
          confidence: "medium",
          createdAt: generatedAt,
        }),
      );
      appendNextActionFromInsight(nextActions, {
        id: "daily-appointment-review-therapist-load",
        priority: "medium",
        actionType: "review_staff_utilization",
        title: "Balance therapist assignments",
        description: "Assign walk-ins and flexible bookings to the lowest-loaded therapist first.",
        reason: `${highest.name} has ${difference.toLocaleString("en-US")} more appointment(s) than ${lowest.name}.`,
        suggestedOwner: "Clinic manager",
        dueDate: input.dateKey,
      });
    }
  }

  if (
    input.completedCustomersWithoutFutureBookingCount != null &&
    input.completedCustomersWithoutFutureBookingCount > 0
  ) {
    insights.push(
      insight({
        id: "daily-appointment-rebooking-opportunity",
        reportType: "daily_appointment",
        category: "customer",
        severity: "success",
        title: "Completed customers need next appointment",
        summary: `${input.completedCustomersWithoutFutureBookingCount.toLocaleString("en-US")} completed customer(s) do not have a future booking in the visible schedule.`,
        evidence: [
          { label: "Completed appointments", value: input.completedAppointments },
          { label: "Completed customers without future booking", value: input.completedCustomersWithoutFutureBookingCount },
        ],
        recommendedAction: "Ask receptionist to rebook customers before they leave.",
        estimatedImpact: "May improve repeat visits and protect next-week demand.",
        confidence: "medium",
        createdAt: generatedAt,
      }),
    );
    appendNextActionFromInsight(nextActions, {
      id: "daily-appointment-rebook-completed-customers",
      priority: "high",
      actionType: "rebook_customer",
      title: `Rebook ${input.completedCustomersWithoutFutureBookingCount.toLocaleString("en-US")} completed customer(s)`,
      description: "Ask the front desk to offer the next appointment before customers leave or by same-day follow-up.",
      reason: "These customers completed service today and no future booking was found in the visible schedule.",
      suggestedOwner: "Reception",
      dueDate: input.dateKey,
    });
  }

  const businessOpportunity = firstNonEmpty(
    [
      input.completedCustomersWithoutFutureBookingCount != null &&
      input.completedCustomersWithoutFutureBookingCount > 0
        ? `Rebooking ${input.completedCustomersWithoutFutureBookingCount.toLocaleString("en-US")} completed customer(s) is today's clearest growth opportunity.`
        : null,
      underutilizedHour ? `Filling ${underutilizedHour.label} is today's visible schedule opportunity.` : null,
    ],
    null,
  );

  return buildPayload({
    generatedAt,
    summary: buildAppointmentSummary(input, nextActions),
    insights,
    nextActions,
    businessOpportunity,
    dataQualityNotes,
  });
}

function buildPaymentSummary(input: PaymentReportAiInput, actions: ReportNextAction[]) {
  if (input.paymentCount === 0 && input.totalPaymentAmount <= 0) {
    return "No payment activity is available for today yet. Recommended action: check whether payments have synced before reading revenue performance.";
  }

  const topMethod = input.paymentMethods[0]?.paymentMethod;
  const change = percentageChange(input.totalPaymentAmount, input.previousDayTotalPaymentAmount);
  const positive = topMethod ? `${topMethod} is the leading payment method today.` : null;
  const risk =
    input.outstandingAmount > 0
      ? `${formatMoney(input.outstandingAmount)} remains outstanding or partial.`
      : change != null && change <= -15
        ? `Revenue is ${formatSignedPercent(change)} versus previous day.`
        : null;
  const opportunity =
    input.revenueByServiceOrPackage[0]?.name
      ? `${input.revenueByServiceOrPackage[0].name} is the strongest visible revenue line.`
      : input.sellerTotals.length >= 2
        ? "Seller revenue distribution can be reviewed today."
        : null;
  const action = summarizeActionTitles(actions)[0] ?? "Review payment collection and reconcile today's invoices.";

  return [
    `Today's payment total is ${formatMoney(input.totalPaymentAmount)} from ${input.paymentCount.toLocaleString("en-US")} payment record(s).`,
    positive,
    risk,
    opportunity,
    `Recommended action: ${action}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildPaymentReportAiPayload(
  input: PaymentReportAiInput,
  generatedAt = new Date().toISOString(),
) {
  const insights: ReportAiInsight[] = [];
  const nextActions: ReportNextAction[] = [];
  const dataQualityNotes: string[] = [];

  if (input.previousDayTotalPaymentAmount == null) {
    dataQualityNotes.push("Previous-day payment comparison was unavailable.");
  }

  if (input.revenueByServiceOrPackage.length === 0) {
    dataQualityNotes.push("Service/package revenue breakdown was unavailable in this report source.");
  }

  if (input.refundVoidDiscountAmount == null) {
    dataQualityNotes.push("Refund, void, and discount totals were unavailable in this report source.");
  }

  const revenueChange = percentageChange(input.totalPaymentAmount, input.previousDayTotalPaymentAmount);
  if (revenueChange != null && revenueChange <= -15) {
    insights.push(
      insight({
        id: "daily-payment-revenue-drop",
        reportType: "daily_payment",
        category: "revenue",
        severity: revenueChange <= -30 ? "critical" : "warning",
        title: "Revenue is below yesterday",
        summary: `Today's collected payment amount is ${formatSignedPercent(revenueChange)} versus previous day.`,
        evidence: [
          { label: "Today revenue", value: formatMoney(input.totalPaymentAmount) },
          { label: "Previous day revenue", value: formatMoney(input.previousDayTotalPaymentAmount ?? 0) },
          { label: "Revenue change", value: formatSignedPercent(revenueChange) },
        ],
        recommendedAction:
          "Check whether package sales dropped, appointments were lower, or high-value customers did not visit.",
        estimatedImpact: "Can help the owner identify which sales lever needs attention before closing.",
        confidence: "medium",
        createdAt: generatedAt,
      }),
    );
    appendNextActionFromInsight(nextActions, {
      id: "daily-payment-review-revenue-drop",
      priority: revenueChange <= -30 ? "high" : "medium",
      actionType: "review_revenue_drop",
      title: "Review today's revenue drop",
      description: "Compare appointments, package sales, and high-value invoices before closing.",
      reason: `Payment revenue is ${formatSignedPercent(revenueChange)} versus previous day.`,
      suggestedOwner: "Owner or manager",
      dueDate: input.dateKey,
    });
  }

  const packageLine = input.revenueByServiceOrPackage.find((row) => row.name.toLowerCase().includes("package"));
  if (packageLine) {
    insights.push(
      insight({
        id: "daily-payment-package-sales-opportunity",
        reportType: "daily_payment",
        category: "package",
        severity: "success",
        title: "Package sales signal found",
        summary: `${packageLine.name} contributed ${formatMoney(packageLine.amount)} today.`,
        evidence: [
          { label: "Package/service line", value: packageLine.name },
          { label: "Revenue", value: formatMoney(packageLine.amount) },
          { label: "Invoice count", value: packageLine.count },
        ],
        recommendedAction: "Offer package upgrade to repeat customers who paid for single treatments.",
        estimatedImpact: "May increase future prepaid revenue and repeat bookings.",
        confidence: "medium",
        createdAt: generatedAt,
      }),
    );
  }

  if (input.outstandingAmount > 0 || input.partialPaymentInvoiceCount > 0) {
    insights.push(
      insight({
        id: "daily-payment-collection-risk",
        reportType: "daily_payment",
        category: "risk",
        severity: input.outstandingAmount > 0 ? "warning" : "info",
        title: "Unpaid or partial payments need follow-up",
        summary: `${input.partialPaymentInvoiceCount.toLocaleString("en-US")} invoice(s) have partial or outstanding payment signals.`,
        evidence: [
          { label: "Outstanding amount", value: formatMoney(input.outstandingAmount) },
          { label: "Affected invoices", value: input.partialPaymentInvoiceCount },
        ],
        recommendedAction: "Follow up unpaid or partial invoices before closing.",
        estimatedImpact: "Can protect same-day collection and reduce end-of-day reconciliation issues.",
        confidence: "medium",
        createdAt: generatedAt,
      }),
    );
    appendNextActionFromInsight(nextActions, {
      id: "daily-payment-follow-up-partial-payments",
      priority: input.outstandingAmount > 0 ? "high" : "medium",
      actionType: "follow_up_payment",
      title: "Follow up partial payments",
      description: "Review partial or outstanding invoices and collect before closing.",
      reason: `${formatMoney(input.outstandingAmount)} is still outstanding across ${input.partialPaymentInvoiceCount.toLocaleString("en-US")} invoice(s).`,
      suggestedOwner: "Cashier",
      dueDate: input.dateKey,
    });
  }

  if (input.sellerTotals.length >= 2) {
    const sellers = [...input.sellerTotals].sort((left, right) => right.amount - left.amount);
    const topSeller = sellers[0];
    const lowestSeller = sellers[sellers.length - 1];
    const difference = topSeller.amount - lowestSeller.amount;

    if (difference > 0 && topSeller.amount >= Math.max(1, lowestSeller.amount * 2)) {
      insights.push(
        insight({
          id: "daily-payment-seller-performance-gap",
          reportType: "daily_payment",
          category: "staff",
          severity: "info",
          title: "Seller performance gap detected",
          summary: `${topSeller.sellerName} collected ${formatMoney(difference)} more than ${lowestSeller.sellerName}.`,
          evidence: [
            { label: "Top seller revenue", value: topSeller.sellerName, comparison: formatMoney(topSeller.amount) },
            { label: "Lowest seller revenue", value: lowestSeller.sellerName, comparison: formatMoney(lowestSeller.amount) },
            { label: "Revenue difference", value: formatMoney(difference) },
          ],
          recommendedAction: "Review sales scripts or package offer process with lower-performing sellers.",
          estimatedImpact: "May improve consistency in package offers and invoice value.",
          confidence: "medium",
          createdAt: generatedAt,
        }),
      );
    }
  }

  const businessOpportunity = firstNonEmpty(
    [
      input.outstandingAmount > 0 ? `Collecting ${formatMoney(input.outstandingAmount)} before closing is the clearest payment opportunity.` : null,
      input.revenueByServiceOrPackage[0]
        ? `${input.revenueByServiceOrPackage[0].name} can be used as today's upgrade or repeat-sale anchor.`
        : null,
    ],
    null,
  );

  return buildPayload({
    generatedAt,
    summary: buildPaymentSummary(input, nextActions),
    insights,
    nextActions,
    businessOpportunity,
    dataQualityNotes,
  });
}

function buildWeeklySummary(input: WeeklySummaryReportAiInput, actions: ReportNextAction[]) {
  if (input.weeklyAppointmentCount === 0 && input.weeklyRevenue <= 0) {
    return "No completed weekly activity is available in this summary. Recommended action: check report timing and data sync before planning next week.";
  }

  const positive =
    input.weekOverWeekRevenueChangePercent != null && input.weekOverWeekRevenueChangePercent > 0
      ? `Revenue is ${formatSignedPercent(input.weekOverWeekRevenueChangePercent)} week over week.`
      : input.topServices[0]
        ? `${input.topServices[0].name} is the strongest service this week.`
        : null;
  const risk =
    input.previousWeekCancelledAppointments != null &&
    input.weeklyCancelledAppointments > input.previousWeekCancelledAppointments
      ? `Cancellations increased to ${input.weeklyCancelledAppointments.toLocaleString("en-US")} this week.`
      : input.weekOverWeekRevenueChangePercent != null && input.weekOverWeekRevenueChangePercent <= -15
        ? `Revenue is ${formatSignedPercent(input.weekOverWeekRevenueChangePercent)} week over week.`
        : null;
  const opportunity =
    input.underutilizedDays[0]
      ? `${input.underutilizedDays[0].label} is the weakest day pattern.`
      : input.customerRetentionOpportunityCount != null && input.customerRetentionOpportunityCount > 0
        ? `${input.customerRetentionOpportunityCount.toLocaleString("en-US")} customer follow-up opportunity(s) were found.`
        : null;
  const action = summarizeActionTitles(actions)[0] ?? "Review next week's bookings, rebooking follow-up, and payment collection.";

  return [
    `Weekly summary: ${input.weeklyAppointmentCount.toLocaleString("en-US")} appointment(s) and ${formatMoney(input.weeklyRevenue)} collected.`,
    positive,
    risk,
    opportunity,
    `Recommended action: ${action}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildWeeklySummaryReportAiPayload(
  input: WeeklySummaryReportAiInput,
  generatedAt = new Date().toISOString(),
) {
  const insights: ReportAiInsight[] = [];
  const nextActions: ReportNextAction[] = [];
  const dataQualityNotes: string[] = [];

  if (input.weekOverWeekRevenueChangePercent == null) {
    dataQualityNotes.push("Week-over-week revenue comparison was unavailable.");
  }

  if (input.weekOverWeekAppointmentChangePercent == null) {
    dataQualityNotes.push("Week-over-week appointment comparison was unavailable.");
  }

  if (!input.packageSalesSummary) {
    dataQualityNotes.push("Package sales summary was unavailable in this weekly report source.");
  }

  if (input.customerRetentionOpportunityCount == null) {
    dataQualityNotes.push("Customer retention or rebooking opportunity data was unavailable in this weekly report source.");
  }

  if (input.weekOverWeekRevenueChangePercent != null && input.weekOverWeekRevenueChangePercent >= 10) {
    insights.push(
      insight({
        id: "weekly-summary-growth",
        reportType: "weekly_summary",
        category: "revenue",
        severity: "success",
        title: "Business improved this week",
        summary: `Weekly revenue is ${formatSignedPercent(input.weekOverWeekRevenueChangePercent)} versus the previous week.`,
        evidence: [
          { label: "This week revenue", value: formatMoney(input.weeklyRevenue) },
          { label: "Last week revenue", value: formatMoney(input.previousWeekRevenue ?? 0) },
          { label: "Percentage change", value: formatSignedPercent(input.weekOverWeekRevenueChangePercent) },
        ],
        recommendedAction: "Identify which service or seller drove the increase and repeat the strategy next week.",
        estimatedImpact: "Can help repeat the strongest weekly growth lever.",
        confidence: "medium",
        createdAt: generatedAt,
      }),
    );
  }

  if (input.weekOverWeekRevenueChangePercent != null && input.weekOverWeekRevenueChangePercent <= -15) {
    insights.push(
      insight({
        id: "weekly-summary-revenue-risk",
        reportType: "weekly_summary",
        category: "risk",
        severity: input.weekOverWeekRevenueChangePercent <= -30 ? "critical" : "warning",
        title: "Revenue declined this week",
        summary: `Weekly revenue is ${formatSignedPercent(input.weekOverWeekRevenueChangePercent)} versus the previous week.`,
        evidence: [
          { label: "This week revenue", value: formatMoney(input.weeklyRevenue) },
          { label: "Last week revenue", value: formatMoney(input.previousWeekRevenue ?? 0) },
          { label: "Percentage change", value: formatSignedPercent(input.weekOverWeekRevenueChangePercent) },
        ],
        recommendedAction: "Review appointment volume, package sales, and high-value invoices before planning next week.",
        estimatedImpact: "Can help focus next week's recovery plan on the largest gap.",
        confidence: "medium",
        createdAt: generatedAt,
      }),
    );
    appendNextActionFromInsight(nextActions, {
      id: "weekly-summary-review-revenue-drop",
      priority: input.weekOverWeekRevenueChangePercent <= -30 ? "high" : "medium",
      actionType: "review_revenue_drop",
      title: "Review weekly revenue drop",
      description: "Compare appointment count, service mix, and package sales before setting next week's plan.",
      reason: `Revenue is ${formatSignedPercent(input.weekOverWeekRevenueChangePercent)} versus previous week.`,
      suggestedOwner: "Owner or manager",
      dueDate: input.weekEndDateKey,
    });
  }

  if (
    input.previousWeekCancelledAppointments != null &&
    input.weeklyCancelledAppointments > input.previousWeekCancelledAppointments
  ) {
    insights.push(
      insight({
        id: "weekly-summary-cancellation-risk",
        reportType: "weekly_summary",
        category: "appointment",
        severity: "warning",
        title: "Cancellations increased this week",
        summary: `Cancellations increased from ${input.previousWeekCancelledAppointments.toLocaleString("en-US")} to ${input.weeklyCancelledAppointments.toLocaleString("en-US")}.`,
        evidence: [
          { label: "This week cancellations", value: input.weeklyCancelledAppointments },
          { label: "Last week cancellations", value: input.previousWeekCancelledAppointments },
          {
            label: "Cancellation rate",
            value: formatPercent(percentageRate(input.weeklyCancelledAppointments, input.weeklyAppointmentCount)),
          },
        ],
        recommendedAction: "Review reminder process and contact customers earlier before appointments.",
        estimatedImpact: "May protect next week's booked capacity.",
        confidence: "medium",
        createdAt: generatedAt,
      }),
    );
    appendNextActionFromInsight(nextActions, {
      id: "weekly-summary-tighten-reminders",
      priority: "medium",
      actionType: "send_reminder",
      title: "Tighten appointment reminders",
      description: "Review the reminder timing for next week's appointments.",
      reason: "Cancellations increased compared with the previous week.",
      suggestedOwner: "Reception",
      dueDate: input.weekEndDateKey,
    });
  }

  const weakSlot = input.underutilizedHours[0] ?? input.underutilizedDays[0];
  if (weakSlot) {
    insights.push(
      insight({
        id: "weekly-summary-underutilized-pattern",
        reportType: "weekly_summary",
        category: "operations",
        severity: "info",
        title: "Consistent weak schedule slot found",
        summary: `${weakSlot.label} had ${weakSlot.count.toLocaleString("en-US")} appointment(s) in the weekly schedule.`,
        evidence: [
          { label: "Weakest day/time", value: weakSlot.label },
          { label: "Booking count", value: weakSlot.count },
        ],
        recommendedAction: "Run a targeted promotion for this slot next week.",
        estimatedImpact: "May improve underused schedule capacity next week.",
        confidence: "low",
        createdAt: generatedAt,
      }),
    );
    appendNextActionFromInsight(nextActions, {
      id: "weekly-summary-promote-weak-slot",
      priority: "medium",
      actionType: "promote_time_slot",
      title: `Promote ${weakSlot.label}`,
      description: "Plan a targeted offer or follow-up campaign for this weak schedule slot.",
      reason: `${weakSlot.label} had only ${weakSlot.count.toLocaleString("en-US")} appointment(s) this week.`,
      suggestedOwner: "Marketing or reception",
      dueDate: input.weekEndDateKey,
    });
  }

  if (input.weeklyAppointmentCount > 0 || input.weeklyRevenue > 0) {
    insights.push(
      insight({
        id: "weekly-summary-next-week-action-plan",
        reportType: "weekly_summary",
        category: "operations",
        severity: "info",
        title: "Recommended action plan for next week",
        summary: "Use this week's revenue, appointment, service, and utilization signals to set next week's priorities.",
        evidence: [
          {
            label: "Revenue trend",
            value:
              input.weekOverWeekRevenueChangePercent == null
                ? "No comparison"
                : formatSignedPercent(input.weekOverWeekRevenueChangePercent),
          },
          {
            label: "Appointment trend",
            value:
              input.weekOverWeekAppointmentChangePercent == null
                ? "No comparison"
                : formatSignedPercent(input.weekOverWeekAppointmentChangePercent),
          },
          ...(input.topServices[0]
            ? [{ label: "Top service", value: input.topServices[0].name, comparison: `${input.topServices[0].count} appointment(s)` }]
            : []),
          ...(input.topTherapists[0]
            ? [
                {
                  label: "Top therapist",
                  value: input.topTherapists[0].name,
                  comparison: `${input.topTherapists[0].count} appointment(s)`,
                },
              ]
            : []),
        ],
        recommendedAction: "Prioritize follow-up, rebooking, package renewal, and promotion actions.",
        estimatedImpact: "Creates a simple operating plan for next week's growth work.",
        confidence: "medium",
        createdAt: generatedAt,
      }),
    );
  }

  const businessOpportunity = firstNonEmpty(
    [
      weakSlot ? `A targeted promotion for ${weakSlot.label} is the clearest schedule opportunity for next week.` : null,
      input.topServices[0] ? `${input.topServices[0].name} can anchor next week's follow-up and package offers.` : null,
    ],
    null,
  );

  return buildPayload({
    generatedAt,
    summary: buildWeeklySummary(input, nextActions),
    insights,
    nextActions,
    businessOpportunity,
    dataQualityNotes,
  });
}

export function getReportAiActionLines(payload: ReportAiPayload, limit = 3) {
  return payload.nextActions.slice(0, limit).map((action) => action.title);
}

export function getInsightReportTypes(insights: ReportAiInsight[]) {
  return [...new Set(insights.map((item) => item.reportType))] as ReportAiReportType[];
}
