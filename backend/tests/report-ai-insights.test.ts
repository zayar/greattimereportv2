import assert from "node:assert/strict";
import test from "node:test";

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql";

const {
  buildAppointmentReportAiPayload,
  buildPaymentReportAiPayload,
  buildWeeklySummaryReportAiPayload,
  getReportAiActionLines,
} = await import("../src/services/reports/report-ai-insights.service.ts");

const { formatTodayPaymentTelegramMessage } = await import("../src/services/telegram/payment-report.service.ts");

test("appointment AI payload is safe for empty report data", () => {
  const payload = buildAppointmentReportAiPayload(
    {
      dateKey: "2026-06-13",
      totalAppointments: 0,
      completedAppointments: 0,
      upcomingAppointments: 0,
      cancelledAppointments: 0,
      noShowAppointments: 0,
      cancellationRatePercent: null,
      noShowRatePercent: null,
      busyHours: [],
      underutilizedHours: [],
      topServices: [],
      therapistLoad: [],
      completedCustomersWithoutFutureBookingCount: null,
      comparison: null,
    },
    "2026-06-13T00:00:00.000Z",
  );

  assert.equal(payload.featureGate, "gt_growth_ai");
  assert.equal(payload.insights.length, 0);
  assert.equal(payload.nextActions.length, 0);
  assert.match(payload.summary, /No appointment activity/i);
  assert.ok(payload.dataQualityNotes.some((note) => note.includes("Future booking data was unavailable")));
});

test("appointment AI payload generates supported insights from deterministic facts", () => {
  const payload = buildAppointmentReportAiPayload(
    {
      dateKey: "2026-06-13",
      totalAppointments: 12,
      completedAppointments: 6,
      upcomingAppointments: 4,
      cancelledAppointments: 0,
      noShowAppointments: 2,
      cancellationRatePercent: 0,
      noShowRatePercent: 16.7,
      busyHours: [{ label: "10:00-11:00", count: 5 }],
      underutilizedHours: [{ label: "14:00-15:00", count: 0 }],
      topServices: [{ name: "Thai Massage", count: 4 }],
      therapistLoad: [
        { name: "Aye Aye", count: 6 },
        { name: "May", count: 1 },
      ],
      completedCustomersWithoutFutureBookingCount: 3,
      comparison: {
        previousSameWeekdayAverageAppointments: 10,
        previousSameWeekdayAverageNoShowRatePercent: 5,
        previousSameWeekdayAverageCancellationRatePercent: 2,
      },
    },
    "2026-06-13T00:00:00.000Z",
  );

  assert.deepEqual(
    payload.insights.map((insight) => insight.id),
    [
      "daily-appointment-underutilized-slot",
      "daily-appointment-no-show-risk",
      "daily-appointment-therapist-load-imbalance",
      "daily-appointment-rebooking-opportunity",
    ],
  );
  assert.ok(payload.nextActions.some((action) => action.actionType === "rebook_customer"));
  assert.match(payload.summary, /Thai Massage/);
});

test("payment AI payload does not invent package insight when service breakdown is missing", () => {
  const payload = buildPaymentReportAiPayload(
    {
      dateKey: "2026-06-13",
      totalPaymentAmount: 900_000,
      paymentCount: 3,
      paidInvoiceCount: 2,
      averageInvoiceValue: 450_000,
      paymentMethods: [{ paymentMethod: "Cash", count: 2, amount: 700_000 }],
      sellerTotals: [{ sellerName: "Hla", count: 2, amount: 700_000 }],
      outstandingAmount: 0,
      partialPaymentInvoiceCount: 0,
      previousDayTotalPaymentAmount: null,
      previousDayPaymentCount: null,
      revenueByServiceOrPackage: [],
      refundVoidDiscountAmount: null,
    },
    "2026-06-13T00:00:00.000Z",
  );

  assert.equal(payload.insights.some((insight) => insight.id === "daily-payment-package-sales-opportunity"), false);
  assert.ok(payload.dataQualityNotes.some((note) => note.includes("Service/package revenue breakdown was unavailable")));
  assert.match(payload.summary, /900,000 MMK/);
});

test("payment AI payload generates revenue and collection actions from calculated facts", () => {
  const payload = buildPaymentReportAiPayload(
    {
      dateKey: "2026-06-13",
      totalPaymentAmount: 600_000,
      paymentCount: 4,
      paidInvoiceCount: 3,
      averageInvoiceValue: 200_000,
      paymentMethods: [{ paymentMethod: "Cash", count: 4, amount: 600_000 }],
      sellerTotals: [
        { sellerName: "Top Seller", count: 3, amount: 550_000 },
        { sellerName: "Low Seller", count: 1, amount: 50_000 },
      ],
      outstandingAmount: 120_000,
      partialPaymentInvoiceCount: 1,
      previousDayTotalPaymentAmount: 1_000_000,
      previousDayPaymentCount: 6,
      revenueByServiceOrPackage: [],
      refundVoidDiscountAmount: null,
    },
    "2026-06-13T00:00:00.000Z",
  );

  assert.ok(payload.insights.some((insight) => insight.id === "daily-payment-revenue-drop"));
  assert.ok(payload.insights.some((insight) => insight.id === "daily-payment-collection-risk"));
  assert.ok(payload.nextActions.some((action) => action.actionType === "follow_up_payment"));
});

test("weekly AI payload handles missing comparison data and still builds an action plan", () => {
  const payload = buildWeeklySummaryReportAiPayload(
    {
      weekStartDateKey: "2026-06-01",
      weekEndDateKey: "2026-06-07",
      weeklyAppointmentCount: 20,
      weeklyCompletedAppointments: 14,
      weeklyCancelledAppointments: 2,
      weeklyNoShowAppointments: 1,
      weeklyRevenue: 2_500_000,
      weekOverWeekRevenueChangePercent: null,
      weekOverWeekAppointmentChangePercent: null,
      previousWeekRevenue: null,
      previousWeekAppointmentCount: null,
      previousWeekCancelledAppointments: null,
      topServices: [{ name: "Facial", count: 8 }],
      topTherapists: [{ name: "Aye Aye", count: 7 }],
      busyDays: [{ label: "Saturday Jun 6", count: 8 }],
      underutilizedDays: [],
      underutilizedHours: [],
      packageSalesSummary: null,
      customerRetentionOpportunityCount: null,
    },
    "2026-06-13T00:00:00.000Z",
  );

  assert.ok(payload.insights.some((insight) => insight.id === "weekly-summary-next-week-action-plan"));
  assert.ok(payload.dataQualityNotes.some((note) => note.includes("Week-over-week revenue comparison was unavailable")));
});

test("Telegram payment report includes concise AI Actions when actions exist", () => {
  const gtGrowthAi = buildPaymentReportAiPayload(
    {
      dateKey: "2026-06-13",
      totalPaymentAmount: 400_000,
      paymentCount: 2,
      paidInvoiceCount: 2,
      averageInvoiceValue: 200_000,
      paymentMethods: [{ paymentMethod: "Cash", count: 2, amount: 400_000 }],
      sellerTotals: [],
      outstandingAmount: 80_000,
      partialPaymentInvoiceCount: 1,
      previousDayTotalPaymentAmount: 900_000,
      previousDayPaymentCount: 4,
      revenueByServiceOrPackage: [],
      refundVoidDiscountAmount: null,
    },
    "2026-06-13T00:00:00.000Z",
  );

  const message = formatTodayPaymentTelegramMessage({
    clinicName: "Demo Clinic",
    dateKey: "2026-06-13",
    timezone: "Asia/Yangon",
    totalPaymentAmount: 400_000,
    paidInvoiceCount: 2,
    paymentCount: 2,
    averageInvoiceValue: 200_000,
    outstandingAmount: 80_000,
    partialPaymentInvoiceCount: 1,
    previousDayTotalPaymentAmount: 900_000,
    previousDayPaymentCount: 4,
    revenueByServiceOrPackage: [],
    refundVoidDiscountAmount: null,
    payments: [],
    paymentMethods: [{ paymentMethod: "Cash", count: 2, amount: 400_000 }],
    sellerTotals: [],
    gtGrowthAi,
  });

  assert.match(message, /AI Actions:/);
  assert.ok(getReportAiActionLines(gtGrowthAi).length <= 3);
});
