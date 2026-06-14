# Phase 1 GT Growth AI Report Review

## 1. Current Report V2 Audit

Report V2 already has operational Telegram reports for daily appointments, daily payments, and weekly summaries. The reports were useful as passive status updates: they listed counts, records, top services, therapist load, payment methods, sellers, and weekly rollups.

Phase 1 upgrades those reports into AI-assisted business action reports by adding a deterministic GT Growth AI payload to each report. The new payload answers:

- What happened?
- Why does it matter?
- What should the business owner do next?

No LLM calculates financial totals or appointment KPIs. Insight cards and summaries are generated only after deterministic report facts are calculated.

## 2. Files Reviewed

- `backend/src/services/telegram/report.service.ts`
- `backend/src/services/telegram/payment-report.service.ts`
- `backend/src/services/telegram/weekly-summary-report.service.ts`
- `backend/src/services/telegram/owner-ai-report.service.ts`
- `backend/src/services/telegram/types.ts`
- `backend/src/services/telegram/delivery.service.ts`
- `backend/src/services/telegram/runtime.service.ts`
- `backend/src/services/apicore.service.ts`
- `backend/src/services/bigquery.service.ts`
- `backend/src/services/reports/payment-report.service.ts`
- `backend/src/services/ai/insights.service.ts`
- `backend/src/routes/ai.routes.ts`
- `backend/src/routes/telegram.routes.ts`
- `frontend/src/features/operational/appointments/AppointmentsPage.tsx`
- `frontend/src/features/analytics/payment-report/PaymentReportPage.tsx`
- `frontend/src/features/settings/telegram/TelegramSettingsPage.tsx`

## 3. Existing KPIs Found

Daily Appointment Report:

- Total appointments
- Upcoming appointments
- Completed appointments
- Cancelled appointments
- No-show appointments
- Appointment preview rows
- Top services
- Therapist load

Daily Payment Report:

- Total payment amount
- Paid invoice count
- Payment record count
- Recent payment rows
- Payment method breakdown
- Seller totals

Weekly Summary Report:

- Weekly appointment count
- Weekly completed appointments
- Weekly cancelled appointments
- Weekly no-shows
- Completion rate
- Service summary
- Therapist summary
- Weekly payment amount
- Weekly payment count
- Payment method breakdown
- Top services
- Busy hours

## 4. Missing KPIs

Added in Phase 1 where data was available:

- Appointment cancellation rate
- Appointment no-show rate
- Daily busy hours
- Daily underutilized hours
- Completed customers with no future booking, when future schedule lookup succeeds
- Daily payment average invoice value
- Daily outstanding or partial payment amount
- Daily partial payment invoice count
- Daily previous-day payment comparison, when available
- Weekly cancellation rate
- Weekly no-show rate
- Weekly busy days
- Weekly underutilized days
- Weekly underutilized hours
- Week-over-week revenue change, when previous week data is available
- Week-over-week appointment change, when previous week data is available

Still limited or unavailable:

- Daily payment revenue by service/package in the Telegram source
- Refund, void, and discount totals in the Telegram source
- Same-weekday payment averages
- Weekly package sales summary
- Weekly customer retention/rebooking opportunity count
- Frontend rendering of Telegram report payloads as full report cards

## 5. New AI Insight Structure

Created `ReportAiInsight` in `backend/src/types/report-ai.ts`.

Each insight includes:

- Stable ID
- Report type
- Category
- Severity
- Title
- Summary
- Evidence labels and values
- Recommended action
- Optional estimated impact
- Confidence
- Created timestamp

The report-level payload is `ReportAiPayload`, attached as `gtGrowthAi` on each report.

## 6. New Recommended Action Structure

Created `ReportNextAction` in `backend/src/types/report-ai.ts`.

Each action includes:

- Stable ID
- Priority
- Action type
- Title
- Description
- Reason
- Optional suggested owner
- Optional due date

Telegram uses the first three action titles to keep messages concise.

## 7. Report-Specific Improvements

Daily Appointment Report:

- Adds cancellation and no-show rates.
- Adds busy and underutilized time slots.
- Looks ahead 60 days to count completed customers without a future booking when data is reachable.
- Adds same-weekday appointment benchmark lookup when available.
- Generates insights for underbooked slots, no-show risk, therapist load imbalance, and rebooking opportunity.

Daily Payment Report:

- Adds average invoice value.
- Adds outstanding and partial payment KPIs.
- Adds previous-day payment comparison when available.
- Generates insights for revenue drop, collection risk, and seller performance gaps.
- Does not generate package sales insight unless service/package revenue evidence exists.

Weekly Summary Report:

- Adds cancellation and no-show rates.
- Adds busy days, underutilized days, and underutilized hours.
- Adds previous-week appointment and revenue comparisons when available.
- Generates insights for growth, revenue risk, cancellation risk, underutilized schedule patterns, and next-week action planning.

## 8. Paid Feature Gate Recommendation

Added the feature key `gt_growth_ai` in `backend/src/types/report-ai.ts`.

Current behavior:

- Basic report fields remain available.
- `gtGrowthAi` contains premium-ready sections: summary, insight cards, next actions, business opportunity, and evidence.
- `entitlementChecked` is currently `false`.

Recommended future gate:

- Keep existing report numbers free.
- Gate `gtGrowthAi.summary`, `gtGrowthAi.insights`, `gtGrowthAi.nextActions`, and `gtGrowthAi.businessOpportunity` behind the `gt_growth_ai` entitlement.
- Apply the check in report builders or route layer before returning/sending premium sections.

## 9. Remaining Limitations

- Telegram reports use API-core GraphQL sources, while broader analytics pages use BigQuery-backed report services. This phase did not rewrite data architecture.
- Daily payment service/package revenue is unavailable from the current Telegram payment order query, so package opportunity insight is intentionally skipped unless evidence exists.
- Frontend pages do not currently render the Telegram report payload as AI insight cards. Telegram output now includes concise AI Actions.
- Customer Relationship Agent, predictive AI, and vector database work were intentionally not changed.

## 10. Recommended Phase 2 Tasks

- Add entitlement checks for `gt_growth_ai`.
- Add a frontend Report V2 preview page that renders `gtGrowthAi` cards for appointment, payment, and weekly reports.
- Add BigQuery-backed service/package revenue evidence to the daily payment report.
- Add package sales and rebooking opportunity evidence to the weekly summary.
- Add same-weekday revenue averages and richer trend baselines.
- Add merchant-configurable operating hours/capacity for stronger underutilization insights.
- Keep predictive recommendations out until deterministic historical baselines are stable.
